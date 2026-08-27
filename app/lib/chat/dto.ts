import "server-only";

import type { ChatMessage, ChatSession } from "@/lib/generated/prisma/client";
import type { ChatMessageDTO, ChatSessionDetailResponse, ChatSessionDTO } from "@/lib/schemas/dto";
import { renderMathText } from "@/lib/math/render";

/**
 * Mapping functions for the M3 chat DTOs (plan §3.3). Mirrors
 * `lib/practice/dto.ts`: this is the ONLY place these shapes are built from
 * Prisma rows, and the load-bearing property of this specific module is that
 * `ChatSession.renderedContext` cannot escape through it.
 *
 * `renderedContext` is the student's grade and per-skill mastery summary,
 * rendered as prose for the model (ADR-0012 §2). It is not copy anyone wrote
 * for a child to read, and M2 AC 20's "no number a child sees may fall" says
 * nothing about it precisely because it was never supposed to reach a child.
 * `contextHash`, `contextVersion`, `systemPromptVersion` and `model` are
 * excluded for the ordinary reason: they describe how we called a vendor.
 *
 * `tests/unit/lib/chat/dto.test.ts` asserts both DTOs' key sets EXACTLY, so a
 * future convenience cannot widen either one by accident.
 */

// A structural shape rather than a Prisma `GetPayload`: the DAL row
// (`ChatSessionWithContext`) is a superset of this and satisfies it with no
// cast, and so does a bare `ChatSession`.
type ChatSessionForDTO = Pick<
  ChatSession,
  | "id"
  | "status"
  | "extractedProblemId"
  | "attemptId"
  | "studentTurnCount"
  | "maxStudentTurns"
  | "expiresAt"
  | "openedAt"
  | "closedAt"
>;

export function toChatSessionDTO(session: ChatSessionForDTO): ChatSessionDTO {
  // The CHECK constraint guarantees exactly one of these is non-null
  // (`tests/integration/chat-session-binding-constraint.test.ts`), so this
  // reads the extracted problem first and falls through to the attempt. The
  // `?? ""` is unreachable while that constraint is live; it exists so a DTO
  // builder cannot be the thing that throws if it ever is not.
  const subject: ChatSessionDTO["subject"] = session.extractedProblemId
    ? { kind: "EXTRACTED_PROBLEM", id: session.extractedProblemId }
    : { kind: "ATTEMPT", id: session.attemptId ?? "" };

  return {
    id: session.id,
    status: session.status,
    subject,
    studentTurnCount: session.studentTurnCount,
    maxStudentTurns: session.maxStudentTurns,
    expiresAt: session.expiresAt.toISOString(),
    openedAt: session.openedAt.toISOString(),
    closedAt: session.closedAt?.toISOString() ?? null,
  };
}

type ChatMessageForDTO = Pick<
  ChatMessage,
  "id" | "role" | "content" | "sequence" | "partial" | "truncated" | "safetyResponse" | "createdAt"
>;

/**
 * `contentHtml` is rendered for ASSISTANT messages ONLY, and that is a rule
 * rather than an optimisation.
 *
 * AC 17 is about the tutor's replies rendering mathematics as mathematics. A
 * student's own message is unbounded free text typed by a child, and running
 * it through a LaTeX renderer means a child who writes "I have $5 and my sister
 * has $3" gets their sentence silently mangled into a formula. `renderMathText`
 * escapes its input either way, so this is not the XSS control — it is the
 * reason the app does not reinterpret a child's words as notation.
 *
 * A client renders `content` as plain text whenever `contentHtml` is null.
 */
export function toChatMessageDTO(message: ChatMessageForDTO): ChatMessageDTO {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    contentHtml: message.role === "ASSISTANT" && message.content.length > 0 ? renderMathText(message.content) : null,
    sequence: message.sequence,
    partial: message.partial,
    truncated: message.truncated,
    safetyResponse: message.safetyResponse,
    createdAt: message.createdAt.toISOString(),
  };
}

/**
 * The `ChatSessionDetailResponse` every non-streaming chat endpoint returns
 * (35, 36, 38 and 39). Built in one place so the open, read and close surfaces
 * cannot disagree about the shape a client parses.
 *
 * `messages` is the FULL transcript in order, never a summary — AC 14's parent
 * read needs all of it, and M7 reads these rows too.
 *
 * A message with `partial: true` and empty `content` is the retryable stub
 * ADR-0013 describes: a turn whose function died before it could persist
 * anything. The client distinguishes it from a real partial reply by that empty
 * content, which is why no extra DTO field exists to say so.
 */
export function toChatSessionDetail(
  session: Parameters<typeof toChatSessionDTO>[0],
  messages: Parameters<typeof toChatMessageDTO>[0][],
): ChatSessionDetailResponse {
  return {
    session: toChatSessionDTO(session),
    messages: messages.map(toChatMessageDTO),
  };
}
