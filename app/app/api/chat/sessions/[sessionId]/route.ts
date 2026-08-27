import "server-only";

import { withAuth } from "@/lib/api/handler";
import { successResponse } from "@/lib/errors";
import { requireChatSession, type ChatSessionWithContext } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { closeIfPastBounds } from "@/lib/chat/session";
import { toChatSessionDetail } from "@/lib/chat/dto";

/**
 * Endpoint 38 (plan §3.3) — `GET /api/chat/sessions/[sessionId]`.
 *
 * Three jobs at once, which is why it is one endpoint rather than three:
 *
 *   - **Reconnect.** After an aborted stream the client re-reads the session to
 *     find out what actually got persisted, rather than guessing from what it
 *     had rendered.
 *   - **Retry (AC 19).** A stalled turn leaves an assistant row that is
 *     `partial` with empty content. That pair is the retryable stub — the
 *     client re-sends the same `clientTurnId` and the streaming route decides
 *     between replaying and regenerating.
 *   - **The parent transcript read (AC 14).** The full conversation, in order.
 *
 * **Auth is Owner, NOT Owner+ACTIVE**, and that is deliberate. The account
 * owner is the consenting parent, and a parent who has just withdrawn consent
 * must still be able to read what the tutor said to their child — that is
 * precisely the moment they are most likely to want to. Gating this on ACTIVE
 * would withhold a child's transcript from the adult entitled to it, at the one
 * moment it matters. Withdrawal stops new data being created; it is the
 * retention job's business to remove the old, not this endpoint's to hide it.
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

export const GET = withAuth({
  resolveResource: resolveOwnedSession,
  handler: async ({ resource }) => {
    // AC 6's lazy half. A conversation abandoned mid-session still reaches a
    // terminal state for whoever reads it next, which is the same `reapIfStale`
    // pattern `lib/extraction/run-extraction.ts` uses — and the reason M3 needs
    // no cron job to close sessions.
    //
    // Only for an ACTIVE profile. `closeIfPastBounds` WRITES — a status
    // transition and a templated wrap-up message — and this is a read path that
    // a parent reaches after withdrawing consent (see the auth note above).
    // Writing a new row against a withdrawn profile is new data about a child
    // we have been told to stop processing; the retention job is already coming
    // for those rows, so there is nothing to gain by tidying their state first.
    const session =
      resource.studentProfile.status === "ACTIVE" ? await closeIfPastBounds(resource) : resource;

    // Re-read the transcript ONLY when this request is what closed the session:
    // the wrap-up message was written after `requireChatSession` took its
    // snapshot, so serving that snapshot would return a closed session whose
    // closing message is missing — and the client would have no reason to ask
    // again.
    const messages =
      session.status === resource.status
        ? resource.messages
        : await db.chatMessage.findMany({
            where: { sessionId: session.id },
            orderBy: { sequence: "asc" },
          });

    return successResponse(toChatSessionDetail(session, messages));
  },
});
