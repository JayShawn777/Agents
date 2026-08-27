import "server-only";

import { withAuth } from "@/lib/api/handler";
import { successResponse } from "@/lib/errors";
import { requireChatSession, type ChatSessionWithContext } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { closeChatSessionInputSchema } from "@/lib/schemas/chat";
import { closeByStudent } from "@/lib/chat/session";
import { toChatSessionDetail } from "@/lib/chat/dto";

/**
 * Endpoint 39 (plan §3.3) — `POST /api/chat/sessions/[sessionId]/close`.
 *
 * The student choosing to stop. AC 6's third closure reason, alongside the two
 * bounds, and the only one a person picks.
 *
 * **Idempotency, and the one place the contract row reads as self-contradictory.**
 * Plan §3.3 says both "Idempotent" and "409 if already closed". Those cannot
 * both be true of the same request, so they are read as being about different
 * requests, matching endpoint 34's precedent (`.../complete`, which is
 * idempotent for its own terminal state and 409s for the others):
 *
 *   - Already `CLOSED_BY_STUDENT` → **200**, the same body, nothing re-stamped.
 *     A double-click, a retried request or a flaky connection must not be an
 *     error; the student asked for this session to be closed and it is closed.
 *   - Closed by a BOUND (`CLOSED_TURN_LIMIT` / `CLOSED_TIME_LIMIT`) → **409**.
 *     The session ended for a reason the student did not choose, and it carries
 *     a different wrap-up message than the one they would be shown here. A 409
 *     sends the client back to `GET` to find out what actually happened, rather
 *     than silently reporting the wrong ending.
 */
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
  requireFlow: ({ resource }) => resource.status === "OPEN" || resource.status === "CLOSED_BY_STUDENT",
  requireFlowMessage: "This session already finished on its own. Refresh to see how it ended.",
  bodySchema: closeChatSessionInputSchema,
  handler: async ({ resource }) => {
    // The idempotent arm: already closed by the student, so nothing is written
    // and no second wrap-up is appended. `closeByStudent` would also no-op via
    // its `status: 'OPEN'` guard, but returning here means a repeat costs two
    // queries rather than four and says why in the code rather than relying on
    // a guard three files away.
    if (resource.status === "CLOSED_BY_STUDENT") {
      return successResponse(toChatSessionDetail(resource, resource.messages));
    }

    const session = await closeByStudent(resource);
    const messages = await db.chatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { sequence: "asc" },
    });

    return successResponse(toChatSessionDetail(session, messages));
  },
});
