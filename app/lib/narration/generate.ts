import "server-only";

import { db } from "@/lib/db";
import type { LessonNarration } from "@/lib/generated/prisma/client";
import type { StoragePort } from "@/lib/storage/port";
import { LessonScriptSchema, type LessonStep } from "@/lib/lessons/script-schema";
import { isSpeakableNarration } from "@/lib/narration/speakable";
import {
  synthesizeNarration,
  type SynthesizeNarrationFailureCode,
  type SynthesizeNarrationInput,
  type SynthesizeNarrationSuccess,
} from "@/lib/narration/provider";
import { AlignmentMismatchError, deriveNarrationCues } from "@/lib/narration/cues";
import { computeCacheKey, lookupNarrationAsset, writeNarrationAsset } from "@/lib/narration/cache";
import { type NarrationFailureCode } from "@/lib/errors";
import {
  CUE_FORMAT_VERSION,
  NARRATION_BACKOFF_BASE_MS,
  NARRATION_CHAR_CAP,
  NARRATION_MAX_ATTEMPTS,
  NARRATION_MAX_CONCURRENCY,
  NARRATION_OUTPUT_FORMAT,
  NARRATION_TIMEOUT_MS,
} from "@/lib/config";

/**
 * The narration generation pipeline (M5 plan §5, slice 5) — the fourth
 * instance of the `PENDING → GENERATING → READY | FAILED` shape this app
 * uses (`run-extraction.ts`, `lib/practice/generate.ts`, `lib/lessons/
 * author.ts`), with the same claim-then-run discipline: a compare-and-swap
 * update, never a bare one, so two racing `after()` invocations for one
 * `LessonNarration` row cannot both proceed.
 *
 * **Per step, not per lesson.** Each of a script's steps gets its own audio
 * asset (plan §0) — that is what makes AC 15's "no cumulative drift" true by
 * construction: step k's drawing starts when step k's OWN file starts, and
 * that file's duration is a measured fact, not a prediction.
 *
 * **The blob is written before the row, every time** (`lib/narration/
 * cache.ts`'s `writeNarrationAsset`, ADR-0007 §1's ordering) — the orphan
 * class slice 2's reconciler claim registry exists to reap on a crash between
 * the two.
 *
 * **`charactersBilled` counts only characters actually sent to the vendor.**
 * A cache hit contributes zero — AC 21's daily budget must not charge a
 * profile for reusing its own cached line.
 */

export type RunNarrationGenerationResult =
  | { status: "READY"; narrationId: string; stepCount: number; totalDurationMs: number }
  | { status: "FAILED"; failureCode: NarrationFailureCode }
  /**
   * Returned when invoked against a row that is no longer `PENDING` —
   * already `GENERATING` from a racing trigger, or already terminal. Never
   * fabricated into one of the shapes above; a caller that cares re-reads.
   */
  | { status: "SKIPPED" };

/** Thrown internally by the per-step pipeline; caught once at the top and mapped to a terminal `LessonNarration.failureCode`. */
export class NarrationRunError extends Error {
  constructor(public readonly failureCode: NarrationFailureCode) {
    super(`narration run failed: ${failureCode}`);
    this.name = "NarrationRunError";
  }
}

/** Runs one narration attempt end to end for a single `LessonNarration` row. Also serves AC 17's retry: a `FAILED` row reset to `PENDING` runs through the exact same path. */
export async function runNarrationGeneration(
  narrationId: string,
  storage: StoragePort,
): Promise<RunNarrationGenerationResult> {
  const narration = await db.lessonNarration.findUnique({ where: { id: narrationId } });
  if (!narration) {
    throw new Error(`runNarrationGeneration: no LessonNarration row for id "${narrationId}".`);
  }
  if (narration.status !== "PENDING") {
    return { status: "SKIPPED" };
  }

  // Compare-and-swap claim — the same shape `authorLesson` uses, and for the
  // same reason: a `findUnique` followed by a bare `update` is check-then-act,
  // and two invocations for one row could both read PENDING and both proceed.
  const claimed = await db.lessonNarration.updateMany({
    where: { id: narrationId, status: "PENDING" },
    data: { status: "GENERATING", startedAt: new Date(), failureCode: null },
  });
  if (claimed.count === 0) {
    return { status: "SKIPPED" };
  }

  const version = await db.lessonScriptVersion.findUnique({
    where: { id: narration.versionId },
    select: { status: true, script: true },
  });
  const parsedScript =
    version?.status === "READY" && version.script !== null ? LessonScriptSchema.safeParse(version.script) : null;
  if (!parsedScript?.success) {
    // The route that creates a `LessonNarration` row only does so against a
    // READY current version (the contract's 409), so reaching here means
    // that invariant was bypassed, or the version's script failed to
    // re-parse — either way this is a defensive refusal, not an expected
    // branch.
    console.error(
      `runNarrationGeneration(${narrationId}): source LessonScriptVersion ${narration.versionId} is not a READY, parseable script.`,
    );
    return finalizeFailed(narrationId, "INTERNAL");
  }
  const script = parsedScript.data;

  try {
    const resolved = await mapWithConcurrency(script.steps, NARRATION_MAX_CONCURRENCY, (step) =>
      resolveStepAsset(storage, {
        studentProfileId: narration.studentProfileId,
        personaId: narration.personaId,
        providerVoiceId: narration.providerVoiceId,
        ttsModelId: narration.ttsModelId,
        step,
      }),
    );

    // Offsets are computed in a second, purely sequential pass over results
    // already resolved (possibly concurrently) above — AC 13's "running sum"
    // needs step order, not call order, and decoupling the two lets steps
    // synthesize up to `NARRATION_MAX_CONCURRENCY` at once without the
    // offset arithmetic caring which one finished first.
    let cursor = 0;
    let charactersBilled = 0;
    let cacheHits = 0;
    const stepRows = resolved.map((entry, stepIndex) => {
      const startOffsetMs = cursor;
      cursor += entry.durationMs;
      charactersBilled += entry.charactersSent;
      if (entry.cacheHit) cacheHits += 1;
      return { stepId: script.steps[stepIndex].id, stepIndex, assetId: entry.assetId, startOffsetMs };
    });
    const totalDurationMs = cursor;

    await db.$transaction([
      // A retry (AC 17) reuses the SAME `LessonNarration` row, so any step
      // rows from a prior failed or superseded attempt are cleared first.
      // The `NarrationAsset` rows they pointed at are untouched — ADR-0015's
      // cache is shared and outlives any one run.
      db.lessonNarrationStep.deleteMany({ where: { narrationId } }),
      db.lessonNarrationStep.createMany({ data: stepRows.map((row) => ({ ...row, narrationId })) }),
      db.lessonNarration.update({
        where: { id: narrationId },
        data: {
          status: "READY",
          failureCode: null,
          stepCount: stepRows.length,
          totalDurationMs,
          charactersBilled,
          cacheHits,
          cueFormatVersion: CUE_FORMAT_VERSION,
          completedAt: new Date(),
        },
      }),
    ]);

    return { status: "READY", narrationId, stepCount: stepRows.length, totalDurationMs };
  } catch (err) {
    const failureCode = classifyFailure(err);
    console.error(`runNarrationGeneration(${narrationId}) failed — ${failureCode}`);
    return finalizeFailed(narrationId, failureCode);
  }
}

/**
 * AC 6's narration equivalent: past `NARRATION_TIMEOUT_MS`, a non-terminal
 * row is reaped to `FAILED` so a client polling endpoint 47 is never left
 * waiting forever for a killed `after()` invocation. Covers BOTH `PENDING`
 * (the row was written but the schedule never committed) and `GENERATING`
 * (the call started but the function died), the same two-state shape `lib/
 * lessons/author.ts`'s `reapIfStale` covers and for the identical reason.
 *
 * **Re-reads on a lost guard race rather than returning a hard-coded
 * FAILED.** This is the M4 review's finding, named explicitly in this
 * milestone's brief as a landmine: a run that finishes moments before the
 * reaping read must not be told to the caller as a failure while a good
 * `READY` row sits underneath it.
 */
export async function reapIfStaleNarration<T extends LessonNarration>(narration: T, now: Date = new Date()): Promise<T> {
  if (narration.status !== "PENDING" && narration.status !== "GENERATING") return narration;
  if (now.getTime() < narration.updatedAt.getTime() + NARRATION_TIMEOUT_MS) return narration;

  const claimed = await db.lessonNarration.updateMany({
    where: { id: narration.id, status: narration.status },
    data: { status: "FAILED", failureCode: "TIMEOUT", completedAt: now },
  });
  if (claimed.count === 0) {
    const fresh = await db.lessonNarration.findUniqueOrThrow({ where: { id: narration.id } });
    return { ...narration, ...fresh };
  }
  return { ...narration, status: "FAILED", failureCode: "TIMEOUT" };
}

// ─────────────────────────── internals ───────────────────────────

type ResolveStepAssetArgs = {
  studentProfileId: string;
  personaId: string | null;
  providerVoiceId: string;
  ttsModelId: string;
  step: LessonStep;
};

type ResolvedStepAsset = {
  assetId: string;
  durationMs: number;
  cacheHit: boolean;
  /** 0 for a cache hit — AC 21's budget must never charge for reuse. */
  charactersSent: number;
};

/** Resolves one step's audio, from the cache or from a fresh vendor call. */
async function resolveStepAsset(storage: StoragePort, args: ResolveStepAssetArgs): Promise<ResolvedStepAsset> {
  const { studentProfileId, personaId, providerVoiceId, ttsModelId, step } = args;
  const cacheKey = computeCacheKey(step.narration, providerVoiceId, ttsModelId);

  const cached = await lookupNarrationAsset(studentProfileId, cacheKey);
  if (cached) {
    return { assetId: cached.id, durationMs: cached.durationMs, cacheHit: true, charactersSent: 0 };
  }

  // AC 10, re-asserted defensively. `LessonStepSchema.narration` already caps
  // this at authoring time, and the route that schedules a run re-checks the
  // whole script before writing the PENDING row (slice 6) — reaching here
  // over the cap means both were bypassed. Refuse rather than send a step
  // that was never validated for this vendor call.
  if (step.narration.length > NARRATION_CHAR_CAP) {
    throw new NarrationRunError("INTERNAL");
  }

  // The author-time guard (`assertSpeakableNarration`) stops a NEW lesson
  // from ever reaching here with LaTeX in its narration. This is the
  // defensive twin for a lesson authored BEFORE that guard existed — never
  // trust a stored row over a fresh check on a path this expensive.
  if (!isSpeakableNarration(step.narration)) {
    throw new NarrationRunError("UNSPEAKABLE");
  }

  const synthesis = await synthesizeWithRetry({
    text: step.narration,
    providerVoiceId,
    modelId: ttsModelId,
    outputFormat: NARRATION_OUTPUT_FORMAT,
  });

  const cues = deriveNarrationCues(step.narration, synthesis.alignment);

  const asset = await writeNarrationAsset(storage, {
    studentProfileId,
    personaId,
    cacheKey,
    providerVoiceId,
    ttsModelId,
    audio: synthesis.audio,
    durationMs: cues.durationMs,
    characterCount: step.narration.length,
    cues,
    cueFormatVersion: CUE_FORMAT_VERSION,
  });

  return { assetId: asset.id, durationMs: asset.durationMs, cacheHit: false, charactersSent: step.narration.length };
}

/** AC 9's retry: exponential backoff with jitter, only on a classified-retryable failure, capped at `NARRATION_MAX_ATTEMPTS`. */
async function synthesizeWithRetry(input: SynthesizeNarrationInput): Promise<SynthesizeNarrationSuccess> {
  let lastFailureCode: SynthesizeNarrationFailureCode = "INTERNAL";

  for (let attempt = 1; attempt <= NARRATION_MAX_ATTEMPTS; attempt++) {
    const result = await synthesizeNarration(input);
    if (result.ok) return result;

    lastFailureCode = result.failureCode;
    if (!result.retryable || attempt === NARRATION_MAX_ATTEMPTS) break;

    const backoffMs = NARRATION_BACKOFF_BASE_MS * 2 ** (attempt - 1);
    await sleep(backoffMs + Math.random() * backoffMs * 0.25);
  }

  throw new NarrationRunError(mapProviderFailureToRunFailure(lastFailureCode));
}

function mapProviderFailureToRunFailure(code: SynthesizeNarrationFailureCode): NarrationFailureCode {
  switch (code) {
    case "RATE_LIMITED":
      // Retries against 429 are already exhausted by the time this is
      // reached — the vendor is the reason we could not complete, which is
      // the same bucket a persistent 5xx lands in.
      return "UPSTREAM";
    case "TIMEOUT":
      return "TIMEOUT";
    case "UPSTREAM":
      return "UPSTREAM";
    case "INTERNAL":
      return "INTERNAL";
  }
}

function classifyFailure(err: unknown): NarrationFailureCode {
  if (err instanceof NarrationRunError) return err.failureCode;
  if (err instanceof AlignmentMismatchError) return "UPSTREAM";
  return "INTERNAL";
}

async function finalizeFailed(narrationId: string, failureCode: NarrationFailureCode): Promise<RunNarrationGenerationResult> {
  await db.lessonNarration.update({
    where: { id: narrationId },
    data: { status: "FAILED", failureCode, completedAt: new Date() },
  });
  return { status: "FAILED", failureCode };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * AC 9's concurrency pool (`NARRATION_MAX_CONCURRENCY`, the published floor —
 * the account's real ceiling cannot be read back, plan §8.3). A worker that
 * throws propagates through `Promise.all` immediately; siblings already
 * in flight are not cancelled, which is an accepted simplification at a
 * limit of 2 rather than wiring an `AbortController` through every step for
 * a case (a mid-run failure) that already fails the whole lesson's narration.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function runNext(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => runNext()));
  return results;
}
