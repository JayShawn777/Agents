import "server-only";

import type { Attempt, PracticeAnswerKey, PracticeProblem, PracticeSet, SkillMastery } from "@/lib/generated/prisma/client";
import type {
  AttemptDTO,
  FeedbackDTO,
  PracticeProblemDTO,
  PracticeSetDTO,
  PracticeSetSummaryDTO,
  SkillMasteryDTO,
} from "@/lib/schemas/dto";
import {
  ERROR_MESSAGES,
  GENERATION_FAILURE_CODES,
  GENERATION_FAILURE_MESSAGES,
  type GenerationFailureCode,
} from "@/lib/errors";
import { resolveSkill } from "@/lib/taxonomy";
import { renderMathText } from "@/lib/math/render";
import type { GradeLevel } from "@/lib/domain/enums";

/**
 * Mapping functions for the M2 practice DTOs (plan §3, S18 / B29). Mirrors
 * `lib/uploads/dto.ts` and `lib/students/dto.ts`: this is the ONLY place
 * these shapes are built from Prisma rows, and — the load-bearing property
 * of this specific module (ADR-0011 §5, M2 AC 17) — it is the ONLY place
 * that turns a row which may carry `PracticeAnswerKey.workedSolution`
 * (`lib/auth/dal.ts`'s `PracticeSetWithProblems`) into something a client
 * sees, and it does so ONLY when the problem is already `revealed`.
 *
 * `tests/unit/lib/practice/dto.test.ts` is the enforcement: it asserts every
 * DTO's key set exactly (so a server-only field can never be added by a
 * future convenience, M2 AC 20) and it asserts `toPracticeProblemDTO` nulls
 * `workedSolution`/`workedSolutionHtml` even when the input row's
 * `answerKey.workedSolution` is populated but `revealed` is false — the
 * regression AC 17 is actually about, not merely a snapshot of today's
 * output.
 */

// A minimal structural shape rather than a Prisma `GetPayload` type: both
// call sites that feed this function (`requirePracticeSet`'s DAL row, and
// the ad-hoc `db.practiceSet.findMany` query on the student's own page)
// return objects that are supersets of this shape, so either satisfies it
// with no cast.
type PracticeSetForDTO = Pick<PracticeSet, "id" | "extractionId" | "status" | "failureCode" | "createdAt" | "finishedAt"> & {
  problems: { ordinal: number; attempts: { id: string }[] }[];
};

export function toPracticeSetDTO(set: PracticeSetForDTO): PracticeSetDTO {
  const sorted = [...set.problems].sort((a, b) => a.ordinal - b.ordinal);
  const answeredCount = sorted.filter((problem) => problem.attempts.length > 0).length;
  const firstUnanswered = sorted.find((problem) => problem.attempts.length === 0);

  return {
    id: set.id,
    extractionId: set.extractionId,
    status: set.status,
    problemCount: set.problems.length,
    answeredCount,
    resumeOrdinal: firstUnanswered ? firstUnanswered.ordinal : null,
    failureMessage: mapGenerationFailureCodeToMessage(set.failureCode),
    createdAt: set.createdAt.toISOString(),
    finishedAt: set.finishedAt ? set.finishedAt.toISOString() : null,
  };
}

/**
 * M2 AC 6 / plan §2: `PracticeSet.failureCode` is an internal code, never
 * returned verbatim. An unrecognized value (a future failure mode this
 * allowlist hasn't caught up with yet) falls back to the generic internal
 * error message rather than leaking anything about it.
 */
function mapGenerationFailureCodeToMessage(failureCode: string | null): string | null {
  if (failureCode === null) return null;
  if ((GENERATION_FAILURE_CODES as readonly string[]).includes(failureCode)) {
    return GENERATION_FAILURE_MESSAGES[failureCode as GenerationFailureCode];
  }
  return ERROR_MESSAGES.INTERNAL_ERROR;
}

// The exact shape `requirePracticeSet` (`lib/auth/dal.ts`) produces per
// problem — the ONLY row shape this function is ever called with.
type PracticeProblemForDTO = PracticeProblem & {
  attempts: Pick<Attempt, "revealed">[];
  answerKey: Pick<PracticeAnswerKey, "workedSolution"> | null;
};

/**
 * AC 9, AC 12, AC 17. `revealed` is DERIVED — there is no `revealed` column
 * on `PracticeProblem` itself (a deliberate reading of an under-specified
 * corner of the plan, recorded in this milestone's report): the reveal
 * endpoint (`POST /api/practice-problems/[id]/reveal`) marks the triggering
 * `Attempt` row's own `revealed` flag, so "is this problem revealed" is
 * "does any attempt on it carry `revealed: true`" — true once, forever,
 * across every future read, exactly like a persisted boolean would be.
 *
 * `workedSolution`/`workedSolutionHtml` are gated HERE, not merely at the
 * database-select layer (`lib/auth/dal.ts`'s docstring on
 * `PracticeSetWithProblems` explains why the select alone isn't sufficient
 * to withhold `workedSolution` pre-reveal): even if a future caller's query
 * changes shape and a row's `answerKey.workedSolution` is populated before
 * the reveal gate has been passed, this function still nulls it out. That
 * is the property `tests/unit/lib/practice/dto.test.ts` exercises directly.
 */
export function toPracticeProblemDTO(problem: PracticeProblemForDTO): PracticeProblemDTO {
  const revealed = problem.attempts.some((attempt) => attempt.revealed);
  const skill = resolveSkill(problem.skillCode);
  if (!skill) {
    console.error(`toPracticeProblemDTO: unresolvable skillCode "${problem.skillCode}" for problem ${problem.id}`);
  }
  const workedSolutionRaw = revealed ? (problem.answerKey?.workedSolution ?? null) : null;

  return {
    id: problem.id,
    ordinal: problem.ordinal,
    text: problem.text,
    textHtml: renderMathText(problem.text),
    containsMath: problem.containsMath,
    answerFormat: problem.answerFormat,
    choices: problem.choices,
    skillCode: problem.skillCode,
    skillDescriptor: skill?.descriptor ?? "this skill",
    // ADR-0009 §3's "fall back to a neutral label" has no neutral GradeLevel
    // member to fall back to (a closed enum with no "unknown" case). This can
    // only be reached if the taxonomy file changes between when a problem
    // was generated and when it is read, which persistence-time validation
    // (`lib/practice/generate.ts`) makes rare by construction. Logged above;
    // defaulting to the lowest grade band is the least-alarming guess.
    skillGradeLevel: skill?.gradeLevel ?? ("KINDERGARTEN" satisfies GradeLevel),
    attemptCount: problem.attempts.length,
    revealed,
    workedSolution: workedSolutionRaw,
    workedSolutionHtml: workedSolutionRaw ? renderMathText(workedSolutionRaw) : null,
  };
}

export function toAttemptDTO(attempt: Attempt): AttemptDTO {
  return {
    id: attempt.id,
    practiceProblemId: attempt.practiceProblemId,
    attemptNumber: attempt.attemptNumber,
    submittedAnswer: attempt.submittedAnswer,
    result: attempt.result,
    createdAt: attempt.createdAt.toISOString(),
  };
}

export function toSkillMasteryDTO(mastery: SkillMastery): SkillMasteryDTO {
  const skill = resolveSkill(mastery.skillCode);
  return {
    skillCode: mastery.skillCode,
    skillDescriptor: skill?.descriptor ?? "this skill",
    level: mastery.level,
    // AC 20: a COUNT of problems practised — `attemptCount` only ever rises.
    problemsPracticed: mastery.attemptCount,
    lastPracticedAt: mastery.lastPracticedAt ? mastery.lastPracticedAt.toISOString() : null,
  };
}

/**
 * AC 11: post-checked to contain neither the canonical answer nor any
 * accepted form (`lib/grading/adjudicate.ts`'s `stripAnswerFromHint`) before
 * it ever reaches this builder — this function trusts its `hint` argument
 * and does not re-check it, so the ONE place that check may be skipped is
 * whichever caller fails to run it first (asserted directly against
 * `lib/grading/grade.ts` and `lib/grading/adjudicate.ts` in their own tests).
 */
export function toFeedbackDTO(args: {
  result: FeedbackDTO["result"];
  message: string;
  hint: string | null;
  attemptsRemainingBeforeReveal: number;
}): FeedbackDTO {
  return {
    result: args.result,
    message: args.message,
    hint: args.hint,
    hintHtml: args.hint ? renderMathText(args.hint) : null,
    retryOffered: args.result !== "CORRECT",
    attemptsRemainingBeforeReveal: Math.max(0, args.attemptsRemainingBeforeReveal),
    revealAvailable: args.attemptsRemainingBeforeReveal <= 0,
  };
}

/**
 * AC 21. `problems` here is a practice set's FULL problem list (with their
 * attempts) at completion time — the endpoint 34 handler passes exactly the
 * rows `requirePracticeSet` already loaded. Progress framing, no mark: only
 * skill names and plain counts, both of which the caller has already
 * guaranteed are monotonic (a completed set's attempt counts never fall).
 */
export function toPracticeSetSummaryDTO(problems: PracticeProblemForDTO[]): PracticeSetSummaryDTO {
  const bySkill = new Map<string, { descriptor: string; count: number }>();
  let totalAnswered = 0;

  for (const problem of problems) {
    if (problem.attempts.length === 0) continue;
    totalAnswered += 1;
    const existing = bySkill.get(problem.skillCode);
    if (existing) {
      existing.count += 1;
    } else {
      bySkill.set(problem.skillCode, {
        descriptor: resolveSkill(problem.skillCode)?.descriptor ?? "this skill",
        count: 1,
      });
    }
  }

  return {
    skills: [...bySkill.entries()].map(([skillCode, value]) => ({
      skillCode,
      skillDescriptor: value.descriptor,
      problemsAnswered: value.count,
    })),
    totalAnswered,
    // M2 open question — ASSUMPTION: one fixed, allowlisted framing message.
    // AC 21 asks for progress framing, not a specific pool of copy.
    message: "Nice work — here's what you practiced.",
  };
}
