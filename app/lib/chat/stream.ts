import "server-only";

import { after } from "next/server";
import { AnthropicError, APIConnectionTimeoutError } from "@anthropic-ai/sdk";

import { db } from "@/lib/db";
import type { ChatMessage, ChatSession } from "@/lib/generated/prisma/client";
import { getAnthropicClient, MissingAnthropicApiKeyError } from "@/lib/ai/client";
import { buildChatTurnRequest } from "@/lib/chat/request";
import { toChatMessageDTO, toChatSessionDTO } from "@/lib/chat/dto";
import type { OpenTurnResult } from "@/lib/chat/turn";
import type { ChatStreamEvent } from "@/lib/schemas/dto";
import { CHAT_FAILURE_MESSAGES, type ChatFailureCode } from "@/lib/errors";
import { DISTRESS_SAFETY_MESSAGE } from "@/lib/chat/prompt";
import { CHAT_FIRST_TOKEN_BUDGET_MS, CHAT_IDLE_TIMEOUT_MS } from "@/lib/config";

/**
 * ADR-0013 — the NDJSON chat stream, and the one place in this app where a
 * success body is not an `ApiResult<T>`.
 *
 * **Where the envelope stops (ADR-0013 §2).** Every failure BEFORE the first
 * byte is a normal `ApiResult` error with a real status code, produced by
 * `withAuth()` in the route file — 401, 403, 404, 409, 400, 429. By the time
 * this module runs the status is already 200 and cannot change, so every
 * failure from here on is a terminal `{ type: 'error' }` event carrying an
 * allowlisted message from `CHAT_FAILURE_MESSAGES`. That is not an
 * inconsistency; it is a decision, and this comment is where it is written
 * down.
 *
 * **What the wire guarantees.** Exactly one `turn`, then zero or more `delta`,
 * then exactly one of `done` or `error`. Never both. Never a `delta` after a
 * terminal event. A socket that ends with no terminal event is not a success —
 * the client treats it as its own idle timeout.
 */

const NDJSON_HEADERS: HeadersInit = {
  "Content-Type": "application/x-ndjson",
  // Every response in this app is `no-store` (plan §3), and a cached
  // transcript would be a child's conversation sitting in a shared cache.
  "Cache-Control": "no-store",
  // Defensive, and UNVERIFIED against Vercel's target plan (ADR-0013's
  // follow-up). nginx-family proxies buffer a response body by default, which
  // would hold every delta until the reply finished and turn a stream into a
  // slow non-stream — the failure would look like latency, not like a bug.
  "X-Accel-Buffering": "no",
};

export type ChatStreamArgs = {
  /** The route's `Request`. Its `signal` is what makes a closed tab cancel generation. */
  req: Request;
  session: ChatSession;
  turn: OpenTurnResult;
  /** The text of the one problem this session is bound to. */
  problemText: string;
  /** The transcript in `sequence` order, including this turn's student message. */
  transcript: ChatMessage[];
  /**
   * AC 21. `lib/chat/safety.ts` found distress in the student's message, so
   * this turn is answered with fixed copy and NO model call.
   */
  distress: boolean;
};

export function chatStreamResponse(args: ChatStreamArgs): Response {
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const write = (event: ChatStreamEvent) => {
        if (!open) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      const close = () => {
        if (!open) return;
        open = false;
        controller.close();
      };

      const { session, turn } = args;
      const assistant = turn.assistantMessage;

      // `session` was read BEFORE `openTurn` incremented the count, so on a new
      // or regenerated turn the row in hand is one behind. A replay increments
      // nothing, so its row is already right. The client renders "turns left"
      // off this, and AC 6's bound is counted in it — reporting it stale would
      // tell a child they have one more turn than they do.
      const sessionForDTO =
        turn.kind === "REPLAY" ? session : { ...session, studentTurnCount: turn.studentTurnCount };

      // The `turn` event goes out BEFORE any AI call, immediately after the two
      // rows exist. This is how a client learns the assistant message id, which
      // is what lets a reconnect reconcile against a row rather than guess.
      write({
        type: "turn",
        userMessage: toChatMessageDTO(turn.userMessage),
        assistantMessageId: assistant.id,
      });

      // ── The replay path: no AI call, no bill, exactly one turn. ──
      if (turn.kind === "REPLAY") {
        if (turn.replayText.length > 0) {
          write({ type: "delta", text: turn.replayText });
        }
        write({
          type: "done",
          message: toChatMessageDTO(assistant),
          session: toChatSessionDTO(sessionForDTO),
        });
        close();
        return;
      }

      // ── AC 21: distress. Fixed copy, no AI call, no tutoring this turn. ──
      //
      // Placed BEFORE the client is even constructed, so "makes no AI call" is
      // structural rather than a branch someone could later reorder past. A
      // REPLAY never reaches here: its stored reply already IS this message.
      if (args.distress) {
        const saved = await db.chatMessage.update({
          where: { id: assistant.id },
          data: {
            content: DISTRESS_SAFETY_MESSAGE,
            partial: false,
            truncated: false,
            // The flag is what lets a transcript reader — and M7 — tell fixed
            // copy from something the tutor said.
            safetyResponse: true,
          },
        });
        write({ type: "delta", text: DISTRESS_SAFETY_MESSAGE });
        write({
          type: "done",
          message: toChatMessageDTO(saved),
          session: toChatSessionDTO(sessionForDTO),
        });
        close();
        return;
      }

      let accumulated = "";
      let clientAborted = false;
      let idleTimedOut = false;
      /**
       * Set by the abort listener; read by the `after()` callback registered
       * below. THE INDIRECTION IS THE POINT — see the registration comment.
       */
      let abortedPartial: string | null = null;
      let firstDeltaAt: number | null = null;
      const startedAt = Date.now();

      /**
       * AC 12's partial persist, registered HERE — eagerly, on every turn,
       * inside the request context — rather than from the abort listener.
       *
       * **This is a fixed bug, not a style choice.** `after()` reads Next's
       * request context out of `AsyncLocalStorage` and THROWS
       * ("`after` was called outside a request scope") when there is none. That
       * context propagates through this stream's own `await`s, but it does NOT
       * propagate into an `AbortSignal` listener: the listener runs in the
       * context of whoever called `abort()`, which is the platform tearing the
       * request down. Calling `after()` from there threw inside an event
       * listener — so nothing was persisted, and nothing reported that.
       *
       * Registering it up front puts the call unambiguously in context; the
       * callback then decides at run time whether there is a partial to write.
       * `after` runs when the response finishes, and for a streaming response
       * an abort IS it finishing, so the ordering is the one AC 12 needs.
       */
      after(async () => {
        if (abortedPartial !== null) await failTurn(assistant.id, abortedPartial);
      });

      let client;
      try {
        client = getAnthropicClient();
      } catch (err) {
        await failTurn(assistant.id, accumulated);
        write(errorEvent(classifyChatFailure(err)));
        close();
        return;
      }

      const anthropicStream = client.messages.stream(
        buildChatTurnRequest({
          renderedContext: session.renderedContext,
          problemText: args.problemText,
          messages: args.transcript,
          assistantMessageId: assistant.id,
          studentTurnCount: turn.studentTurnCount,
          revealAfterTurns: session.revealAfterTurns,
        }),
      );

      // AC 19. The timer is reset by every forwarded delta, so it measures the
      // gap between tokens rather than the length of the reply — a long answer
      // is not a stall. Aborting the SDK stream is what interrupts the loop
      // below; the flag is what tells the catch which failure this was.
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          idleTimedOut = true;
          anthropicStream.abort();
        }, CHAT_IDLE_TIMEOUT_MS);
      };
      resetIdleTimer();

      // AC 12. The tab closed. Cancel generation so a closed tab stops costing
      // output tokens, and schedule the partial write with `after()` — the same
      // mechanism ADR-0005 uses for extraction — so it survives the response
      // being torn down. Best-effort by nature: a hard kill loses it, which is
      // why an empty partial older than the idle budget is treated as retryable
      // rather than as a finished turn.
      const onClientAbort = () => {
        clientAborted = true;
        if (idleTimer) clearTimeout(idleTimer);
        anthropicStream.abort();
        // Hands the text to the already-registered `after()` callback. This
        // listener must NOT call `after()` itself — it has no request context.
        abortedPartial = accumulated;
      };
      args.req.signal.addEventListener("abort", onClientAbort, { once: true });

      try {
        for await (const event of anthropicStream) {
          if (event.type !== "content_block_delta" || event.delta.type !== "text_delta") continue;
          // Only `text_delta` is forwarded. Thinking blocks stream too and are
          // never sent to the child: the reasoning is not the tutoring, and a
          // child watching a model reason about them is a different product.
          if (firstDeltaAt === null) {
            firstDeltaAt = Date.now();
            reportFirstToken(firstDeltaAt - startedAt);
          }
          accumulated += event.delta.text;
          write({ type: "delta", text: event.delta.text });
          resetIdleTimer();
        }

        const final = await anthropicStream.finalMessage();
        if (idleTimer) clearTimeout(idleTimer);

        // Checked most specific first, exactly as `run-extraction.ts` does it:
        // a refusal is a 200 with `stop_reason: 'refusal'`, so it must be read
        // before the content is trusted. AC 18 — the student gets a plain
        // message and a retry, and no `stop_details.category`, model id or
        // provider payload crosses to the browser.
        if (final.stop_reason === "refusal") {
          await failTurn(assistant.id, accumulated, final.usage);
          write(errorEvent("REFUSED"));
          close();
          return;
        }

        // AC 13. Hitting the cap is a SUCCESS that stops mid-sentence, not a
        // failure — the text is real and the student keeps it. `truncated` is
        // what lets the UI say the reply was cut short instead of leaving a
        // child staring at a sentence that just stops.
        const truncated = final.stop_reason === "max_tokens";
        const saved = await db.chatMessage.update({
          where: { id: assistant.id },
          data: {
            content: accumulated,
            partial: false,
            truncated,
            inputTokens: final.usage.input_tokens,
            outputTokens: final.usage.output_tokens,
            // ADR-0012 §4: persisted from day one. Zero across repeated turns
            // is the ONLY signal that the cached prefix is varying, and that
            // failure is otherwise silent and roughly tenfolds the bill.
            cacheReadTokens: final.usage.cache_read_input_tokens ?? null,
            cacheWriteTokens: final.usage.cache_creation_input_tokens ?? null,
          },
        });

        write({
          type: "done",
          message: toChatMessageDTO(saved),
          session: toChatSessionDTO(sessionForDTO),
        });
        close();
      } catch (err) {
        if (idleTimer) clearTimeout(idleTimer);

        // The client is gone. There is nobody to tell, and `after()` already
        // owns the partial write — enqueueing here would push bytes at a torn
        // down response.
        if (clientAborted) {
          close();
          return;
        }

        const code: ChatFailureCode = idleTimedOut ? "TIMEOUT" : classifyChatFailure(err);
        // The exception is logged, never transmitted (AC 18).
        console.error(`chat turn ${assistant.id} failed (${code})`, err);
        await failTurn(assistant.id, accumulated);
        write(errorEvent(code));
        close();
      } finally {
        args.req.signal.removeEventListener("abort", onClientAbort);
      }
    },
  });

  return new Response(body, { status: 200, headers: NDJSON_HEADERS });
}

/**
 * AC 12's "persist the partial and mark it", used by every unhappy exit —
 * abort, idle timeout, refusal and upstream error alike. The row already
 * exists, so there is nothing to create and no way for this to produce a second
 * turn; only content to write.
 *
 * It never throws. It runs on paths where the response is already failing or
 * already gone, and a database error there would replace a handled failure with
 * an unhandled one.
 */
async function failTurn(
  assistantMessageId: string,
  partialText: string,
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null },
): Promise<void> {
  try {
    await db.chatMessage.update({
      where: { id: assistantMessageId },
      data: {
        content: partialText,
        partial: true,
        ...(usage
          ? {
              inputTokens: usage.input_tokens,
              outputTokens: usage.output_tokens,
              cacheReadTokens: usage.cache_read_input_tokens ?? null,
              cacheWriteTokens: usage.cache_creation_input_tokens ?? null,
            }
          : {}),
      },
    });
  } catch (err) {
    console.error(`chat turn ${assistantMessageId}: failed to persist the partial reply`, err);
  }
}

function errorEvent(code: ChatFailureCode): ChatStreamEvent {
  const failure = CHAT_FAILURE_MESSAGES[code];
  return { type: "error", code: failure.code, message: failure.message };
}

/**
 * Typed SDK error classes, most specific first — the same order and the same
 * reasoning as `classifyFailure` in `lib/extraction/run-extraction.ts`.
 * `APIError` extends `AnthropicError`, so checking the base class first would
 * swallow every subclass. Nothing here string-matches an exception message.
 */
function classifyChatFailure(err: unknown): ChatFailureCode {
  if (err instanceof MissingAnthropicApiKeyError) return "INTERNAL";
  if (err instanceof APIConnectionTimeoutError) return "TIMEOUT";
  if (err instanceof AnthropicError) return "UPSTREAM";
  return "INTERNAL";
}

/**
 * AC 2's budget, as a MEASUREMENT rather than an enforcement.
 *
 * Killing a stream that missed the budget would fail the turn for a child who
 * was about to get a good answer, and the budget is an unmeasured guess
 * (`CHAT_FIRST_TOKEN_BUDGET_MS` says so in its own doc comment). This is the
 * first place in the codebase where time-to-first-token can be observed at all
 * — plan §9.1's measurement is not takeable without a stream — so an overrun is
 * recorded and nothing else. No message content and no identifier is logged.
 */
function reportFirstToken(elapsedMs: number): void {
  if (elapsedMs > CHAT_FIRST_TOKEN_BUDGET_MS) {
    console.warn(`chat: first token in ${elapsedMs}ms, over the ${CHAT_FIRST_TOKEN_BUDGET_MS}ms budget (M3 AC 2)`);
  }
}
