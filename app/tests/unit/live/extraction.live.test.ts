import { readFileSync, writeFileSync } from "node:fs";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { describe, expect, it } from "vitest";

import { getAnthropicClient } from "@/lib/ai/client";
import { ExtractionResultSchema } from "@/lib/ai/extraction-schema";
import { buildExtractionUserPrompt, EXTRACTION_SYSTEM_PROMPT } from "@/lib/ai/prompt";
import { EXTRACTION_EFFORT, EXTRACTION_MODEL } from "@/lib/config";

/**
 * THE LIVE EXTRACTION TEST. Skipped unless `RUN_LIVE_AI=1`, the convention
 * ADR-0012 §4 sets for assertions that can only be made against the real API.
 *
 * Why this file exists: until 2026-08-28 no worksheet had ever been put in
 * front of the model. Every extraction test mocks the client, so all of them
 * would pass identically if the vision path were completely broken — and four
 * milestones stand on it. This is the one test that cannot pass by accident.
 *
 * It deliberately calls the SAME prompt, schema, model and effort as
 * `lib/extraction/run-extraction.ts`, importing them rather than restating
 * them, so that drift between this and production is impossible. It does NOT
 * go through `runExtraction` itself, because that needs an `Extraction` row, a
 * storage port and a database — none of which say anything about whether the
 * model can read a page.
 *
 *   pnpm vitest run tests/unit/live --project unit
 *     → skipped, costs nothing
 *
 *   RUN_LIVE_AI=1 pnpm vitest run tests/unit/live --project unit
 *     → one real, billed API call
 *
 * Override the image with `LIVE_WORKSHEET_PATH=<path>`.
 */
const LIVE = process.env.RUN_LIVE_AI === "1";
const WORKSHEET = process.env.LIVE_WORKSHEET_PATH ?? ".scratch/Worksheet Pic.webp";

describe.skipIf(!LIVE)("live extraction against the real Anthropic API", () => {
  it(
    "reads a real worksheet and returns structured problems",
    { timeout: 180_000 },
    async () => {
      const base64 = readFileSync(WORKSHEET).toString("base64");
      const mediaType = WORKSHEET.endsWith(".png")
        ? "image/png"
        : WORKSHEET.endsWith(".webp")
          ? "image/webp"
          : "image/jpeg";

      const contentBlock: Anthropic.ImageBlockParam = {
        type: "image",
        source: { type: "base64", media_type: mediaType, data: base64 },
      };

      const started = Date.now();
      const response = await getAnthropicClient().messages.parse({
        model: EXTRACTION_MODEL,
        max_tokens: 16000,
        system: EXTRACTION_SYSTEM_PROMPT,
        messages: [{ role: "user", content: [contentBlock, { type: "text", text: buildExtractionUserPrompt() }] }],
        output_config: { format: zodOutputFormat(ExtractionResultSchema), effort: EXTRACTION_EFFORT },
      });
      const elapsedMs = Date.now() - started;

      // Same order run-extraction.ts checks in: refusal, then a null parse.
      expect(response.stop_reason).not.toBe("refusal");
      const parsed = response.parsed_output;
      expect(parsed).not.toBeNull();
      if (parsed === null) return;

      const summary = {
        elapsedMs,
        stopReason: response.stop_reason,
        usage: response.usage,
        containsSchoolwork: parsed.containsSchoolwork,
        problemCount: parsed.problems.length,
        subjects: [...new Set(parsed.problems.map((p) => p.subject))],
        problemTypes: [...new Set(parsed.problems.map((p) => p.problemType))],
        languages: [...new Set(parsed.problems.map((p) => p.language))],
        confidence: {
          min: Math.min(...parsed.problems.map((p) => p.confidence)),
          max: Math.max(...parsed.problems.map((p) => p.confidence)),
        },
        withStudentAnswer: parsed.problems.filter((p) => p.studentAnswerText !== null).length,
      };

      // The point of the run is the eyeball, not only the assertions: a green
      // test that extracted 35 wrong problems is worse than a red one. Written
      // to disk as well as logged, because a real call costs real money and the
      // result should be re-readable without paying for it twice.
      writeFileSync(
        process.env.LIVE_RESULT_PATH ?? ".scratch/extraction-result.json",
        JSON.stringify({ summary, problems: parsed.problems }, null, 2),
      );
      console.log("\n=== LIVE EXTRACTION SUMMARY ===");
      console.log(JSON.stringify(summary, null, 2));
      console.log("\n=== EVERY PROBLEM, AS EXTRACTED ===");
      for (const p of parsed.problems) {
        console.log(
          `${String(p.ordinal).padStart(3)}  label=${JSON.stringify(p.label)}  conf=${p.confidence}  ${JSON.stringify(p.text)}`,
        );
      }

      expect(parsed.containsSchoolwork).toBe(true);
      expect(parsed.problems.length).toBeGreaterThan(0);
      // Ordinals must be unique — a duplicate means two rows describe one problem.
      expect(new Set(parsed.problems.map((p) => p.ordinal)).size).toBe(parsed.problems.length);
    },
  );
});
