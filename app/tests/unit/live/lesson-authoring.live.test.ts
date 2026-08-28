import { writeFileSync } from "node:fs";

import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { describe, expect, it } from "vitest";

import { getAnthropicClient } from "@/lib/ai/client";
import type { OutboundLearnerFacts } from "@/lib/ai/outbound";
import { LessonScriptSchema, type DrawOp, type LessonScript } from "@/lib/lessons/script-schema";
import { buildLessonUserPrompt, LESSON_SYSTEM_PROMPT } from "@/lib/lessons/prompt";
import { validateScriptReferences } from "@/lib/lessons/validate";
import { LESSON_EFFORT, LESSON_MODEL } from "@/lib/config";

/**
 * PLAN §9.2 — the measurement that gates M4's contract. Skipped unless
 * `RUN_LIVE_AI=1`.
 *
 * The plan is unambiguous: **"M4's contract must not be written until these
 * return."** Three of the five come from these runs, because they are all
 * properties of the same authored scripts:
 *
 *   - **M4-1 authoring latency** — decides whether a lesson can be authored
 *     in-request with `after()` or whether M4 has to pay for a job queue. The
 *     API research calls this the single biggest unvalidated assumption in the
 *     whole plan.
 *   - **M4-4 vocabulary sufficiency** — whether eight primitives are enough.
 *     ADR-0014 §2 will not freeze the vocabulary until this returns, and
 *     widening it after a single lesson has shipped invalidates every stored
 *     script.
 *   - **M4-5 answer correctness** — "a lesson that teaches the method to a
 *     wrong conclusion is worse than no lesson" (AC 17).
 *
 * M4-2 (renderer target) and M4-3 (placement legibility) need these scripts as
 * input and follow separately.
 *
 * **The fixture set is deliberately not all mathematics.** M4's own open
 * question concedes the vocabulary is "unashamedly math-shaped", and this
 * project has already shipped one near-miss where every test used a maths
 * problem and the product quietly became a maths app. If eight primitives
 * cannot carry a reading or a history explanation, that is a finding, not an
 * inconvenience — and it is much cheaper to learn now than after the renderer
 * exists.
 *
 *   RUN_LIVE_AI=1 pnpm vitest run tests/unit/live/lesson-authoring.live.test.ts --project unit
 *     → one billed call per fixture
 */
const LIVE = process.env.RUN_LIVE_AI === "1";

type Fixture = {
  slug: string;
  problemText: string;
  facts: OutboundLearnerFacts;
  /** For M4-5. The string the final `write` op should land on, loosely compared. */
  answer: string | null;
};

const FIXTURES: Fixture[] = [
  {
    slug: "fractions-add-like",
    problemText: "What is $\\frac{1}{4} + \\frac{1}{4}$?",
    facts: { gradeLevel: "GRADE_4", subject: "MATH" },
    answer: "2}{4",
  },
  {
    slug: "decimals-align",
    problemText: "Add: $3.4 + 12.75$",
    facts: { gradeLevel: "GRADE_5", subject: "MATH" },
    answer: "16.15",
  },
  {
    slug: "two-step-equation",
    problemText: "Solve for $x$: $3x + 5 = 20$",
    facts: { gradeLevel: "GRADE_7", subject: "MATH" },
    answer: "5",
  },
  {
    slug: "science-food-chain",
    problemText: "Draw and label a food chain that starts with grass and ends with a hawk.",
    facts: { gradeLevel: "GRADE_4", subject: "SCIENCE" },
    answer: null,
  },
  {
    slug: "ela-topic-sentence",
    problemText:
      "Read the paragraph and underline the topic sentence: \"Bats are unusual mammals. They are the only mammals that can truly fly. Their wings are made of skin stretched over long finger bones.\"",
    facts: { gradeLevel: "GRADE_5", subject: "READING" },
    answer: null,
  },
  {
    slug: "history-timeline",
    problemText:
      "Put these events in order on a timeline: the Declaration of Independence (1776), the Boston Tea Party (1773), the end of the Revolutionary War (1783).",
    facts: { gradeLevel: "GRADE_5", subject: "HISTORY" },
    answer: null,
  },
];

type Result = {
  slug: string;
  subject: string;
  ok: boolean;
  elapsedMs: number;
  stopReason: string | null;
  outputTokens: number | null;
  inputTokens: number | null;
  stepCount: number | null;
  totalDurationMs: number | null;
  opKindsUsed: string[];
  referentialIssues: string[];
  finalWriteLatex: string | null;
  answerMatched: boolean | null;
  failure: string | null;
  /** Dev-harness only. Never returned to a caller; this file is not production. */
  failureDetail: string | null;
};

function summarise(script: LessonScript): {
  opKindsUsed: string[];
  finalWriteLatex: string | null;
  totalDurationMs: number;
} {
  const kinds = new Set<string>();
  let finalWrite: string | null = null;
  for (const step of script.steps) {
    for (const op of step.ops as DrawOp[]) {
      kinds.add(op.kind);
      if (op.kind === "write") finalWrite = op.latex;
    }
  }
  return {
    opKindsUsed: [...kinds].sort(),
    finalWriteLatex: finalWrite,
    totalDurationMs: script.steps.reduce((sum, step) => sum + step.durationMs, 0),
  };
}

describe.skipIf(!LIVE)("plan §9.2 — can the model author lessons in this vocabulary?", () => {
  it(
    "authors a lesson for each fixture and records M4-1, M4-4 and M4-5",
    { timeout: 900_000 },
    async () => {
      const client = getAnthropicClient();
      const results: Result[] = [];
      const scripts: Record<string, LessonScript | null> = {};

      // `LIVE_LESSON_ONLY=<slug>` re-runs a single fixture — a billed call
      // should be repeatable without paying for the other five.
      const only = process.env.LIVE_LESSON_ONLY;
      const selected = only ? FIXTURES.filter((f) => f.slug === only) : FIXTURES;

      for (const fixture of selected) {
        const startedAt = Date.now();
        let result: Result = {
          slug: fixture.slug,
          subject: fixture.facts.subject,
          ok: false,
          elapsedMs: 0,
          stopReason: null,
          outputTokens: null,
          inputTokens: null,
          stepCount: null,
          totalDurationMs: null,
          opKindsUsed: [],
          referentialIssues: [],
          finalWriteLatex: null,
          answerMatched: null,
          failure: null,
          failureDetail: null,
        };

        try {
          const response = await client.messages.parse({
            model: LESSON_MODEL,
            max_tokens: 16000,
            system: LESSON_SYSTEM_PROMPT,
            messages: [{ role: "user", content: buildLessonUserPrompt(fixture) }],
            output_config: { format: zodOutputFormat(LessonScriptSchema), effort: LESSON_EFFORT },
          });

          result.elapsedMs = Date.now() - startedAt;
          result.stopReason = response.stop_reason;
          result.inputTokens = response.usage.input_tokens;
          result.outputTokens = response.usage.output_tokens;

          if (response.stop_reason === "refusal") {
            result.failure = "REFUSED";
          } else if (response.parsed_output === null) {
            // M4-4's headline number: a schema rejection means the model wanted
            // something the vocabulary does not have, or could not obey the
            // shape.
            result.failure = "PARSE_FAILED";
          } else {
            const script = response.parsed_output;
            scripts[fixture.slug] = script;
            const stats = summarise(script);
            const issues = validateScriptReferences(script);

            result = {
              ...result,
              ok: issues.length === 0,
              stepCount: script.steps.length,
              totalDurationMs: stats.totalDurationMs,
              opKindsUsed: stats.opKindsUsed,
              referentialIssues: issues.map((issue) => `${issue.code} ${issue.detail}`),
              finalWriteLatex: stats.finalWriteLatex,
              answerMatched:
                fixture.answer === null
                  ? null
                  : (stats.finalWriteLatex ?? "").replace(/\s/g, "").includes(fixture.answer.replace(/\s/g, "")),
            };
          }
        } catch (err) {
          result.elapsedMs = Date.now() - startedAt;
          result.failure = err instanceof Error ? err.name : "UNKNOWN";
          // Recorded because a 363ms "Error" tells you nothing and a message
          // tells you everything. Dev harness only.
          result.failureDetail = err instanceof Error ? err.message.slice(0, 600) : String(err);
        }

        results.push(result);
      }

      const authored = results.filter((r) => r.failure === null);
      const latencies = authored.map((r) => r.elapsedMs).sort((a, b) => a - b);
      const graded = results.filter((r) => r.answerMatched !== null);

      const summary = {
        model: LESSON_MODEL,
        effort: LESSON_EFFORT,
        fixtures: selected.length,
        "M4-1_latency": {
          p50Ms: latencies[Math.floor(latencies.length * 0.5)] ?? null,
          maxMs: latencies.at(-1) ?? null,
          outputTokens: authored.map((r) => r.outputTokens),
        },
        "M4-4_vocabulary": {
          schemaRejections: results.filter((r) => r.failure === "PARSE_FAILED").length,
          refusals: results.filter((r) => r.failure === "REFUSED").length,
          referentiallyClean: authored.filter((r) => r.ok).length,
          opKindsEverUsed: [...new Set(authored.flatMap((r) => r.opKindsUsed))].sort(),
          bySubject: Object.fromEntries(
            results.map((r) => [r.slug, { subject: r.subject, ok: r.ok, failure: r.failure, steps: r.stepCount }]),
          ),
        },
        "M4-5_answer": {
          checked: graded.length,
          matched: graded.filter((r) => r.answerMatched === true).length,
          misses: graded.filter((r) => r.answerMatched !== true).map((r) => ({ slug: r.slug, wrote: r.finalWriteLatex })),
        },
      };

      writeFileSync(
        process.env.LIVE_LESSON_RESULT_PATH ?? ".scratch/lesson-authoring-result.json",
        JSON.stringify({ summary, results, scripts }, null, 2),
      );

      console.log("\n=== PLAN §9.2 — M4 AUTHORING MEASUREMENT ===");
      console.log(JSON.stringify(summary, null, 2));
      for (const r of results) {
        console.log(
          `\n${r.slug} [${r.subject}] — ${r.failure ?? "authored"} · ${r.elapsedMs}ms · ${r.stepCount ?? "-"} steps · ops: ${r.opKindsUsed.join(",") || "-"}`,
        );
        if (r.referentialIssues.length > 0) console.log(`    referential: ${r.referentialIssues.join(" | ")}`);
        if (r.answerMatched !== null) console.log(`    final write: ${r.finalWriteLatex} · matched: ${r.answerMatched}`);
      }

      // Deliberately NOT asserted: whether the vocabulary is sufficient, whether
      // latency fits a function invocation, whether non-maths subjects work.
      // Those are the MEASUREMENTS this run exists to produce, and a threshold
      // asserted here would turn a finding into a red build and invite someone
      // to tune the number instead of reading the result. The plan's §9.2 table
      // holds the thresholds, and a human reads them.
      //
      // The one thing asserted is that the harness itself ran.
      expect(results).toHaveLength(selected.length);
      expect(results.every((r) => r.elapsedMs > 0)).toBe(true);
    },
  );
});
