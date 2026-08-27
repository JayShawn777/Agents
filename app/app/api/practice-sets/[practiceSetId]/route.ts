import "server-only";

import { withAuth } from "@/lib/api/handler";
import { successResponse } from "@/lib/errors";
import { requirePracticeSet, type PracticeSetWithProblems } from "@/lib/auth/dal";
import { toAttemptDTO, toPracticeProblemDTO, toPracticeSetDTO } from "@/lib/practice/dto";
import { reapIfStalePracticeSet } from "@/lib/practice/generate";

async function resolveOwnedPracticeSet({
  params,
}: {
  params: Record<string, string>;
}): Promise<PracticeSetWithProblems | null> {
  const practiceSetId = params.practiceSetId;
  if (!practiceSetId) return null;
  const set = await requirePracticeSet(practiceSetId);
  if (!set) return null;
  return reapIfStalePracticeSet(set);
}

/**
 * Endpoint 30 (plan §3.2) — `GET /api/practice-sets/[practiceSetId]`.
 * Polled every 2s while `GENERATING` (`components/practice/generating-state.tsx`,
 * frontend track). Lazily transitions a stale `GENERATING` set (older than
 * `PRACTICE_GENERATION_TIMEOUT_MS + 30s`) to `FAILED`, mirroring
 * `lib/extraction/run-extraction.ts`'s `reapIfStale` — a client polling a
 * set whose generating function died mid-flight must still always reach a
 * terminal state.
 *
 * `attempts` is a FLAT list across every problem in the set (plan §3.1's
 * `PracticeSetDetailResponse`), never nested under each problem.
 */
export const GET = withAuth({
  resolveResource: resolveOwnedPracticeSet,
  handler: async ({ resource: set }) => {
    const sortedProblems = [...set.problems].sort((a, b) => a.ordinal - b.ordinal);
    return successResponse({
      set: toPracticeSetDTO(set),
      problems: sortedProblems.map((problem) => toPracticeProblemDTO(problem)),
      attempts: sortedProblems.flatMap((problem) => problem.attempts.map((attempt) => toAttemptDTO(attempt))),
    });
  },
});
