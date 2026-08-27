/**
 * zod input schemas for the M3 chat flow (plan §3.3, endpoints 35-39).
 *
 * Only the streaming route (#37) has a body today; the session-open, close and
 * transcript-read endpoints are the next slice and their empty/absent schemas
 * are declared here when they are built, not before.
 */

import { z } from "zod";

import { CHAT_MESSAGE_MAX_LENGTH } from "@/lib/config";

// ────────────────── POST /api/chat/sessions/[sessionId]/messages (#37) ──────────────────

/**
 * ADR-0013 §3. `.strict()`, so a body carrying an undeclared key is a 400 with
 * `formErrors` rather than a silently-ignored field.
 *
 * **AC 10 is this schema and nothing else.** `withAuth()`'s step 6 runs before
 * the handler exists, so an over-length or malformed body cannot reach the AI
 * call — there is no length check further in, deliberately, because a second
 * one would be a second place to get the bound wrong.
 *
 * `clientTurnId` is the idempotency key (ADR-0013 §3), NOT a security boundary:
 * the session is already owner-scoped by `withAuth()`'s step 3, so the worst a
 * crafted id can do is collide with the caller's own turn. It is a `uuid`
 * rather than a `cuid` because the CLIENT mints it — `crypto.randomUUID()` is
 * in every browser we support, and nothing ships a cuid generator to the
 * browser for this one field.
 *
 * `.trim()` runs BEFORE `.min(1)`, so a whitespace-only message is a 400 and
 * writes no rows — the same shape as M2's attempt schema, and the reason a
 * child leaning on the space bar does not consume a turn of their session.
 */
export const sendChatMessageInputSchema = z
  .object({
    clientTurnId: z.uuid(),
    content: z.string().trim().min(1).max(CHAT_MESSAGE_MAX_LENGTH),
  })
  .strict();

export type SendChatMessageInput = z.infer<typeof sendChatMessageInputSchema>;

// ────────────── POST .../chat-sessions (#35, #36) ──────────────

/**
 * Both open endpoints take no body. `.strict()` still matters: it makes a
 * caller that invents a field — a grade level, a persona, an opening message —
 * fail loudly at the boundary instead of having it silently ignored.
 */
export const openChatSessionInputSchema = z.object({}).strict();

export type OpenChatSessionInput = z.infer<typeof openChatSessionInputSchema>;

// ────────────── POST /api/chat/sessions/[sessionId]/close (#39) ──────────────

/** No body. `.strict()` for the same reason as the open schema above. */
export const closeChatSessionInputSchema = z.object({}).strict();

export type CloseChatSessionInput = z.infer<typeof closeChatSessionInputSchema>;
