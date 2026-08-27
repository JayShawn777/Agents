import "server-only";

import { fenceUntrusted, UNTRUSTED_INPUT_RULE } from "@/lib/ai/untrusted";
import type { Skill } from "@/lib/taxonomy";
import type { GradeLevel, Subject } from "@/lib/domain/enums";
import { GRADE_LEVEL_LABELS, SUBJECT_LABELS } from "@/lib/domain/enums";

/** Bump whenever the prompt's rules change in a way that could affect grading or generation quality. Recorded on `PracticeSet.promptVersion`. */
export const PRACTICE_PROMPT_VERSION = "2026-08-27.2";

/**
 * B27 (plan §5.1). Every rule here maps onto an M2 acceptance criterion or a
 * field in `lib/ai/practice-schema.ts`, mirroring `EXTRACTION_SYSTEM_PROMPT`'s
 * own convention (ADR-0005) — the prompt exists to make the model's
 * behaviour match the schema's shape, not to substitute for it.
 */
export const PRACTICE_SYSTEM_PROMPT = `You are writing fresh practice problems modelled on problems a student was \
already assigned, so they can practise the same skills without seeing the \
exact problems again.

Rules, followed exactly:

- For each source problem you are given, write a NEW problem that exercises \
the same underlying skill. The new problem's text must NOT be identical to \
its source — change the numbers, the names, the scenario, or the phrasing, \
while keeping the mathematical or conceptual content equivalent.
- Choose exactly one skillCode for each problem from the numbered menu you \
are given. Never invent a code and never write a code that is not on the \
menu — if nothing on the menu fits well, choose the closest match rather \
than inventing one.
- Preserve mathematical notation as LaTeX inside text, delimited $...$ for an \
inline expression and $$...$$ for a display expression (e.g. write \
\\frac{3}{4}, never 3/4 for a fraction). Set containsMath to true whenever \
text contains any LaTeX delimiter.
- answerFormat is your best judgement of how the answer should be entered: \
NUMERIC for a plain number, EXPRESSION for an algebraic expression or \
equation, FRACTION for a fraction or mixed number, SHORT_TEXT for a short \
word or phrase, or MULTIPLE_CHOICE when the problem is naturally a choice \
among options. For MULTIPLE_CHOICE, choices must contain 2-6 short options \
including the correct one, in no particular order; for every other format, \
choices must be an empty array.
- canonicalAnswer is the single correct answer, written plainly (a number, an \
expression, a fraction, or a short phrase — never LaTeX-delimited). \
acceptedForms lists other written forms of the SAME answer you judge a \
student should not be marked wrong for (for example, an unsimplified \
fraction, or a decimal equivalent) — leave it empty if there are none.
- workedSolution is a short, step-by-step explanation that ends by stating \
the answer. It is shown to a student only after several wrong attempts, so \
write it as a patient walkthrough, not a one-line answer key.
- Write for the grade level and subject you are given. Do not reference the \
source worksheet, a previous attempt, or the student by name — you have not \
been given a name, and none of this text should imply you have.

Report the result using only the structured fields you have been given. Do \
not add commentary, explanation, or any text outside those fields.

${UNTRUSTED_INPUT_RULE}`;

export type PracticeSourceSlot = {
  /** The (student-corrected, where present) text of the extracted problem this generated slot is modelled on. */
  sourceText: string;
  subject: Subject;
  /** From `PRACTICE_SET_DIFFICULTY_LADDER`: 0 = same level as the source, +1 = one step harder. */
  difficultyOffset: number;
};

/**
 * B27. `slots` is `PRACTICE_SET_SIZE` long, one entry per problem the model
 * must generate, in order — the model is told explicitly which source
 * problem each output slot models and at what relative difficulty, so the
 * ladder (M2's own assumption: same level, last one harder) is a property of
 * the request, not left to the model to infer. `slate` is the closed
 * candidate list (ADR-0009 §2), rendered as a numbered menu with descriptor
 * text so the model chooses from a visible menu rather than recalling a
 * notation.
 */
export function buildPracticeUserPrompt(args: {
  gradeLevel: GradeLevel;
  slots: readonly PracticeSourceSlot[];
  slate: readonly Skill[];
}): string {
  const menu = args.slate.map((skill) => `- ${skill.code}: ${skill.descriptor} (${GRADE_LEVEL_LABELS[skill.gradeLevel]})`).join("\n");

  const slots = args.slots
    .map(
      (slot, index) =>
        `${index + 1}. Source problem (${SUBJECT_LABELS[slot.subject]}):\n${fenceUntrusted("source_problem", slot.sourceText)}\n   Difficulty relative to the source: ${
          slot.difficultyOffset === 0 ? "same level" : `${slot.difficultyOffset} step(s) harder`
        }`,
    )
    .join("\n");

  return `The student's grade level is ${GRADE_LEVEL_LABELS[args.gradeLevel]}.

Skill menu — choose skillCode ONLY from this list:
${menu}

Write exactly ${args.slots.length} new problems, one for each numbered source problem below, in the same order:
${slots}`;
}
