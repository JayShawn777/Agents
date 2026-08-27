import "server-only";

import { withAuth } from "@/lib/api/handler";
import { apiErr, errorResponse } from "@/lib/errors";
import { requireChatSession, type ChatSessionWithContext } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { sendChatMessageInputSchema } from "@/lib/schemas/chat";
import { closeIfPastBounds } from "@/lib/chat/session";
import { openTurn } from "@/lib/chat/turn";
import { chatStreamResponse } from "@/lib/chat/stream";
import { detectsDistress } from "@/lib/chat/safety";
import { CHAT_MESSAGES_PER_HOUR } from "@/lib/config";

/**
 * Endpoint 37 (plan §3.3) — `POST /api/chat/sessions/[sessionId]/messages`.
 *
 * The one route in this app that does not return an `ApiResult<T>` on success.
 * ADR-0013 §2 draws the line precisely: **every failure before the first byte
 * is a normal `ApiResult` with a real status code**, and all six of them are
 * produced by `withAuth()` below, which is what lets M3's status-bearing
 * criteria be asserted by calling this handler directly in Vitest exactly as
 * every other route's are. Once the stream has opened the status is already 200
 * and cannot change, and a failure past that point is a terminal
 * `{ type: 'error' }` event (`lib/chat/stream.ts`).
 *
 * Streaming time counts toward the function duration budget, so this is the one
 * route that raises it.
 */
export const maxDuration = 300;

async function resolveOwnedSession({
  params,
}: {
  params: Record<string, string>;
}): Promise<ChatSessionWithContext | null> {
  const sessionId = params.sessionId;
  if (!sessionId) return null;
  return requireChatSession(sessionId);
}

export const POST = withAuth({
  resolveResource: resolveOwnedSession,
  requireState: (session) => session.studentProfile.status === "ACTIVE",
  // Step 5 — AC 6, and the ONLY gate here that also writes. A session past
  // either bound is closed (status, `closedAt`, and the templated wrap-up
  // message) and only then reported as a conflict, which is ADR-0012 §1's
  // "closed and the request returns 409" in that order. Evaluating it at step 5
  // puts it strictly before the body parse and the rate limit, and therefore
  // unambiguously before any AI call.
  requireFlow: async ({ resource }) => {
    const session = await closeIfPastBounds(resource);
    return session.status === "OPEN";
  },
  requireFlowMessage: "This session has finished. Start a new one on this problem whenever you're ready.",
  // Step 6 — AC 10. The length cap and the empty-message rejection are the zod
  // schema and nothing else, so a malformed or over-length body cannot reach
  // the model: there is no handler to reach.
  bodySchema: sendChatMessageInputSchema,
  // Step 7 — AC 20. Counted per student profile over the trailing hour, like
  // every other cap in this app. This route reaches Anthropic on every call
  // that is not a replay, so without it one authenticated account can buy model
  // calls in a loop.
  rateLimit: async ({ resource }) => {
    const windowStart = new Date(Date.now() - 60 * 60 * 1000);
    const count = await db.chatMessage.count({
      where: {
        role: "USER",
        createdAt: { gte: windowStart },
        session: { studentProfileId: resource.studentProfileId },
      },
    });
    return count < CHAT_MESSAGES_PER_HOUR;
  },
  handler: async ({ req, resource: session, body }) => {
    // Exactly one of these is non-null — the CHECK constraint on `ChatSession`
    // guarantees it, and `tests/integration/chat-session-binding-constraint.test.ts`
    // is that constraint's documentation. Reaching neither means the constraint
    // is gone, which is an invariant violation and not a thing to paper over
    // with a placeholder problem.
    const problemText = session.extractedProblem?.text ?? session.attempt?.practiceProblem.text;
    if (problemText === undefined) {
      console.error(`chat session ${session.id} is bound to neither an extracted problem nor an attempt.`);
      return errorResponse(apiErr("INTERNAL_ERROR"));
    }

    const turn = await openTurn({
      sessionId: session.id,
      clientTurnId: body.clientTurnId,
      content: body.content,
    });

    // Re-read rather than appending to `session.messages`: that snapshot was
    // taken before `openTurn` wrote anything, and on a replay the turn's rows
    // were written by an earlier request and are already in it. One query is
    // cheaper than reasoning about which of the three cases is in front of us.
    const transcript = await db.chatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { sequence: "asc" },
    });

    // AC 21. Evaluated on the student's own message, before the stream is
    // constructed. The turn's rows are still written — a parent reading the
    // transcript (AC 14) must see what their child said and what we replied —
    // but the reply is fixed copy and no request reaches Anthropic.
    const distress = detectsDistress(body.content);

    return chatStreamResponse({ req, session, turn, problemText, transcript, distress });
  },
});
