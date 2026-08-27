import "server-only";

import { db } from "@/lib/db";
import type { ChatSession } from "@/lib/generated/prisma/client";
import type { ChatSessionStatus } from "@/lib/domain/enums";

import { CHAT_WRAP_UP_MESSAGES } from "@/lib/chat/prompt";

/**
 * The two statuses a BOUND can produce. `CLOSED_BY_STUDENT` is the third
 * closed status and is reached only by the close endpoint — narrowing here
 * keeps `pastBounds` from claiming it can return a status it never returns,
 * and keeps the wrap-up lookup total.
 */
export type BoundClosureStatus = Extract<ChatSessionStatus, "CLOSED_TURN_LIMIT" | "CLOSED_TIME_LIMIT">;

/**
 * AC 6's session bounds — turns or minutes, whichever comes first.
 *
 * Both limits are read from the ROW, never from `lib/config.ts`. ADR-0012 §1:
 * they are stamped at open for the same reason `ParentalConsent.method` is
 * stamped rather than re-derived — a session that ran under yesterday's limits
 * must stay legible after the config moves, and a limit that shifts under a
 * live conversation is a bug nobody can reproduce.
 */
export function pastBounds(session: ChatSession, now: Date = new Date()): BoundClosureStatus | null {
  if (session.studentTurnCount >= session.maxStudentTurns) return "CLOSED_TURN_LIMIT";
  if (now.getTime() >= session.expiresAt.getTime()) return "CLOSED_TIME_LIMIT";
  return null;
}

/**
 * Closes a session that has reached either bound, writing the templated
 * wrap-up as a stored assistant message (AC 6) — the same `reapIfStale` shape
 * `lib/extraction/run-extraction.ts` uses, and the reason M3 needs no cron job.
 *
 * Called from the message POST **before the AI call**, so a session past its
 * bounds is closed and the request is a 409 rather than a turn nobody is
 * entitled to. ADR-0012 §1 also has the GET endpoint call it, so a conversation
 * abandoned mid-session still reaches a terminal state for the parent reading
 * the transcript.
 *
 * Returns the session unchanged when it is not past its bounds, or is already
 * closed.
 */
export async function closeIfPastBounds(session: ChatSession, now: Date = new Date()): Promise<ChatSession> {
  if (session.status !== "OPEN") return session;
  const status = pastBounds(session, now);
  if (!status) return session;
  return writeClosure(session, status, now);
}

/**
 * AC 6's other half — the student choosing to stop (endpoint 39). Same write,
 * a different status and therefore a different wrap-up.
 *
 * Separated from `closeIfPastBounds` rather than folded into it because the two
 * are triggered by opposite things: one is a limit being reached, the other is
 * a person deciding. Sharing `writeClosure` is what keeps them from drifting
 * into two different ideas of what "closed" means.
 */
export async function closeByStudent(session: ChatSession, now: Date = new Date()): Promise<ChatSession> {
  return writeClosure(session, "CLOSED_BY_STUDENT", now);
}

/**
 * The one place a session is closed and its wrap-up written.
 *
 * The `updateMany` is guarded by `status: 'OPEN'` so it can never clobber a
 * close that landed concurrently — two requests arriving together on an expired
 * session must produce ONE wrap-up message, not two. The message is written
 * only by whoever won that guard, which is what makes that true rather than
 * merely likely.
 */
async function writeClosure(
  session: ChatSession,
  status: BoundClosureStatus | "CLOSED_BY_STUDENT",
  now: Date,
): Promise<ChatSession> {
  const claimed = await db.chatSession.updateMany({
    where: { id: session.id, status: "OPEN" },
    data: { status, closedAt: now },
  });

  if (claimed.count === 1) {
    const highest = await db.chatMessage.aggregate({
      where: { sessionId: session.id },
      _max: { sequence: true },
    });
    await db.chatMessage.create({
      data: {
        sessionId: session.id,
        role: "ASSISTANT",
        content: CHAT_WRAP_UP_MESSAGES[status],
        sequence: (highest._max.sequence ?? 0) + 1,
      },
    });
  }

  return { ...session, status, closedAt: now };
}
