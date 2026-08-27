import "server-only";

import { z } from "zod";

import { Subject } from "@/lib/domain/enums";

/**
 * ADR-0005's single contract, verbatim: one zod schema that is simultaneously
 * the model's structured-output format (`zodOutputFormat`,
 * `lib/ai/client.ts`), the boundary validator for whatever `parsed_output`
 * comes back, and the source of its own TypeScript types. Nothing parallel
 * to this exists anywhere else — `lib/extraction/run-extraction.ts` is the
 * only reader.
 *
 * Deliberate properties (ADR-0005):
 *
 *   - `ordinal` is the model's own report of position on the page and is
 *     NEVER renumbered after a delete (M1 AC 29) — enforced at the database
 *     by `@@unique([extractionId, ordinal])`.
 *   - `studentAnswerText` is nullable and structurally separate from `text`
 *     (M1 AC 22). Nothing in M1 reads it.
 *   - `subject` reuses the SAME `Subject` enum as `StudentProfile`, so M2/M7
 *     inherit one taxonomy. `problemType` is deliberately free text — a
 *     skill taxonomy is M2's job, not M1's.
 *   - `containsSchoolwork: false` maps to `COMPLETE_EMPTY`, a first-class
 *     terminal state (M1 AC 25), distinguishing "we looked and found
 *     nothing" from "we failed".
 *   - Mathematics is LaTeX inside `text`, delimited `$…$` / `$$…$$`
 *     (M1 AC 21) — `containsMath` is a cheap render hint, not the source of
 *     truth for whether math is present.
 */
export const ExtractedProblemSchema = z.object({
  ordinal: z.number().int().min(1).max(200),
  label: z.string().max(16).nullable(), // "4", "4a", "Question 3"
  text: z.string().min(1).max(2000), // LaTeX in $…$ / $$…$$
  containsMath: z.boolean(),
  subject: z.enum(Subject),
  problemType: z.string().min(1).max(64), // free text, coarse
  studentAnswerText: z.string().max(2000).nullable(), // M1 AC 22
  confidence: z.number().min(0).max(1),
});

export type ExtractedProblemOutput = z.infer<typeof ExtractedProblemSchema>;

export const ExtractionResultSchema = z.object({
  containsSchoolwork: z.boolean(), // M1 AC 25
  problems: z.array(ExtractedProblemSchema).max(100),
});

export type ExtractionResultOutput = z.infer<typeof ExtractionResultSchema>;
