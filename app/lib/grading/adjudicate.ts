import "server-only";

import { z } from "zod";
import { AnthropicError, APIConnectionTimeoutError } from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { getAnthropicClient, MissingAnthropicApiKeyError } from "@/lib/ai/client";
import { fenceUntrusted, UNTRUSTED_INPUT_RULE } from "@/lib/ai/untrusted";
import type { OutboundLearnerFacts } from "@/lib/ai/outbound";
import { GRADING_EFFORT, GRADING_MODEL, GRADING_TIMEOUT_MS, HINT_MAX_LENGTH } from "@/lib/config";
import { HINT_FALLBACK } from "@/lib/errors";
import type { AnswerFormat } from "@/lib/domain/enums";

/**
 * ADR-0011 §2/§4 (B32). Stage two: one `messages.parse()` call at
 * `GRADING_EFFORT = 'low'`, reached ONLY on a stage-one miss
 * (`lib/grading/normalize.ts` returned `null`). Exported because M3's chat
 * replies reuse the SAME hint post-check (ADR-0011 §4) — this is the one
 * function that decides "does this text hand over the answer".
 */

const AdjudicationSchema = z.object({
  verdict: z.enum(["CORRECT", "INCORRECT", "UNSURE"]),
  hint: z.string().min(1).max(HINT_MAX_LENGTH),
});

export type AdjudicationVerdict = z.infer<typeof AdjudicationSchema>["verdict"];

export type AdjudicationResult =
  | { outcome: "CORRECT"; hint: string }
  | { outcome: "INCORRECT"; hint: string }
  | { outcome: "UNSURE" }
  /** A refusal, a null parse, a timeout, or any other upstream failure — ADR-0011 §3: this is ALSO `UNSCORED`, never surfaced as an error to the student. */
  | { outcome: "UPSTREAM_FAILURE" };

const ADJUDICATION_SYSTEM_PROMPT = `You are checking whether a student's answer to a practice problem is correct.

Rules, followed exactly:

- Compare the student's submitted answer against the canonical answer and its
accepted alternate forms. Judge mathematical or conceptual equivalence, not
exact string matching — different notation for the same value is CORRECT.
- verdict is CORRECT if the submission is equivalent to the answer key,
INCORRECT if it is clearly wrong, or UNSURE if the submission is ambiguous,
blank-adjacent, off-topic, garbled, or in a form you cannot confidently judge.
When genuinely unsure, choose UNSURE rather than guessing either way.
- hint must guide the student toward the answer without ever stating it, and
must NEVER include the canonical answer or any of its accepted forms, in any
form, verbatim or paraphrased closely enough that writing it down would be
the answer. For an UNSURE verdict, the hint should ask the student to try
explaining or rephrasing their answer, without implying it is wrong.

Report the result using only the structured fields you have been given.

${UNTRUSTED_INPUT_RULE}`;

/**
 * The mechanical grading route (ADR-0011 §2). `format` and the answer key
 * are given so the model has everything it needs to judge equivalence; the
 * request otherwise carries only `OutboundLearnerFacts` — no name, id, or
 * email (M2 AC 27).
 */
export async function adjudicate(args: {
  facts: OutboundLearnerFacts;
  problemText: string;
  answerFormat: AnswerFormat;
  canonicalAnswer: string;
  acceptedForms: readonly string[];
  submittedAnswer: string;
}): Promise<AdjudicationResult> {
  try {
    const client = getAnthropicClient();
    const response = await client.messages.parse(
      {
        model: GRADING_MODEL,
        max_tokens: 1024,
        system: ADJUDICATION_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: buildAdjudicationUserPrompt(args),
          },
        ],
        output_config: { format: zodOutputFormat(AdjudicationSchema), effort: GRADING_EFFORT },
      },
      // Per-call override — ADR-0011's interactive path: a submitted answer
      // must be graded fast enough to feel immediate, distinct from the
      // shared client's EXTRACTION_TIMEOUT_MS default (`lib/ai/client.ts`).
      { timeout: GRADING_TIMEOUT_MS },
    );

    if (response.stop_reason === "refusal") {
      return { outcome: "UPSTREAM_FAILURE" };
    }
    const parsed = response.parsed_output;
    if (parsed === null) {
      return { outcome: "UPSTREAM_FAILURE" };
    }

    if (parsed.verdict === "UNSURE") {
      return { outcome: "UNSURE" };
    }

    const safeHint = stripAnswerFromHint(parsed.hint, args.canonicalAnswer, args.acceptedForms);
    return { outcome: parsed.verdict, hint: safeHint };
  } catch (err) {
    console.error("adjudicate() failed", err);
    return { outcome: "UPSTREAM_FAILURE" };
  }
}

function buildAdjudicationUserPrompt(args: {
  facts: OutboundLearnerFacts;
  problemText: string;
  answerFormat: AnswerFormat;
  canonicalAnswer: string;
  acceptedForms: readonly string[];
  submittedAnswer: string;
}): string {
  return `Grade level: ${args.facts.gradeLevel}
Subject: ${args.facts.subject}
Answer format: ${args.answerFormat}

Problem:
${fenceUntrusted("problem", args.problemText)}

Canonical answer: ${args.canonicalAnswer}
Accepted alternate forms: ${args.acceptedForms.length > 0 ? args.acceptedForms.join(", ") : "(none)"}

Student's submitted answer:
${fenceUntrusted("student_answer", args.submittedAnswer)}`;
}

/**
 * ADR-0011 §4 / M2 AC 11: enforced by a post-check, not by trusting the
 * prompt. Discards a hint that contains the canonical answer or any
 * accepted form — verbatim, or in normalised form (case/whitespace-folded) —
 * and substitutes the fixed `HINT_FALLBACK`. Exported: M3's chat replies
 * (AC 3) run the SAME check on every reply before it reaches a student.
 */
export function stripAnswerFromHint(hint: string, canonicalAnswer: string, acceptedForms: readonly string[]): string {
  const haystack = foldForComparison(hint);
  const forbidden = [canonicalAnswer, ...acceptedForms].map(foldForComparison).filter((s) => s.length > 0);

  const leaks = forbidden.some((needle) => haystack.includes(needle));
  return leaks ? HINT_FALLBACK : hint;
}

function foldForComparison(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Checked most specific first (research §8), same convention as `lib/extraction/run-extraction.ts` and `lib/practice/generate.ts`. Currently unused directly (the try/catch above collapses every failure to `UPSTREAM_FAILURE`) — kept as the single documented classification point if a caller ever needs to distinguish failure reasons. */
export function classifyAdjudicationFailure(err: unknown): "TIMEOUT" | "UPSTREAM" | "INTERNAL" {
  if (err instanceof MissingAnthropicApiKeyError) return "INTERNAL";
  if (err instanceof APIConnectionTimeoutError) return "TIMEOUT";
  if (err instanceof AnthropicError) return "UPSTREAM";
  return "INTERNAL";
}
