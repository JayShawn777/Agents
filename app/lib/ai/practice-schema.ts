import "server-only";

import { z } from "zod";

import { AnswerFormat } from "@/lib/domain/enums";
import { PRACTICE_ANSWER_MAX_LENGTH } from "@/lib/config";

/**
 * ADR-0009 §2. The per-request generation schema, built over the candidate
 * slate a caller has already resolved — a FUNCTION of `(codes, setSize)`,
 * not a module-scope constant (ADR-0009's own accepted trade-off: this is
 * "slightly less idiomatic" than `ExtractionResultSchema`'s static shape,
 * and it is tested as a function of its inputs instead of snapshot-tested
 * as one object).
 *
 * `skillCode: z.enum(codes)` is the load-bearing line: the model's output is
 * structurally constrained to the slate `zodOutputFormat()` carries into the
 * request, so a code outside the taxonomy or outside the grade band cannot
 * validate (M2 AC 7, AC 8 "by construction" — ADR-0009 §2).
 *
 * `canonicalAnswer`/`acceptedForms`/`workedSolution` are requested from the
 * model in the SAME call as the problem text — ADR-0011 doesn't require a
 * second call to author the key, only that it is STORED separately
 * (`PracticeAnswerKey`) and never queried alongside the problem by a careless
 * read. `canonicalAnswer`/`acceptedForms` share `PRACTICE_ANSWER_MAX_LENGTH`
 * with the student-submitted answer they are compared against: bounded, not
 * because the model can't write more, but because nothing downstream should
 * have to render (or compare against) an unbounded answer key.
 */
export function buildPracticeGenerationSchema(codes: readonly [string, ...string[]], setSize: number) {
  const GeneratedProblemSchema = z.object({
    skillCode: z.enum(codes),
    /// LaTeX delimited $…$ / $$…$$, the same convention as M1 (ADR-0005).
    text: z.string().min(1).max(2000),
    containsMath: z.boolean(),
    answerFormat: z.enum(AnswerFormat),
    /// MULTIPLE_CHOICE only; empty otherwise. The correct option is
    /// `canonicalAnswer`, never identified by position here.
    choices: z.array(z.string().min(1).max(200)).max(6),
    canonicalAnswer: z.string().min(1).max(PRACTICE_ANSWER_MAX_LENGTH),
    acceptedForms: z.array(z.string().min(1).max(PRACTICE_ANSWER_MAX_LENGTH)).max(10),
    /// A short, step-by-step explanation ending in the answer. Revealed only
    /// after ATTEMPTS_BEFORE_REVEAL incorrect attempts (M2 AC 12).
    workedSolution: z.string().min(1).max(2000),
  });

  return z.object({
    problems: z.array(GeneratedProblemSchema).length(setSize),
  });
}

export type PracticeGenerationSchema = ReturnType<typeof buildPracticeGenerationSchema>;
export type GeneratedPracticeProblem = z.infer<PracticeGenerationSchema>["problems"][number];
