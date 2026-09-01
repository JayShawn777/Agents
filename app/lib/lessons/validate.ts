import {
  referencedIds,
  type DrawOp,
  type LessonScript,
} from "@/lib/lessons/script-schema";
import { isSpeakableNarration } from "@/lib/narration/speakable";

/**
 * The post-parse check ADR-0014's follow-up requires, and the reason a zod pass
 * is not enough.
 *
 * `LessonScriptSchema` proves every op is *shaped* correctly. It cannot prove
 * that `{ kind: 'circle', target: 'x_term' }` refers to something that exists,
 * because zod validates a value against a shape and has no view of the document
 * around it. A script that circles an element nobody wrote parses cleanly and
 * then renders as an annotation floating over nothing — AC 3's "blank canvas in
 * front of a child", arrived at through the one door the schema leaves open.
 *
 * Three rules, all structural:
 *
 *   1. **Every referenced id must be DEFINED EARLIER.** Not merely present —
 *      earlier. The canvas is built up in order, so circling something that
 *      gets written two steps later is an annotation over empty space at the
 *      moment it is drawn, however tidy the finished frame looks.
 *   2. **Every id must be unique across the whole script.** A reused id makes
 *      "circle `x_term`" ambiguous, and AC 12's step-backward would resolve it
 *      differently depending on the direction of travel.
 *   3. **An op may not reference itself.**
 *
 * Returns the problems rather than throwing: the caller (the authoring status
 * machine) turns them into `FAILED` with a retry, and a thrown error inside a
 * validator is harder to attribute than a returned list.
 */

export type ScriptValidationIssue = {
  stepIndex: number;
  opIndex: number;
  /** Machine-readable, and never shown to a student. */
  code: "DUPLICATE_ID" | "UNKNOWN_REFERENCE" | "FORWARD_REFERENCE" | "SELF_REFERENCE";
  detail: string;
};

export function validateScriptReferences(script: LessonScript): ScriptValidationIssue[] {
  const issues: ScriptValidationIssue[] = [];
  /** Ids defined by ops already walked, in document order. */
  const defined = new Set<string>();

  script.steps.forEach((step, stepIndex) => {
    step.ops.forEach((op: DrawOp, opIndex) => {
      const at = { stepIndex, opIndex };

      for (const reference of referencedIds(op)) {
        if (reference === op.id) {
          issues.push({ ...at, code: "SELF_REFERENCE", detail: `"${op.id}" refers to itself` });
          continue;
        }
        if (!defined.has(reference)) {
          // Distinguished for the author's benefit, not the student's: a
          // forward reference is a model that ordered its steps wrongly, an
          // unknown reference is one that invented an element. The first is
          // worth a regeneration; the second says the prompt is unclear.
          const laterDefined = script.steps
            .slice(stepIndex)
            .some((later) => later.ops.some((laterOp) => laterOp.id === reference));
          issues.push({
            ...at,
            code: laterDefined ? "FORWARD_REFERENCE" : "UNKNOWN_REFERENCE",
            detail: `"${op.id}" refers to "${reference}"`,
          });
        }
      }

      if (defined.has(op.id)) {
        issues.push({ ...at, code: "DUPLICATE_ID", detail: `"${op.id}" is defined more than once` });
      }
      defined.add(op.id);
    });
  });

  return issues;
}

export type SpeakableViolation = { stepIndex: number; detail: string };

/**
 * M5 plan §8.1. A step whose narration still carries LaTeX markup is a valid
 * M4 script — `LessonStepSchema.narration` has no opinion on the CONTENT of
 * the text, only its length — that a TTS vendor mangles into a fluent,
 * confidently WRONG explanation of a child's homework. See
 * `lib/narration/speakable.ts` for the measured finding this guards against.
 *
 * **Called ONLY from the authoring path** (`lib/lessons/author.ts`), and
 * deliberately never folded into `LessonStepSchema` itself. `toLessonVersionDTO`
 * re-parses the stored `script` JSON with `safeParse` and returns
 * `script: null` on failure — so tightening the SHARED schema would not merely
 * reject new scripts, it would turn every already-stored M4 lesson whose
 * narration contains a backslash into a lesson with no script at all. That is
 * an outage, not a stricter validation, and it would be invisible in a diff
 * (plan §8.1 names this explicitly). A lesson authored before this guard
 * existed instead surfaces the same failure mode later and more narrowly, as
 * `NARRATION_FAILURE_CODES.UNSPEAKABLE` on the narration run alone — the
 * lesson itself, and every OTHER step's narration, is untouched.
 *
 * Returns issues rather than throwing — the same convention
 * `validateScriptReferences` above uses in this file, despite the "assert" in
 * this function's name (kept because that is the name the plan and the
 * authoring call site use): the caller turns a non-empty return into
 * `INVALID_SCRIPT`, and a thrown error inside a validator is harder to
 * attribute than a returned list.
 */
export function assertSpeakableNarration(script: LessonScript): SpeakableViolation[] {
  const issues: SpeakableViolation[] = [];
  script.steps.forEach((step, stepIndex) => {
    if (!isSpeakableNarration(step.narration)) {
      issues.push({
        stepIndex,
        detail: `step ${stepIndex}'s narration contains LaTeX markup, which a TTS vendor swallows rather than reads aloud`,
      });
    }
  });
  return issues;
}

/**
 * AC 7's derived timeline. Start offsets are the running sum of durations,
 * computed once here and never authored — so the timeline is monotonic by
 * construction rather than by a constraint somebody has to remember to check.
 */
export function deriveTimeline(script: LessonScript): {
  offsets: { stepId: string; startOffsetMs: number; durationMs: number }[];
  totalDurationMs: number;
} {
  let cursor = 0;
  const offsets = script.steps.map((step) => {
    const entry = { stepId: step.id, startOffsetMs: cursor, durationMs: step.durationMs };
    cursor += step.durationMs;
    return entry;
  });
  return { offsets, totalDurationMs: cursor };
}
