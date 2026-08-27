import "server-only";

import { withAuth } from "@/lib/api/handler";
import { successResponse } from "@/lib/errors";
import { requireExtraction, type ExtractionWithProblems } from "@/lib/auth/dal";
import { reapIfStale } from "@/lib/extraction/run-extraction";
import { toExtractedProblemDTO, toExtractionDTO } from "@/lib/uploads/dto";

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
 * Endpoint 19 (plan §3.2, M1 AC 18) — `GET /api/extractions/[extractionId]`.
 * Polled every 2s by the client while `PENDING`/`RUNNING`. Lazily reaps a
 * stale `RUNNING` row into `FAILED` before responding (M1 AC 27) — see
 * `lib/extraction/run-extraction.ts`'s `reapIfStale` docstring for why this
 * has to live on the read path rather than a background job alone.
 */
export const GET = withAuth({
  resolveResource: resolveOwnedExtraction,
  handler: async ({ resource: extraction }) => {
    const current = await reapIfStale(extraction);
    // `reapIfStale` never touches `ExtractedProblem` rows (a reaped
    // extraction was never anything but RUNNING with zero problems, per
    // AC 23's "no partial extraction"), so `extraction.problems` — loaded by
    // `requireExtraction` before the reap ran — is still accurate.
    return successResponse({
      extraction: toExtractionDTO(current, extraction.problems.length),
      problems: extraction.problems.map(toExtractedProblemDTO),
    });
  },
});
