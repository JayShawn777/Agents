import { writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { getAnthropicClient } from "@/lib/ai/client";
import { TUTOR_SYSTEM_PROMPT } from "@/lib/chat/prompt";
import { CHAT_MODEL, CHAT_SYSTEM_PROMPT_MIN_TOKENS } from "@/lib/config";

/**
 * The truthful half of the assertion ADR-0012 §3 asks for. CI can only
 * approximate a token count from character length; `count_tokens` is the real
 * number, and the endpoint is free — but it is a network call, so it lives
 * here behind `RUN_LIVE_AI=1` rather than in the unit suite.
 *
 * If this ever fails while `tests/unit/lib/chat/prompt.test.ts` passes, the
 * approximation in that file is wrong and it is the one to fix.
 */
describe.skipIf(process.env.RUN_LIVE_AI !== "1")("tutor system prompt, real token count", () => {
  it("exceeds the minimum cacheable prefix", { timeout: 60_000 }, async () => {
    const { input_tokens: tokens } = await getAnthropicClient().messages.countTokens({
      model: CHAT_MODEL,
      system: TUTOR_SYSTEM_PROMPT,
      messages: [{ role: "user", content: "hi" }],
    });

    writeFileSync(
      ".scratch/prompt-tokens.json",
      JSON.stringify({ chars: TUTOR_SYSTEM_PROMPT.length, tokens, charsPerToken: TUTOR_SYSTEM_PROMPT.length / tokens }, null, 2),
    );
    console.log(
      `TUTOR_SYSTEM_PROMPT: ${TUTOR_SYSTEM_PROMPT.length} chars, ${tokens} real tokens ` +
        `(minimum ${CHAT_SYSTEM_PROMPT_MIN_TOKENS}); chars/token = ${(TUTOR_SYSTEM_PROMPT.length / tokens).toFixed(2)}`,
    );

    expect(tokens).toBeGreaterThan(CHAT_SYSTEM_PROMPT_MIN_TOKENS);
  });
});
