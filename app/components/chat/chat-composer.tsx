"use client";

/**
 * The chat composer (plan §4, F25) — and the one client component that owns the
 * NDJSON read, the `AbortController` and the retry.
 *
 * **Why the abort matters (AC 12).** The controller is aborted on unmount, and
 * that abort is what the server sees: it cancels generation so a closed tab
 * stops costing output tokens, and it triggers the server-side partial persist.
 * The browser closing the socket IS the mechanism; there is no "cancel"
 * request. That is why the controller lives in a ref with an unmount cleanup
 * rather than in state.
 *
 * **Why the client keeps its own idle timer (AC 19).** Per ADR-0013 §3, the UI
 * leaves the typing state on `done`, on `error`, or on its own timeout — NEVER
 * on stream end alone. A socket that dies silently produces no terminal event,
 * and a client that trusts stream end would sit in "Thinking…" forever. So a
 * stream that goes quiet past the idle budget is treated exactly like a server
 * timeout, and the generator finishing with no terminal event is too.
 *
 * **Why retry re-sends the same `clientTurnId`.** That key is the idempotency
 * key (ADR-0013 §3). Re-sending it either replays a reply that already
 * generated — costing nothing and billing nothing — or regenerates one that was
 * abandoned. It can never produce a second turn, which is what makes offering a
 * retry button safe at all.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageBubble } from "@/components/chat/message-bubble";
import { StreamingMessage } from "@/components/chat/streaming-message";
import { ChatError } from "@/components/chat/chat-error";
import { apiStream, type StreamErrorEvent } from "@/lib/api/client";
import { CHAT_IDLE_TIMEOUT_MS, CHAT_MESSAGE_MAX_LENGTH } from "@/lib/config";
import { ERROR_MESSAGES } from "@/lib/errors";
import type { ChatMessageDTO, ChatStreamEvent } from "@/lib/schemas/dto";

/** A turn this component has completed but that the server transcript has not caught up with yet. */
type LocalTurn = { userMessage: ChatMessageDTO; assistantMessage: ChatMessageDTO };

type InFlight = {
  clientTurnId: string;
  /** The text as typed, kept so a retry can re-send it verbatim. */
  content: string;
  userMessage: ChatMessageDTO | null;
  streamedText: string;
};

export function ChatComposer({
  sessionId,
  serverMessageIds,
}: {
  sessionId: string;
  /**
   * The ids the SERVER transcript above is already rendering. A locally-held
   * turn is dropped as soon as its ids appear here, which is what makes the
   * hand-off from the streamed bubble to the stored one flicker-free: neither
   * a gap where the message is nowhere, nor a beat where it is in both.
   */
  serverMessageIds: string[];
}) {
  const router = useRouter();

  const [draft, setDraft] = useState("");
  const [localTurns, setLocalTurns] = useState<LocalTurn[]>([]);
  const [inFlight, setInFlight] = useState<InFlight | null>(null);
  const [error, setError] = useState<{ message: string; clientTurnId: string; content: string } | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // AC 12. Unmount — a closed tab, a navigation away — aborts the request, and
  // the server turns that abort into a cancelled generation plus a persisted
  // partial. Nothing else in this component tells the server to stop.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const serverIds = new Set(serverMessageIds);
  const pending = localTurns.filter((turn) => !serverIds.has(turn.assistantMessage.id));

  const send = useCallback(
    async (clientTurnId: string, content: string) => {
      setError(null);
      setInFlight({ clientTurnId, content, userMessage: null, streamedText: "" });

      const controller = new AbortController();
      abortRef.current = controller;

      // The client half of AC 19. Reset by every delta, so it measures the gap
      // between tokens rather than the length of the reply.
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      const resetIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, CHAT_IDLE_TIMEOUT_MS);
      };
      resetIdle();

      const fail = (message: string) => {
        setInFlight(null);
        setError({ message, clientTurnId, content });
      };

      let sawTerminal = false;
      let userMessage: ChatMessageDTO | null = null;

      try {
        const stream = apiStream<ChatStreamEvent>(`/api/chat/sessions/${sessionId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientTurnId, content }),
          signal: controller.signal,
        });

        for await (const event of stream) {
          const chatEvent = event as ChatStreamEvent | StreamErrorEvent;

          if (chatEvent.type === "turn") {
            userMessage = chatEvent.userMessage;
            setInFlight((current) => (current ? { ...current, userMessage: chatEvent.userMessage } : current));
            resetIdle();
            continue;
          }

          if (chatEvent.type === "delta") {
            resetIdle();
            setInFlight((current) =>
              current ? { ...current, streamedText: current.streamedText + chatEvent.text } : current,
            );
            continue;
          }

          if (chatEvent.type === "done") {
            sawTerminal = true;
            if (idleTimer) clearTimeout(idleTimer);
            const settledUser = userMessage;
            if (settledUser) {
              setLocalTurns((turns) => [...turns, { userMessage: settledUser, assistantMessage: chatEvent.message }]);
            }
            setInFlight(null);
            // Pull the stored transcript so the server-rendered bubbles take
            // over — and so the session's own state (turn count, a bound just
            // reached) is re-read rather than inferred here.
            router.refresh();
            break;
          }

          // A terminal error. The message is already an allowlisted string.
          sawTerminal = true;
          if (idleTimer) clearTimeout(idleTimer);
          fail(chatEvent.message);
          // The turn's rows exist server-side even on a failure, so the stored
          // transcript is the truth about what happened.
          router.refresh();
          break;
        }

        // Stream end with no terminal event. ADR-0013 §3 is explicit that this
        // is NOT a success — it is the socket dying quietly, and it is treated
        // as the same timeout the server would have reported.
        if (!sawTerminal) {
          fail(ERROR_MESSAGES.UPSTREAM_ERROR);
        }
      } catch {
        // `apiStream` does not throw for HTTP or network failures; reaching
        // here means the abort landed mid-iteration. An unmount abort has no
        // one to tell, and React would warn about the state update.
        if (timedOut) fail(ERROR_MESSAGES.UPSTREAM_ERROR);
      } finally {
        if (idleTimer) clearTimeout(idleTimer);
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [router, sessionId],
  );

  function onSubmit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    const content = draft.trim();
    if (content.length === 0 || inFlight !== null) return;
    setDraft("");
    // A fresh key per NEW turn. `crypto.randomUUID` is available in every
    // browser this app supports and needs no dependency.
    void send(crypto.randomUUID(), content);
  }

  function onRetry() {
    if (!error) return;
    // The SAME key, deliberately — see this file's header.
    void send(error.clientTurnId, error.content);
  }

  const isBusy = inFlight !== null;
  const tooLong = draft.trim().length > CHAT_MESSAGE_MAX_LENGTH;

  return (
    <div className="flex flex-col gap-4">
      {pending.map((turn) => (
        <div key={turn.assistantMessage.id} className="flex flex-col gap-4">
          <MessageBubble message={turn.userMessage} />
          <MessageBubble message={turn.assistantMessage} />
        </div>
      ))}

      {inFlight ? (
        <div className="flex flex-col gap-4">
          {inFlight.userMessage ? <MessageBubble message={inFlight.userMessage} /> : null}
          <StreamingMessage text={inFlight.streamedText} />
        </div>
      ) : null}

      {error ? <ChatError message={error.message} onRetry={onRetry} /> : null}

      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        <Textarea
          value={draft}
          onChange={(changeEvent) => setDraft(changeEvent.target.value)}
          placeholder="Ask about this problem…"
          rows={3}
          maxLength={CHAT_MESSAGE_MAX_LENGTH}
          disabled={isBusy}
          aria-label="Your message"
          onKeyDown={(keyEvent) => {
            // Enter sends, Shift+Enter makes a new line — the convention every
            // chat surface a child has used already follows.
            if (keyEvent.key === "Enter" && !keyEvent.shiftKey) {
              keyEvent.preventDefault();
              onSubmit(keyEvent);
            }
          }}
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {tooLong ? "That message is a bit too long — try shortening it." : "Press Enter to send."}
          </p>
          <Button type="submit" size="sm" disabled={isBusy || draft.trim().length === 0 || tooLong}>
            {isBusy ? "Sending…" : "Send"}
          </Button>
        </div>
      </form>
    </div>
  );
}
