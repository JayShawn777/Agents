import "server-only";

import { withAuth } from "@/lib/api/handler";
import { successResponse } from "@/lib/errors";
import { requireExtraction } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { patchExtractedProblemInputSchema } from "@/lib/schemas/extraction";
import { toExtractedProblemDTO } from "@/lib/uploads/dto";
import type { ExtractedProblem } from "@/lib/generated/prisma/client";

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
 */
async function resolveOwnedProblem({
  params,
}: {
  params: Record<string, string>;
}): Promise<ExtractedProblem | null> {
  const { extractionId, problemId } = params;
  if (!extractionId || !problemId) return null;
  const extraction = await requireExtraction(extractionId);
  if (!extraction) return null;
  return extraction.problems.find((problem) => problem.id === problemId) ?? null;
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
 */
export const DELETE = withAuth({
  resolveResource: resolveOwnedProblem,
  handler: async ({ resource: problem }) => {
    await db.extractedProblem.delete({ where: { id: problem.id } });
    return successResponse({ deleted: true as const });
  },
});
