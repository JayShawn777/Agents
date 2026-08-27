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
  // Step 5: AC — a set that is still generating or has failed has nothing to submit against.
  requireFlow: ({ resource }) => resource.practiceSet.status !== "FAILED" && resource.practiceSet.status !== "GENERATING",
  bodySchema: submitAttemptInputSchema,
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
