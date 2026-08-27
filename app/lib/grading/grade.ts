import "server-only";

import { requirePracticeAnswerKey } from "@/lib/auth/dal";
import { adjudicate } from "@/lib/grading/adjudicate";
import { answersEquivalent } from "@/lib/grading/normalize";
import type { OutboundLearnerFacts } from "@/lib/ai/outbound";
import type { AnswerFormat, AttemptResult, GradedBy } from "@/lib/domain/enums";

/**
 * ADR-0011 (B33). Composes stage one (`lib/grading/normalize.ts`) then
 * stage two (`lib/grading/adjudicate.ts`) then the third, honest outcome —
 * `UNSCORED` is a first-class result, never an error, and never rendered or
 * stored as "wrong" (M2 AC 14).
 *
 * Together with the reveal handler, this is one of the only two places that
 * may load a `PracticeAnswerKey` row (ADR-0011 §5) — both call
 * `requirePracticeAnswerKey` (`lib/auth/dal.ts`), never a bare
 * `db.practiceAnswerKey.findUnique` of their own.
 */

export type GradeOutcome = {
  result: AttemptResult;
  gradedBy: GradedBy;
  /** AC 11: post-checked upstream (`lib/grading/adjudicate.ts`'s `stripAnswerFromHint`) to exclude the canonical answer and every accepted form. `null` whenever there is nothing problem-specific to say — see this module's own docstring section below for exactly when. */
  hint: string | null;
  /** Allowlisted framing copy (AC 6/§2's pattern) — never a raw model string. */
  message: string;
};

/**
 * Fixed, allowlisted framing copy (M2 AC 11, AC 14). `UNSCORED`'s wording is
 * ADR-0011 §3's own quoted example, verbatim: the student is invited to try
 * again a different way, and is at no point told they are wrong.
 */
const FEEDBACK_MESSAGES: Record<AttemptResult, string> = {
  CORRECT: "That's correct!",
  INCORRECT: "Not quite right yet — take another look and try again.",
  UNSCORED: "I'm not sure about that one — want to try writing it a different way?",
};

/**
 * Grades one submitted answer against `practiceProblemId`'s answer key.
 *
 * WHY `hint` is `null` for a stage-one (`NORMALIZER`) decision, correct or
 * incorrect: ADR-0011's whole premise is that the common case — a number, a
 * fraction, a decimal — "costs nothing and returns instantly," and that
 * "only genuinely ambiguous submissions pay for a model call" (§ Positive
 * consequences; the plan's own risk table prices "a grading call on every
 * AMBIGUOUS answer", not on every incorrect one). Manufacturing a
 * problem-specific hint would require understanding the problem, which the
 * deterministic normaliser cannot do — so a stage-one `INCORRECT` gets the
 * fixed encouragement message above and no hint, while a stage-two
 * (`MODEL`) verdict carries a real, problem-specific, post-checked hint.
 * This is a design decision this milestone made where the plan did not
 * specify one; see this milestone's report.
 */
export async function gradeSubmission(args: {
  practiceProblemId: string;
  submittedAnswer: string;
  answerFormat: AnswerFormat;
  problemText: string;
  facts: OutboundLearnerFacts;
}): Promise<GradeOutcome> {
  const key = await requirePracticeAnswerKey(args.practiceProblemId);
  if (!key) {
    // Invariant violation: every PracticeProblem gets its PracticeAnswerKey
    // in the SAME transaction at generation time
    // (`lib/practice/generate.ts`'s `finalizeSuccess`). Logged loudly;
    // treated as UNSCORED rather than throwing mid-request, so a data bug
    // never turns into a broken submission for the student (ADR-0011 §3's
    // "degrades gracefully" principle, extended to this case too).
    console.error(`gradeSubmission: no PracticeAnswerKey for practiceProblemId "${args.practiceProblemId}".`);
    return unscored();
  }

  const stageOne = answersEquivalent(args.submittedAnswer, key.canonicalAnswer, key.acceptedForms, args.answerFormat);
  if (stageOne === true) {
    return { result: "CORRECT", gradedBy: "NORMALIZER", hint: null, message: FEEDBACK_MESSAGES.CORRECT };
  }
  if (stageOne === false) {
    return { result: "INCORRECT", gradedBy: "NORMALIZER", hint: null, message: FEEDBACK_MESSAGES.INCORRECT };
  }

  // stageOne === null: the normaliser cannot decide. Stage two.
  const adjudication = await adjudicate({
    facts: args.facts,
    problemText: args.problemText,
    answerFormat: args.answerFormat,
    canonicalAnswer: key.canonicalAnswer,
    acceptedForms: key.acceptedForms,
    submittedAnswer: args.submittedAnswer,
  });

  if (adjudication.outcome === "CORRECT") {
    return { result: "CORRECT", gradedBy: "MODEL", hint: null, message: FEEDBACK_MESSAGES.CORRECT };
  }
  if (adjudication.outcome === "INCORRECT") {
    return { result: "INCORRECT", gradedBy: "MODEL", hint: adjudication.hint, message: FEEDBACK_MESSAGES.INCORRECT };
  }
  // "UNSURE" (the model genuinely could not decide) and "UPSTREAM_FAILURE"
  // (a refusal, a null parse, a timeout, any other upstream error) are BOTH
  // UNSCORED (ADR-0011 §3) — an outage degrades practice to "answers are
  // recorded, nothing is judged," never to an error page mid-set.
  return unscored();
}

function unscored(): GradeOutcome {
  return { result: "UNSCORED", gradedBy: "UNGRADED", hint: null, message: FEEDBACK_MESSAGES.UNSCORED };
}
