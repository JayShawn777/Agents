import "server-only";

import { after } from "next/server";

import { withAuth } from "@/lib/api/handler";
import { successResponse } from "@/lib/errors";
import { requireExtraction, type ExtractionWithProblems } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { extractionRetryInputSchema } from "@/lib/schemas/extraction";
import { runExtraction } from "@/lib/extraction/run-extraction";
import { toExtractionDTO } from "@/lib/uploads/dto";
import { MAX_EXTRACTION_ATTEMPTS } from "@/lib/config";

/** Same reason as `POST /api/uploads/confirm`: extraction runs past this response via `after()`. */
export const maxDuration = 300;

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
 * Endpoint 20 (plan §3.2) — `POST /api/extractions/[extractionId]/retry`.
 * `attemptCount` is owned entirely by `lib/extraction/run-extraction.ts`
 * (incremented once per actual run, including this one) — this route only
 * flips the row back to `PENDING` and reschedules the run, so the cap check
 * below reads the count of attempts that have ALREADY happened rather than
 * a count this route would otherwise have to keep in sync with the status
 * machine's own bookkeeping.
 */
export const POST = withAuth({
  resolveResource: resolveOwnedExtraction,
  bodySchema: extractionRetryInputSchema,
  // Step 5 (409): only a terminally FAILED extraction can be retried.
  requireFlow: ({ resource }) => resource.status === "FAILED",
  requireFlowMessage: "This extraction isn't in a state that can be retried.",
  // Step 7 (429): above the attempt cap, checked last per ADR-0006 ordering.
  rateLimit: ({ resource }) => resource.attemptCount < MAX_EXTRACTION_ATTEMPTS,
  handler: async ({ resource: extraction }) => {
    const updated = await db.extraction.update({
      where: { id: extraction.id },
      data: { status: "PENDING" },
    });

    after(() => {
      runExtraction(updated.id).catch((err: unknown) => {
        console.error(`Retried runExtraction(${updated.id}) failed`, err);
      });
    });

    // A FAILED extraction always has zero ExtractedProblem rows (AC 23), so
    // `extraction.problems.length` (loaded before this retry) is `0` here.
    return successResponse(
      { extraction: toExtractionDTO(updated, extraction.problems.length) },
      { status: 202 },
    );
  },
});
