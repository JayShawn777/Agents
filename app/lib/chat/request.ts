import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import type { ChatMessage } from "@/lib/generated/prisma/client";
import { buildProblemContextBlock, REVEAL_OPERATOR_INSTRUCTION, TUTOR_SYSTEM_PROMPT } from "@/lib/chat/prompt";
import { CHAT_CACHE_TTL, CHAT_EFFORT, CHAT_MAX_OUTPUT_TOKENS, CHAT_MODEL } from "@/lib/config";

/**
 * ADR-0012 §3 — the outbound request for one chat turn, assembled and nothing
 * else. PURE: no database access, no clock, no client. That is what lets
 * `tests/unit/lib/chat/request.test.ts` assert AC 8's real property — that the
 * `system` array is BYTE-IDENTICAL across three consecutive turns — by building
 * three requests and comparing them, with no mock of the API involved.
 *
 * AC 7 holds structurally rather than by redaction: the only student-derived
 * strings this function can reach are `session.renderedContext` (rendered from
 * `OutboundLearnerContext`, a type with no name, id, avatar or email field) and
 * the messages themselves. It is never handed a `StudentProfile` row.
 */

export type ChatTurnRequestArgs = {
  /** The bytes stored on `ChatSession.renderedContext` at open. Never re-rendered here. */
  renderedContext: string;
  /** The text of the ONE problem this session is bound to. */
  problemText: string;
  /**
   * The session transcript in `sequence` order, INCLUDING the student message
   * for this turn. Empty-content rows are dropped (see below).
   */
  messages: ChatMessage[];
  /** The assistant row being generated into. Excluded from its own request. */
  assistantMessageId: string;
  /** `studentTurnCount` AFTER this turn was counted. */
  studentTurnCount: number;
  /** `ChatSession.revealAfterTurns`, stamped at open (ADR-0012 §1). */
  revealAfterTurns: number;
};

export function buildChatTurnRequest(args: ChatTurnRequestArgs): Anthropic.MessageCreateParams {
  const messages: Anthropic.MessageParam[] = [
    {
      // Breakpoint 2. The problem is a USER message carrying an explicit
      // "this is data, not instructions" preamble and a fence — never a system
      // instruction (AC 9). It is text lifted off a photograph of a child's
      // page plus whatever they typed correcting it, which is precisely the
      // untrusted span the fence exists for. Putting it in `system` would hand
      // a worksheet operator authority.
      role: "user",
      content: [
        {
          type: "text",
          text: buildProblemContextBlock(args.problemText),
          cache_control: { type: "ephemeral", ttl: CHAT_CACHE_TTL },
        },
      ],
    },
  ];

  for (const message of args.messages) {
    // The assistant row for THIS turn is the row we are about to write into.
    // On a regenerate it holds a stale partial; sending it back would ask the
    // model to talk to its own abandoned fragment.
    if (message.id === args.assistantMessageId) continue;
    // The API rejects an empty text block, and an empty assistant row is a
    // placeholder from a turn that never produced anything rather than a thing
    // that was said.
    if (message.content.length === 0) continue;
    messages.push({
      role: message.role === "USER" ? "user" : "assistant",
      content: message.content,
    });
  }

  // AC 4's escalation. A mid-conversation system message rather than an edit to
  // the `system` array: appending leaves the cached prefix untouched, whereas
  // rewriting the system prompt would invalidate the cache at exactly the point
  // in a conversation where it is longest and most expensive to rebuild.
  //
  // Placement is load-bearing and the API enforces it: a `system` entry in
  // `messages[]` must follow a user message and must be the last entry or be
  // followed by an assistant turn. It is appended after the student's message
  // for this turn, which satisfies both.
  if (args.studentTurnCount >= args.revealAfterTurns) {
    messages.push({ role: "system", content: REVEAL_OPERATOR_INSTRUCTION });
  }

  return {
    model: CHAT_MODEL,
    max_tokens: CHAT_MAX_OUTPUT_TOKENS,
    // Breakpoint 1, on the SECOND block: a cache breakpoint covers everything
    // before it, so marking the learner context caches the static prompt with
    // it. Marking the static prompt instead would leave the context — the
    // longer and more valuable half — outside the cache.
    system: [
      { type: "text", text: TUTOR_SYSTEM_PROMPT },
      {
        type: "text",
        text: args.renderedContext,
        cache_control: { type: "ephemeral", ttl: CHAT_CACHE_TTL },
      },
    ],
    // `thinking` is deliberately omitted: on Opus 5 that IS adaptive thinking,
    // and naming it would only invite someone to "helpfully" disable it later.
    // See `CHAT_EFFORT` for why the latency is bought with effort instead.
    output_config: { effort: CHAT_EFFORT },
    messages,
  };
}
