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

  // The attempt row this run bills against (AC 21). Written by
  // `grantNarrationRun` inside the same transaction that granted the run, so
  // it always exists by the time `after()` gets here; `null` only for a caller
  // that bypassed the route, in which case spend is simply not ledgered.
  const attempt = await db.narrationRunAttempt.findFirst({
    where: { narrationId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const ledger: SpendLedger = { attemptId: attempt?.id ?? null, charactersSent: 0 };

  // Consent is re-read HERE, not merely at the route (2026-09-02 review). The
  // route's Owner+ACTIVE gate passed at t=0; `after()` then runs for up to
  // `maxDuration` (300s), during which a withdrawal or a §312.6 deletion can
  // land. Checked once before the claim, and again before every paid vendor
  // call below — a DB read is orders of magnitude cheaper than a TTS call, and
  // the thing being protected is audio derived from a specific child's homework.
  if (!(await isProfileActive(narration.studentProfileId))) {
    return finalizeFailed(narrationId, "CONSENT_INACTIVE", ledger);
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
    return finalizeFailed(narrationId, "INTERNAL", ledger);
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
        ledger,
      }),
    );

    // Offsets are computed in a second, purely sequential pass over results
    // already resolved (possibly concurrently) above — AC 13's "running sum"
    // needs step order, not call order, and decoupling the two lets steps
    // synthesize up to `NARRATION_MAX_CONCURRENCY` at once without the
    // offset arithmetic caring which one finished first.
    let cursor = 0;
    let cacheHits = 0;
    const stepRows = resolved.map((entry, stepIndex) => {
      const startOffsetMs = cursor;
      cursor += entry.durationMs;
      if (entry.cacheHit) cacheHits += 1;
      return { stepId: script.steps[stepIndex].id, stepIndex, assetId: entry.assetId, startOffsetMs };
    });
    const totalDurationMs = cursor;
    // From the ledger, not re-summed from `resolved` — the ledger is also what
    // the FAILED path records, so both paths report spend from one source.
    const charactersBilled = ledger.charactersSent;

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
      // The AC 21 ledger entry for THIS attempt. In the same transaction as the
      // terminal status, so a run is never READY with its spend unrecorded.
      ...(ledger.attemptId
        ? [
            db.narrationRunAttempt.update({
              where: { id: ledger.attemptId },
              data: { charactersBilled: ledger.charactersSent },
            }),
          ]
        : []),
    ]);

    return { status: "READY", narrationId, stepCount: stepRows.length, totalDurationMs };
  } catch (err) {
    const failureCode = classifyFailure(err);
    console.error(`runNarrationGeneration(${narrationId}) failed — ${failureCode}`);
    return finalizeFailed(narrationId, failureCode, ledger);
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

/**
 * What this attempt has actually sent to the vendor so far, accumulated as each
 * synthesis returns rather than summed at the end.
 *
 * The 2026-09-02 review found the end-summing version invisible on the FAILED
 * path: a run that failed on step 1 while its pool kept synthesizing the other
 * eleven recorded `charactersBilled: null`, so real paid spend never reached the
 * AC 21 budget at all. Mutating this as we go is what lets `finalizeFailed`
 * record what a partial run cost.
 */
type SpendLedger = {
  /** `null` only for a caller that bypassed `grantNarrationRun` (tests, mostly). */
  attemptId: string | null;
  charactersSent: number;
};

type ResolveStepAssetArgs = {
  studentProfileId: string;
  personaId: string | null;
  providerVoiceId: string;
  ttsModelId: string;
  step: LessonStep;
  ledger: SpendLedger;
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
  const { studentProfileId, personaId, providerVoiceId, ttsModelId, step, ledger } = args;
  const cacheKey = computeCacheKey(step.narration, providerVoiceId, ttsModelId);

  // A hit only counts when its cues are in the format this run stamps on the
  // `LessonNarration` row. The cache key covers (text, voice, model) but NOT the
  // cue format, so bumping `CUE_FORMAT_VERSION` used to leave lessons stamped
  // with the new version pointing at assets whose cues were derived under the
  // old one — a silent mismatch between what a row claims and what playback
  // reads. A stale-format hit is treated as a miss and re-synthesized.
  const cached = await lookupNarrationAsset(studentProfileId, cacheKey);
  if (cached && cached.cueFormatVersion === CUE_FORMAT_VERSION) {
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

  // The last gate before money is spent. See `runNarrationGeneration`'s own
  // consent comment: this run may have been in flight for minutes.
  if (!(await isProfileActive(studentProfileId))) {
    throw new NarrationRunError("CONSENT_INACTIVE");
  }

  const synthesis = await synthesizeWithRetry({
    text: step.narration,
    providerVoiceId,
    modelId: ttsModelId,
    outputFormat: NARRATION_OUTPUT_FORMAT,
  });

  // Ledgered the moment the vendor answers — BEFORE cue derivation or the blob
  // write, either of which can throw. The vendor billed for this text whether or
  // not we go on to make an asset out of it.
  ledger.charactersSent += step.narration.length;

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

/**
 * The terminal FAILED write — and, since the 2026-09-02 review, the place a
 * partial run's spend is recorded. `charactersBilled` is written on this path
 * too: a run that called the vendor five times and then failed cost exactly as
 * much as one that called it five times and succeeded, and AC 21's budget has to
 * see both or it is not a budget.
 */
async function finalizeFailed(
  narrationId: string,
  failureCode: NarrationFailureCode,
  ledger: SpendLedger,
): Promise<RunNarrationGenerationResult> {
  await db.$transaction([
    db.lessonNarration.update({
      where: { id: narrationId },
      data: { status: "FAILED", failureCode, charactersBilled: ledger.charactersSent, completedAt: new Date() },
    }),
    ...(ledger.attemptId
      ? [
          db.narrationRunAttempt.update({
            where: { id: ledger.attemptId },
            data: { charactersBilled: ledger.charactersSent },
          }),
        ]
      : []),
  ]);
  return { status: "FAILED", failureCode };
}

/** One cheap read, called before the claim and before every paid vendor call. */
async function isProfileActive(studentProfileId: string): Promise<boolean> {
  const profile = await db.studentProfile.findUnique({
    where: { id: studentProfileId },
    select: { status: true },
  });
  return profile?.status === "ACTIVE";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * AC 9's concurrency pool (`NARRATION_MAX_CONCURRENCY`, the published floor —
 * the account's real ceiling cannot be read back, plan §8.3).
 *
 * **It STOPS pulling work once any worker has thrown.** The previous version's
 * docstring claimed only that "siblings already in flight are not cancelled",
 * which was true and beside the point: the workers looped on a shared cursor, so
 * after `Promise.all` rejected, the surviving worker went right on draining the
 * whole queue. The 2026-09-02 review measured a 12-step script failing on step 1
 * returning FAILED after 2 vendor calls and then making 10 more — paid, and
 * invisible to the AC 21 budget, because the run was already terminal.
 *
 * A sibling ALREADY in flight is still not cancelled, which remains the accepted
 * simplification at a limit of 2: the ledger now records what those calls cost,
 * so the untracked-spend half of the problem is closed either way.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  let aborted = false;

  async function runNext(): Promise<void> {
    for (;;) {
      // Checked before claiming an index, so a worker that wakes up after a
      // sibling threw takes no new item rather than one more each time round.
      if (aborted) return;
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index], index);
      } catch (err) {
        aborted = true;
        throw err;
      }
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => runNext()));
  return results;
}
