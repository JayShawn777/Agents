import "server-only";

import { withAuth } from "@/lib/api/handler";
import { successResponse } from "@/lib/errors";
import { requirePracticeSet, type PracticeSetWithProblems } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { completePracticeSetInputSchema } from "@/lib/schemas/practice";
import { toPracticeSetDTO, toPracticeSetSummaryDTO } from "@/lib/practice/dto";

async function resolveOwnedPracticeSet({
  params,
}: {
  params: Record<string, string>;
}): Promise<PracticeSetWithProblems | null> {
  const practiceSetId = params.practiceSetId;
  if (!practiceSetId) return null;
  return requirePracticeSet(practiceSetId);
}

/**
 * Endpoint 34 (plan §3.2) — `POST /api/practice-sets/[practiceSetId]/complete`.
 * AC 21: the student reaching the end of a set. IDEMPOTENT — a repeat POST
 * on an already-`COMPLETE` set returns the same body and does not re-stamp
 * `finishedAt`, so a client that retries a dropped response can never
 * double-count or overwrite the original completion time.
 */
export const POST = withAuth({
  resolveResource: resolveOwnedPracticeSet,
  requireState: (set) => set.studentProfile.status === "ACTIVE",
  // Step 5: a set that is still being generated or that failed has nothing
  // to complete.
  requireFlow: ({ resource }) => resource.status !== "GENERATING" && resource.status !== "FAILED",
  requireFlowMessage: "This practice set isn't ready to be finished yet.",
  bodySchema: completePracticeSetInputSchema,
  handler: async ({ resource: set }) => {
    // Idempotent: only stamp `finishedAt`/flip to COMPLETE the FIRST time.
    const updated =
      set.status === "COMPLETE"
        ? set
        : await db.practiceSet.update({
            where: { id: set.id },
            data: { status: "COMPLETE", finishedAt: new Date() },
          });

    return successResponse({
      set: toPracticeSetDTO({ ...updated, problems: set.problems }),
      summary: toPracticeSetSummaryDTO(set.problems),
    });
  },
});
