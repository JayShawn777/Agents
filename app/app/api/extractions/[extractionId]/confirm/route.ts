import "server-only";

import { withAuth } from "@/lib/api/handler";
import { successResponse } from "@/lib/errors";
import { requireExtraction, type ExtractionWithProblems } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { extractionConfirmInputSchema } from "@/lib/schemas/extraction";
import { toExtractionDTO } from "@/lib/uploads/dto";

async function resolveOwnedExtraction({
  params,
}: {
  params: Record<string, string>;
}): Promise<ExtractionWithProblems | null> {
  const extractionId = params.extractionId;
  if (!extractionId) return null;
  return requireExtraction(extractionId);
}

/**
 * Endpoint 21 (plan §3.2, M1 AC 30) — `POST /api/extractions/[extractionId]/confirm`.
 * The M2 handoff point; M1 does nothing further with `CONFIRMED`. Per the
 * contract, ONLY `status === 'COMPLETE'` may be confirmed — `COMPLETE_EMPTY`
 * has nothing to confirm (its UI is the "we couldn't find any problems"
 * retake state, M1 AC 25, not a confirm button).
 */
export const POST = withAuth({
  resolveResource: resolveOwnedExtraction,
  requireFlow: ({ resource }) => resource.status === "COMPLETE",
  requireFlowMessage: "This extraction isn't ready to be confirmed yet.",
  bodySchema: extractionConfirmInputSchema,
  handler: async ({ resource: extraction }) => {
    const confirmed = await db.$transaction(async (tx) => {
      const updated = await tx.extraction.update({
        where: { id: extraction.id },
        data: { status: "CONFIRMED" },
      });
      // Defensive re-stamp of the retention anchor (M1 AC 36):
      // `lib/extraction/run-extraction.ts` already stamps this when the
      // extraction first reached COMPLETE, so the `extractedAt: null` guard
      // makes this a no-op in the normal case — it exists only so a row that
      // somehow reached COMPLETE without it (defense in depth, not an
      // expected path) still gets a retention anchor.
      await tx.upload.updateMany({
        where: { id: extraction.upload.id, extractedAt: null },
        data: { extractedAt: new Date() },
      });
      return updated;
    });

    return successResponse({ extraction: toExtractionDTO(confirmed, extraction.problems.length) });
  },
});
