import "server-only";

import { after } from "next/server";

import { withAuth } from "@/lib/api/handler";
import { successResponse } from "@/lib/errors";
import { requirePracticeSet, type PracticeSetWithProblems } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { practiceSetRetryInputSchema } from "@/lib/schemas/practice";
import { toPracticeSetDTO } from "@/lib/practice/dto";
import { runPracticeGeneration } from "@/lib/practice/generate";
import { MAX_PRACTICE_GENERATION_ATTEMPTS } from "@/lib/config";

export const maxDuration = 300;

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
 * Endpoint 31 (plan §3.2) — `POST /api/practice-sets/[practiceSetId]/retry`.
 * Only a terminally `FAILED` set may be retried (M2 AC 5's own invariant —
 * `FAILED` always has zero `PracticeProblem` rows, so the defensive
 * `deleteMany` below should always affect zero rows; it exists as the
 * assertion that invariant actually holds, the same posture M1's extraction
 * retry route takes toward `ExtractedProblem`).
 */
export const POST = withAuth({
  resolveResource: resolveOwnedPracticeSet,
  // Step 4, the Owner+ACTIVE consent gate. Every other M2 mutation had this
  // and only retry did not — an omission, not a decision, found in M2's
  // review on 2026-08-27. It matters more here than almost anywhere: retry
  // schedules `runPracticeGeneration`, which is an outbound Anthropic call
  // carrying a child's learner facts, and `runPracticeGeneration` performs no
  // status check of its own. Without this line a profile whose parent had
  // WITHDRAWN consent could still have new practice generated for it.
  requireState: (set) => set.studentProfile.status === "ACTIVE",
  requireFlow: ({ resource }) => resource.status === "FAILED",
  requireFlowMessage: "This practice set isn't in a state that can be retried.",
  bodySchema: practiceSetRetryInputSchema,
  rateLimit: ({ resource }) => resource.generationAttempts < MAX_PRACTICE_GENERATION_ATTEMPTS,
  handler: async ({ resource: set }) => {
    await db.practiceProblem.deleteMany({ where: { practiceSetId: set.id } });

    const updated = await db.practiceSet.update({
      where: { id: set.id },
      data: { status: "GENERATING", failureCode: null, startedAt: null, completedAt: null },
    });

    after(() => {
      runPracticeGeneration(updated.id).catch((err: unknown) => {
        console.error(`Retried runPracticeGeneration(${updated.id}) failed`, err);
      });
    });

    return successResponse({ set: toPracticeSetDTO({ ...updated, problems: [] }) }, { status: 202 });
  },
});
