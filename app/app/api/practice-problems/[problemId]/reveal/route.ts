import "server-only";

import { withAuth } from "@/lib/api/handler";
import { successResponse } from "@/lib/errors";
import { requirePracticeAnswerKey, requirePracticeProblem, type PracticeProblemWithContext } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { revealPracticeProblemInputSchema } from "@/lib/schemas/practice";
import { renderMathText } from "@/lib/math/render";
import { ATTEMPTS_BEFORE_REVEAL } from "@/lib/config";

async function resolveOwnedProblem({
  params,
}: {
  params: Record<string, string>;
}): Promise<PracticeProblemWithContext | null> {
  const problemId = params.problemId;
  if (!problemId) return null;
  return requirePracticeProblem(problemId);
}

/**
 * Endpoint 33 (plan §3.2) — `POST /api/practice-problems/[problemId]/reveal`.
 * ADR-0011 §5: this 409 gate is what makes M2 AC 17 real rather than
 * decorative — without it a client could simply call reveal first. Gated on
 * the count of `INCORRECT` attempts reaching `ATTEMPTS_BEFORE_REVEAL`
 * (M2 AC 12), independent of whether the problem has already been revealed —
 * so a repeat call is naturally idempotent (the gate's condition can only
 * become MORE true over time, never less).
 *
 * This is one of only two places (with `lib/grading/grade.ts`) that may load
 * a `PracticeAnswerKey` — both through `requirePracticeAnswerKey`
 * (`lib/auth/dal.ts`), never a bare query of their own.
 *
 * DECISION, FLAGGED: the plan's schema has no persisted `revealed` column on
 * `PracticeProblem` (see `lib/practice/dto.ts`'s docstring on
 * `toPracticeProblemDTO`). This handler marks the MOST RECENT attempt on the
 * problem `revealed: true` — the attempt that satisfied the gate — which is
 * what every later read (`toPracticeProblemDTO`'s `attempts.some(a =>
 * a.revealed)`) treats as "this problem has been revealed," permanently.
 */
export const POST = withAuth({
  resolveResource: resolveOwnedProblem,
  requireState: (problem) => problem.practiceSet.studentProfile.status === "ACTIVE",
  requireFlow: ({ resource }) => {
    const incorrectCount = resource.attempts.filter((attempt) => attempt.result === "INCORRECT").length;
    return incorrectCount >= ATTEMPTS_BEFORE_REVEAL;
  },
  requireFlowMessage: "Keep trying a little longer before we show you how it's done.",
  bodySchema: revealPracticeProblemInputSchema,
  handler: async ({ resource: problem }) => {
    const key = await requirePracticeAnswerKey(problem.id);
    if (!key) {
      // Invariant violation — see `lib/grading/grade.ts`'s identical guard.
      console.error(`reveal route: no PracticeAnswerKey for practiceProblemId "${problem.id}".`);
      return successResponse(
        { workedSolution: "", workedSolutionHtml: "", canonicalAnswer: "" },
        { status: 200 },
      );
    }

    const latestAttempt = problem.attempts.at(-1);
    if (latestAttempt && !latestAttempt.revealed) {
      await db.attempt.update({ where: { id: latestAttempt.id }, data: { revealed: true } });
    }

    return successResponse({
      workedSolution: key.workedSolution,
      workedSolutionHtml: renderMathText(key.workedSolution),
      canonicalAnswer: key.canonicalAnswer,
    });
  },
});
