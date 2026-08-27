import "server-only";

import type { Skill } from "@/lib/taxonomy";
import type { GradeLevel } from "@/lib/domain/enums";
import { GRADE_LEVEL_LABELS } from "@/lib/domain/enums";

/** Bump whenever these rules change in a way that could affect what a checkpoint asks. Recorded on `PracticeSet.promptVersion`. */
export const CHECKPOINT_PROMPT_VERSION = "2026-08-27.1";

/**
 * The checkpoint generation prompt (spec AC 7-8, plan §3).
 *
 * It differs from `lib/practice/prompt.ts` in one structural way: practice is
 * modelled on a source problem the student was assigned, and a checkpoint is
 * not. There is no worksheet behind it — only a skill the student has already
 * practised somewhere else, days or weeks ago.
 *
 * **Nothing in this prompt is attacker-reachable, and that is worth stating
 * because the absence of `UNTRUSTED_INPUT_RULE` would otherwise look like an
 * oversight.** Every interpolated value originates inside the app: skill codes
 * and descriptors come from the bundled taxonomy (ADR-0009), the grade level is
 * a closed Prisma enum. No photograph, no student typing, no extracted text
 * reaches here — unlike practice generation, which carries a worksheet's text
 * and is fenced by `lib/ai/untrusted.ts` for exactly that reason. If a future
 * change threads any student-supplied string into this file, it needs the fence
 * and this paragraph needs deleting.
 */
export const CHECKPOINT_SYSTEM_PROMPT = `You are writing a short check-in for a student, to find out whether \
skills they practised a while ago have stuck.

Rules, followed exactly:

- For each numbered skill you are given, write ONE problem that tests that \
skill directly. Choose its skillCode from the numbered menu — never invent a \
code and never use one that is not on the menu.
- Pitch each problem at the level a student working on that skill would \
already have met. This is a check, not a challenge: do not make it harder to \
be thorough, and do not introduce a second skill the problem also depends on.
- Vary the surface. The student has seen problems on these skills before, so \
change the numbers, the names and the situation. A problem they can answer \
from memory of a specific earlier question tests nothing.
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
student should not be marked wrong for — leave it empty if there are none.
- workedSolution is a short, step-by-step explanation that ends by stating \
the answer. A student does not see it during a check-in, but it is kept so it \
can be shown later, so write it as a patient walkthrough.
- Write for the grade level you are given. Do not mention that this is a \
test, a quiz or a check, do not reference the student's past performance, and \
do not address the student by name — you have not been given one.

Report the result using only the structured fields you have been given. Do \
not add commentary, explanation, or any text outside those fields.`;

/**
 * `skillsInOrder` is `CHECKPOINT_SIZE` long, one entry per problem, in the
 * order `lib/checkpoints/compose.ts` produced — oldest-practised first. It may
 * legitimately repeat a skill: a student with three eligible skills and a
 * size of eight gets each of them more than once, and the model is told to
 * vary the surface so the repeats are not the same question twice.
 *
 * The menu is deduplicated because it is a menu; the slots are not, because
 * they are the running order.
 */
export function buildCheckpointUserPrompt(args: {
  gradeLevel: GradeLevel;
  skillsInOrder: readonly Skill[];
}): string {
  const seen = new Set<string>();
  const menu = args.skillsInOrder
    .filter((skill) => !seen.has(skill.code) && seen.add(skill.code))
    .map((skill) => `- ${skill.code}: ${skill.descriptor}`)
    .join("\n");

  const slots = args.skillsInOrder
    .map((skill, index) => `${index + 1}. ${skill.code} — ${skill.descriptor}`)
    .join("\n");

  return `The student's grade level is ${GRADE_LEVEL_LABELS[args.gradeLevel]}.

Skill menu — choose skillCode ONLY from this list:
${menu}

Write exactly ${args.skillsInOrder.length} problems, one for each numbered skill below, in this order:
${slots}`;
}
