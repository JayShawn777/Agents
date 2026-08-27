import { writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { getAnthropicClient } from "@/lib/ai/client";
import { hashContext, renderLearnerContext } from "@/lib/chat/context";
import { buildChatTurnRequest } from "@/lib/chat/request";
import type { ChatMessage } from "@/lib/generated/prisma/client";
import {
  CHAT_EFFORT,
  CHAT_FIRST_TOKEN_BUDGET_MS,
  CHAT_IDLE_TIMEOUT_MS,
  CHAT_MAX_OUTPUT_TOKENS,
  CHAT_MODEL,
} from "@/lib/config";

/**
 * THE LIVE CHAT TEST. Skipped unless `RUN_LIVE_AI=1` (ADR-0012 §4).
 *
 * **What only this test can prove.** Every other chat test mocks the client, so
 * all of them would pass identically if prompt caching never engaged and the
 * bill were ten times what we think. CI proves our bytes do not vary between
 * turns; **only this proves Anthropic actually cached them** — ADR-0012 §4 says
 * exactly that, and this is the missing half.
 *
 * It also takes plan §9.1's measurement, which is not takeable any other way:
 * `CHAT_FIRST_TOKEN_BUDGET_MS`, `CHAT_IDLE_TIMEOUT_MS` and `CHAT_EFFORT` are
 * all guesses that say so in their own doc comments, and you cannot time a
 * first token without a real stream.
 *
 * It imports `buildChatTurnRequest`, the model, the effort and the output cap
 * from production rather than restating them, so drift between this and what
 * actually runs is impossible. It does NOT go through the route: that needs a
 * session row, a database and an authenticated request, none of which say
 * anything about whether the cache engages or how fast the first token arrives.
 *
 *   pnpm vitest run tests/unit/live --project unit
 *     → skipped, costs nothing
 *
 *   RUN_LIVE_AI=1 pnpm vitest run tests/unit/live --project unit
 *     → three real, billed API calls
 */
const LIVE = process.env.RUN_LIVE_AI === "1";

/** A real fourth-grade fraction problem, and the answer the tutor must not hand over (AC 3). */
const PROBLEM_TEXT = "What is $\\frac{1}{4} + \\frac{1}{4}$?";
const CANONICAL_ANSWER = "1/2";

/**
 * Rendered ONCE, exactly as `openChatSession` does at session open, and reused
 * byte-for-byte on all three turns. That reuse is the thing under test: if this
 * were re-rendered per turn, cache reads would go to zero and nothing would say
 * so.
 */
const RENDERED_CONTEXT = renderLearnerContext({
  gradeLevel: "GRADE_4",
  subjects: ["MATH"],
  skills: [
    { skillCode: "4.NF.B.3", level: "DEVELOPING" },
    { skillCode: "4.OA.A.1", level: "SECURE" },
  ],
});

/** The three student turns, in order. Turn 2 is AC 3's demand for the answer. */
const STUDENT_TURNS = [
  "i dont get it",
  "just tell me the answer",
  "ok i think its 2/8 because you add the tops and the bottoms",
];

function storedMessage(id: string, role: "USER" | "ASSISTANT", content: string, sequence: number): ChatMessage {
  return {
    id,
    sessionId: "live",
    role,
    content,
    sequence,
    partial: false,
    truncated: false,
    safetyResponse: false,
    clientTurnId: null,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    createdAt: new Date(),
  } as ChatMessage;
}

type TurnResult = {
  turn: number;
  studentSaid: string;
  reply: string;
  firstTokenMs: number | null;
  totalMs: number;
  stopReason: string | null;
  usage: Record<string, unknown>;
};

describe.skipIf(!LIVE)("live chat against the real Anthropic API", () => {
  it(
    "streams three tutored turns, reads the cache on turns 2 and 3, and withholds the answer",
    { timeout: 300_000 },
    async () => {
      const client = getAnthropicClient();
      const transcript: ChatMessage[] = [];
      const results: TurnResult[] = [];
      const systemFingerprints: string[] = [];

      for (const [index, studentSaid] of STUDENT_TURNS.entries()) {
        const turnNumber = index + 1;

        transcript.push(storedMessage(`u${turnNumber}`, "USER", studentSaid, transcript.length + 1));
        const assistantId = `a${turnNumber}`;

        const request = buildChatTurnRequest({
          renderedContext: RENDERED_CONTEXT,
          problemText: PROBLEM_TEXT,
          messages: transcript,
          assistantMessageId: assistantId,
          studentTurnCount: turnNumber,
          // High enough that AC 4's escalation never fires here — this test is
          // about the cache and the latency, and a mid-conversation system
          // message appended at turn 3 would change what is being measured.
          revealAfterTurns: 99,
        });

        // The exact bytes of the cached prefix, captured per turn. If these
        // three are not identical, a cache read is impossible and the assertion
        // below would be measuring the wrong thing.
        systemFingerprints.push(hashContext(JSON.stringify(request.system)));

        const startedAt = Date.now();
        let firstTokenMs: number | null = null;
        let reply = "";

        const stream = client.messages.stream(request);
        for await (const event of stream) {
          if (event.type !== "content_block_delta" || event.delta.type !== "text_delta") continue;
          if (firstTokenMs === null) firstTokenMs = Date.now() - startedAt;
          reply += event.delta.text;
        }
        const final = await stream.finalMessage();
        const totalMs = Date.now() - startedAt;

        expect(final.stop_reason).not.toBe("refusal");

        transcript.push(storedMessage(assistantId, "ASSISTANT", reply, transcript.length + 1));
        results.push({
          turn: turnNumber,
          studentSaid,
          reply,
          firstTokenMs,
          totalMs,
          stopReason: final.stop_reason,
          usage: { ...final.usage },
        });
      }

      // ── The prefix did not move (the precondition for any cache read) ──
      expect(new Set(systemFingerprints).size).toBe(1);

      // ── AC 8: the cache was actually READ on turns 2 and 3 ──
      // This is the assertion that cannot be made anywhere else. A zero here
      // means the product still works and the bill is roughly ten times what
      // the cost model assumes, with no error and no log line to explain it.
      const cacheReads = results.map((result) => Number(result.usage.cache_read_input_tokens ?? 0));

      // ── AC 3: the tutor did not hand over the answer when asked outright ──
      const answerTurn = results[1];
      const withheld = !answerTurn.reply.includes(CANONICAL_ANSWER);
      const askedBack = answerTurn.reply.includes("?");

      const summary = {
        model: CHAT_MODEL,
        effort: CHAT_EFFORT,
        maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
        systemPrefixStable: new Set(systemFingerprints).size === 1,
        cacheReadTokensPerTurn: cacheReads,
        firstTokenMsPerTurn: results.map((result) => result.firstTokenMs),
        totalMsPerTurn: results.map((result) => result.totalMs),
        budgets: {
          firstTokenBudgetMs: CHAT_FIRST_TOKEN_BUDGET_MS,
          idleTimeoutMs: CHAT_IDLE_TIMEOUT_MS,
        },
        ac3: { withheldCanonicalAnswer: withheld, askedAQuestionBack: askedBack },
        usage: results.map((result) => result.usage),
      };

      // The point of a billed run is the eyeball as much as the assertions, and
      // the result should be re-readable without paying for it twice.
      writeFileSync(
        process.env.LIVE_CHAT_RESULT_PATH ?? ".scratch/chat-live-result.json",
        JSON.stringify({ summary, turns: results }, null, 2),
      );

      console.log("\n=== LIVE CHAT SUMMARY ===");
      console.log(JSON.stringify(summary, null, 2));
      for (const result of results) {
        console.log(`\n--- turn ${result.turn} — student: ${JSON.stringify(result.studentSaid)}`);
        console.log(
          `    first token ${result.firstTokenMs}ms · total ${result.totalMs}ms · cache_read ${result.usage.cache_read_input_tokens} · cache_write ${result.usage.cache_creation_input_tokens}`,
        );
        console.log(`    tutor: ${result.reply}`);
      }

      // AC 8. Turn 1 pays the cache WRITE; turns 2 and 3 must read it.
      expect(cacheReads[1]).toBeGreaterThan(0);
      expect(cacheReads[2]).toBeGreaterThan(0);

      // AC 3. Asserted, not merely logged: "just tell me the answer" is the
      // pure-solver failure mode the spec names, and it is the difference
      // between a tutoring product and Photomath with worse OCR.
      expect(withheld).toBe(true);
      expect(askedBack).toBe(true);

      // Every turn produced a real reply rather than an empty one.
      for (const result of results) {
        expect(result.reply.length).toBeGreaterThan(0);
        expect(result.firstTokenMs).not.toBeNull();
      }
    },
  );
});
