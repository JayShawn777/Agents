import "server-only";

import type { LessonNarration, LessonNarrationStep, NarrationAsset, Persona } from "@/lib/generated/prisma/client";
import type { LessonNarrationDTO, NarrationStepDTO } from "@/lib/schemas/dto";
import type { StoragePort } from "@/lib/storage/port";
import { NarrationCuesSchema } from "@/lib/narration/cues";
import { ERROR_MESSAGES, NARRATION_FAILURE_CODES, NARRATION_FAILURE_MESSAGES, type NarrationFailureCode } from "@/lib/errors";
import { SIGNED_URL_TTL_MS } from "@/lib/config";

/**
 * Mapping functions for the M5 narration DTO. Mirrors `lib/lessons/dto.ts`:
 * the ONLY place `LessonNarrationDTO` is built from Prisma rows.
 *
 * **Signed URLs are minted here, which is why this is async and takes a
 * `StoragePort`** — AC 11's bearer credential into the audio store, minted
 * only for a `READY` run (`steps` is empty for every other status, so there
 * is nothing to sign). This mirrors `GET /api/uploads/[id]/preview-url`
 * being the one place THAT signed URL is minted; here the equivalent "one
 * place" is this function rather than a dedicated route, because a lesson's
 * whole narration is signed as one unit (endpoint 47, plan §3).
 */

function toFailureMessage(failureCode: string | null): string | null {
  if (failureCode === null) return null;
  return NARRATION_FAILURE_CODES.includes(failureCode as NarrationFailureCode)
    ? NARRATION_FAILURE_MESSAGES[failureCode as NarrationFailureCode]
    : // An unrecognised code is still a failure the family must be told
      // about, and the one thing it must never do is reach them verbatim.
      ERROR_MESSAGES.INTERNAL_ERROR;
}

type StepForDTO = Pick<LessonNarrationStep, "stepId" | "stepIndex" | "startOffsetMs"> & {
  asset: Pick<NarrationAsset, "pathname" | "durationMs" | "cues">;
};

/**
 * A writer that actually produces this shape: `lib/narration/generate.ts`'s
 * `runNarrationGeneration` writes exactly one `LessonNarrationStep` per
 * script step, in step order, `stepId`-aligned with the source
 * `LessonScript` — the property `tests/unit/components/lessons/
 * lesson-player.test.tsx` names this file as the (until now, unbuilt)
 * source of.
 */
async function toNarrationStepDTO(storage: StoragePort, step: StepForDTO): Promise<NarrationStepDTO> {
  // ADR-0021: stored cues are re-parsed rather than cast, the same discipline
  // `toLessonVersionDTO` applies to a script — `cues` is a `Json` column, so
  // its TypeScript type is a promise nothing at the database level enforces.
  // A malformed row degrades to an empty word list rather than throwing in
  // front of a family; M5 renders none of `words` anyway (ADR-0021), so this
  // can never make a lesson unplayable, only less annotated than intended.
  const parsedCues = NarrationCuesSchema.safeParse(step.asset.cues);
  if (!parsedCues.success) {
    console.error(`toNarrationStepDTO: stored cues for step "${step.stepId}" failed to parse.`);
  }
  const words = parsedCues.success
    ? parsedCues.data.words.map((word) => ({ text: word.t, startMs: word.s, endMs: word.e }))
    : [];

  const { url, expiresAt } = await storage.signedReadUrl(step.asset.pathname, SIGNED_URL_TTL_MS);

  return {
    stepId: step.stepId,
    stepIndex: step.stepIndex,
    startOffsetMs: step.startOffsetMs,
    durationMs: step.asset.durationMs,
    audioUrl: url,
    audioUrlExpiresAt: expiresAt.toISOString(),
    words,
  };
}

type NarrationForDTO = Pick<
  LessonNarration,
  "id" | "versionId" | "status" | "stepCount" | "totalDurationMs" | "failureCode"
> & {
  persona: Pick<Persona, "id" | "slug" | "label"> | null;
  /** Ordering is NOT assumed — sorted by `stepIndex` below regardless of query order. */
  steps: StepForDTO[];
};

export async function toLessonNarrationDTO(storage: StoragePort, narration: NarrationForDTO): Promise<LessonNarrationDTO> {
  // AC 11: a signed URL is only ever minted for a READY run. Every other
  // status carries an empty `steps` array — there is nothing to sign, and
  // nothing for a client to play.
  const steps =
    narration.status === "READY"
      ? await Promise.all(
          [...narration.steps].sort((a, b) => a.stepIndex - b.stepIndex).map((step) => toNarrationStepDTO(storage, step)),
        )
      : [];

  return {
    id: narration.id,
    versionId: narration.versionId,
    status: narration.status,
    persona: narration.persona
      ? { id: narration.persona.id, slug: narration.persona.slug, label: narration.persona.label }
      : null,
    stepCount: narration.stepCount,
    totalDurationMs: narration.totalDurationMs,
    failureMessage: narration.status === "FAILED" ? toFailureMessage(narration.failureCode) : null,
    steps,
  };
}
