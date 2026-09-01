import "server-only";

import { withAuth } from "@/lib/api/handler";
import { successResponse } from "@/lib/errors";
import { requireExtraction } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { patchExtractedProblemInputSchema } from "@/lib/schemas/extraction";
import { toExtractedProblemDTO } from "@/lib/uploads/dto";
import { getStoragePort } from "@/lib/storage/get-storage";
import { purgeUnreferencedNarration } from "@/lib/narration/purge";
import type { ExtractedProblem } from "@/lib/generated/prisma/client";

/** The resolved `ExtractedProblem` plus its owning profile's id, carried through for DELETE's M5 §7.3 narration sweep — see `resolveOwnedProblem`. */
type OwnedProblem = ExtractedProblem & { studentProfileId: string };

/**
 * Endpoints 22-23 (plan §3.2) — `PATCH`/`DELETE
 * .../extractions/[extractionId]/problems/[problemId]`. The resource
 * resolves through `requireExtraction` (owner-scoped) and THEN finds the
 * named problem within that extraction's already-loaded, owner-verified
 * `problems` array — never a bare `db.extractedProblem.findUnique(problemId)`,
 * which would leak whether a `problemId` exists at all to a caller who
 * doesn't own its parent extraction. A `problemId` that exists but belongs to
 * a DIFFERENT extraction than the one in the URL is also a 404 this way,
 * matching M1 AC 33.
 *
 * `studentProfileId` is stitched on from the same already-loaded extraction
 * (`extraction.upload.studentProfileId`) rather than a second query, so
 * DELETE's narration sweep (M5 §7.3) has what it needs at no extra cost.
 */
async function resolveOwnedProblem({
  params,
}: {
  params: Record<string, string>;
}): Promise<OwnedProblem | null> {
  const { extractionId, problemId } = params;
  if (!extractionId || !problemId) return null;
  const extraction = await requireExtraction(extractionId);
  if (!extraction) return null;
  const problem = extraction.problems.find((p) => p.id === problemId) ?? null;
  if (!problem) return null;
  return { ...problem, studentProfileId: extraction.upload.studentProfileId };
}

/** M1 AC 28: the edit persists and the row is marked student-corrected. */
export const PATCH = withAuth({
  resolveResource: resolveOwnedProblem,
  bodySchema: patchExtractedProblemInputSchema,
  handler: async ({ resource: problem, body }) => {
    const updated = await db.extractedProblem.update({
      where: { id: problem.id },
      data: { text: body.text, studentCorrected: true },
    });
    return successResponse({ problem: toExtractedProblemDTO(updated) });
  },
});

/**
 * M1 AC 29: removed from the list; the survivors' ordinals are NEVER
 * renumbered (ADR-0005) — this handler only ever deletes the one targeted
 * row, so that guarantee holds by construction, with no separate
 * re-numbering step to keep correct.
 *
 * M5 §7.3 (AC 20) — the row delete cascades this problem's `Lesson` and, with
 * it, `LessonNarration`/`LessonNarrationStep`, but NOT the shared,
 * profile-scoped `NarrationAsset` rows those steps pointed at (ADR-0015).
 * `purgeUnreferencedNarration` sweeps those. Same pattern as
 * `lib/uploads/delete-upload.ts`'s step 4, exactly: best-effort and logged,
 * never fatal to this call — the problem itself is already fully deleted by
 * the time this runs, so a sweep failure here is a lingering cache entry,
 * not a lost deletion guarantee.
 */
export const DELETE = withAuth({
  resolveResource: resolveOwnedProblem,
  handler: async ({ resource: problem }) => {
    await db.extractedProblem.delete({ where: { id: problem.id } });

    try {
      await purgeUnreferencedNarration(problem.studentProfileId, getStoragePort());
    } catch (err) {
      console.error(
        `DELETE .../problems/[problemId]: purgeUnreferencedNarration failed for ` +
          `studentProfileId=${problem.studentProfileId}; any now-unreferenced NarrationAsset rows were left in place for a later sweep.`,
        err,
      );
    }

    return successResponse({ deleted: true as const });
  },
});
