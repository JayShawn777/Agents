import "server-only";

import { withAuth } from "@/lib/api/handler";
import { successResponse } from "@/lib/errors";
import { requirePracticeProblem, type PracticeProblemWithContext } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import type { Attempt, SkillMastery } from "@/lib/generated/prisma/client";
import { submitAttemptInputSchema } from "@/lib/schemas/practice";
import { gradeSubmission } from "@/lib/grading/grade";
import { applyMastery } from "@/lib/mastery/apply";
import { toAttemptDTO, toFeedbackDTO, toSkillMasteryDTO } from "@/lib/practice/dto";
import { resolveSkill } from "@/lib/taxonomy";
import type { Subject } from "@/lib/domain/enums";
import { ATTEMPTS_BEFORE_REVEAL, ATTEMPTS_PER_HOUR, MAX_ATTEMPTS_PER_PROBLEM } from "@/lib/config";

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
 * Endpoint 32 (plan §3.2) — `POST /api/practice-problems/[problemId]/attempts`.
 * Grading runs synchronously (ADR-0011): normaliser, then model on a miss,
 * then `UNSCORED`. Mastery is applied in the SAME database transaction as
 * the `Attempt` row's creation (ADR-0010 §3's exactly-once guard needs the
 * row to already exist).
 *
 * AC 10 / AC 15 / AC 16 are ALL enforced before this handler ever runs:
 * `.trim().min(1)` (AC 15, no attempt row for an empty/whitespace body) and
 * `.max(PRACTICE_ANSWER_MAX_LENGTH)` (AC 16) are the zod schema itself
 * (`lib/schemas/practice.ts`), checked at `withAuth()`'s step 6. The
 * `@@unique([practiceProblemId, attemptNumber])` constraint is what makes a
 * double-submit (two racing requests attempting the SAME ordinal) a
 * `P2002`, retried once with a freshly counted `attemptNumber` — the same
 * "idempotent create, retried on a lost race" shape as
 * `lib/uploads/record-upload.ts`.
 */
export const POST = withAuth({
  resolveResource: resolveOwnedProblem,
  requireState: (problem) => problem.practiceSet.studentProfile.status === "ACTIVE",
  // Step 5, three preconditions, each with its own reason.
  //
  //   a) A set still generating, or failed, has nothing to submit against.
  //   b) A CHECKPOINT problem takes exactly ONE answer (M2.5 AC 11). That is
  //      the single behavioural difference between a checkpoint and practice,
  //      and it lives here rather than in the schema (ADR-0017).
  //   c) `MAX_ATTEMPTS_PER_PROBLEM` — the ceiling `ATTEMPTS_BEFORE_REVEAL`
  //      never was. Without it a problem accepts answers forever, which is
  //      both the spec's named product failure (a child grinding one problem
  //      "stuck in a loop feeling stupid") and an unbounded bill, since any
  //      answer the normalizer cannot decide reaches Anthropic (ADR-0011 §2).
  //
  // Until 2026-08-27 these shared one static string written for (c), which was
  // tolerable while (a) was unreachable through the UI. (b) makes it
  // untenable: telling a child they have given it "a good go" after one answer
  // is worse than unhelpful. `requireFlowMessage` takes a function of the
  // resource now — the branches below must stay in the same order as the
  // predicate above, or a child gets the wrong explanation.
  requireFlow: ({ resource }) =>
    resource.practiceSet.status !== "FAILED" &&
    resource.practiceSet.status !== "GENERATING" &&
    !(resource.practiceSet.kind === "CHECKPOINT" && resource.attempts.length >= 1) &&
    resource.attempts.length < MAX_ATTEMPTS_PER_PROBLEM,
  requireFlowMessage: (problem) => {
    if (problem.practiceSet.status === "FAILED" || problem.practiceSet.status === "GENERATING") {
      return "This isn't ready yet — give it a moment and refresh.";
    }
    if (problem.practiceSet.kind === "CHECKPOINT") {
      return "That's your answer for this one. A checkpoint takes one try each — on to the next.";
    }
    return "You've given this one a good go. Take a look at how it's done, then try the next problem.";
  },
  bodySchema: submitAttemptInputSchema,
  // Step 7: the hourly attempt cap, counted per student profile against the
  // existing `@@index([studentProfileId, createdAt])`. This route reaches
  // Anthropic on every stage-one grading miss and a miss is trivial to force
  // ("x" against a NUMERIC problem misses deterministically), so without this
  // one authenticated account can buy model calls in a loop. Its sibling
  // generation route has had `PRACTICE_SETS_PER_HOUR` since M2; this one was
  // missed.
  rateLimit: async ({ resource }) => {
    const windowStart = new Date(Date.now() - 60 * 60 * 1000);
    const count = await db.attempt.count({
      where: { studentProfileId: resource.practiceSet.studentProfileId, createdAt: { gte: windowStart } },
    });
    return count < ATTEMPTS_PER_HOUR;
  },
  handler: async ({ resource: problem, body }) => {
    const alreadyRevealed = problem.attempts.some((attempt) => attempt.revealed);

    const subject: Subject = resolveSkill(problem.skillCode)?.subject ?? "MATH";
    // Every problem this route can ever be called against was generated
    // AFTER its student profile had a gradeLevel (`lib/practice/generate.ts`
    // refuses generation with SLATE_EMPTY otherwise) — the fallback below is
    // defensive only, logged rather than silently guessed at.
    const gradeLevel = problem.practiceSet.studentProfile.gradeLevel;
    if (!gradeLevel) {
      console.error(`attempts route: PracticeProblem ${problem.id}'s student profile has no gradeLevel.`);
    }

    const grade = await gradeSubmission({
      practiceProblemId: problem.id,
      submittedAnswer: body.answer,
      answerFormat: problem.answerFormat,
      problemText: problem.text,
      facts: { gradeLevel: gradeLevel ?? "GRADE_4", subject },
    });

    const { attempt, mastery } = await createAttemptAndApplyMastery({
      problem,
      submittedAnswer: body.answer,
      elapsedMs: body.elapsedMs ?? null,
      result: grade.result,
      gradedBy: grade.gradedBy,
      hint: grade.hint,
      postReveal: alreadyRevealed,
    });

    const incorrectCount = problem.attempts.filter((a) => a.result === "INCORRECT").length + (grade.result === "INCORRECT" ? 1 : 0);
    const attemptsRemainingBeforeReveal = Math.max(0, ATTEMPTS_BEFORE_REVEAL - incorrectCount);

    const masteryDTO = mastery
      ? toSkillMasteryDTO(mastery)
      : {
          skillCode: problem.skillCode,
          skillDescriptor: resolveSkill(problem.skillCode)?.descriptor ?? "this skill",
          level: "NOT_STARTED" as const,
          problemsPracticed: 0,
          lastPracticedAt: null,
        };

    return successResponse(
      {
        attempt: toAttemptDTO(attempt),
        feedback: toFeedbackDTO({
          result: grade.result,
          message: grade.message,
          hint: grade.hint,
          attemptsRemainingBeforeReveal,
        }),
        mastery: masteryDTO,
      },
      { status: 201 },
    );
  },
});

async function createAttemptAndApplyMastery(args: {
  problem: PracticeProblemWithContext;
  submittedAnswer: string;
  elapsedMs: number | null;
  result: "CORRECT" | "INCORRECT" | "UNSCORED";
  gradedBy: "NORMALIZER" | "MODEL" | "UNGRADED";
  hint: string | null;
  postReveal: boolean;
}): Promise<{ attempt: Attempt; mastery: SkillMastery | null }> {
  for (let retry = 0; retry < 2; retry++) {
    try {
      return await db.$transaction(async (tx) => {
        const attemptNumber = (await tx.attempt.count({ where: { practiceProblemId: args.problem.id } })) + 1;
        const attempt = await tx.attempt.create({
          data: {
            practiceProblemId: args.problem.id,
            studentProfileId: args.problem.practiceSet.studentProfileId,
            attemptNumber,
            submittedAnswer: args.submittedAnswer,
            result: args.result,
            gradedBy: args.gradedBy,
            hint: args.hint,
            elapsedMs: args.elapsedMs,
          },
        });

        // Flip the set to IN_PROGRESS on its first attempt (idempotent — a
        // set already IN_PROGRESS or COMPLETE is left alone).
        await tx.practiceSet.updateMany({
          where: { id: args.problem.practiceSetId, status: "READY" },
          data: { status: "IN_PROGRESS" },
        });

        const mastery = await applyMastery(tx, {
          attemptId: attempt.id,
          studentProfileId: args.problem.practiceSet.studentProfileId,
          skillCode: args.problem.skillCode,
          practiceSetId: args.problem.practiceSetId,
          result: args.result,
          gradedBy: args.gradedBy,
          postReveal: args.postReveal,
        });

        return { attempt, mastery };
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && retry === 0) {
        continue;
      }
      throw err;
    }
  }
  throw new Error("createAttemptAndApplyMastery: unreachable");
}
