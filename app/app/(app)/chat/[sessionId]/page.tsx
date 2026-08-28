import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatTranscript } from "@/components/chat/chat-transcript";
import { SessionLimitBanner } from "@/components/chat/session-limit-banner";
import { RequestLessonButton, type LessonSubject } from "@/components/lessons/request-lesson-button";
import { requireChatSession } from "@/lib/auth/dal";
import { closeIfPastBounds } from "@/lib/chat/session";
import { toChatSessionDetail } from "@/lib/chat/dto";
import { db } from "@/lib/db";

/**
 * The chat screen (plan §4, F24; M3 AC 1, 2, 6, 13, 17).
 *
 * Server component. It loads the session through the DAL (`requireChatSession`,
 * owner-scoped) rather than fetching its own route handler — the same "no route
 * handler exists to serve data a server component already has" convention as
 * the M1 upload page and the M2 practice page (ADR-0006) — and it builds the
 * DTOs with the SAME `toChatSessionDetail` endpoints 38 and 39 use, so this
 * page's shapes cannot drift from the API's.
 *
 * `notFound()` on a null resolve is AC 15: a cross-account session id and a
 * nonexistent one are indistinguishable, here as at the API boundary.
 *
 * The transcript is rendered on the SERVER, LaTeX included (AC 17). The only
 * client component is the composer, which owns the stream, the abort and the
 * retry.
 *
 * **On the deliberate absence of a `ScrollArea`.** Plan §4 lists one for this
 * surface. The transcript is server-rendered and grows the document, so it
 * scrolls with the page — which on a phone keeps the composer reachable and the
 * history swipeable, where a fixed-height inner scroller puts two scroll
 * regions on one small screen and hides one of them. Noted as a decision rather
 * than an omission.
 */

export const metadata: Metadata = {
  title: "Tutor",
};

export default async function ChatSessionPage({ params }: PageProps<"/chat/[sessionId]">) {
  const { sessionId } = await params;

  const sessionRow = await requireChatSession(sessionId);
  if (!sessionRow) notFound();

  // AC 6's lazy close, the same call endpoint 38 makes — a session abandoned
  // mid-conversation reaches a terminal state for whoever opens it next,
  // including the parent reading it later.
  //
  // Gated on ACTIVE for the same reason as endpoint 38: this WRITES, and a
  // parent may read a transcript after withdrawing consent. See that route.
  const closed =
    sessionRow.studentProfile.status === "ACTIVE" ? await closeIfPastBounds(sessionRow) : sessionRow;
  const messageRows =
    closed.status === sessionRow.status
      ? sessionRow.messages
      : await db.chatMessage.findMany({ where: { sessionId: closed.id }, orderBy: { sequence: "asc" } });

  const { session, messages } = toChatSessionDetail(closed, messageRows);
  const isOpen = session.status === "OPEN";

  // A chat session binds to an extracted problem OR an attempt; a lesson binds
  // to an extracted problem OR a PRACTICE problem. The attempt case therefore
  // has to hop through the attempt to reach the problem a lesson can be about.
  const lessonSubject: LessonSubject | null = sessionRow.extractedProblem
    ? { kind: "EXTRACTED_PROBLEM", problemId: sessionRow.extractedProblem.id }
    : sessionRow.attempt
      ? { kind: "PRACTICE_PROBLEM", problemId: sessionRow.attempt.practiceProblem.id }
      : null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Working on this together</h1>
        {/*
          A turn counter, never a score. It only counts UP and it names a
          boundary the student was told about, which is the distinction M2 AC 20
          draws — and the reason a bounded session does not need a progress bar
          whose fill can fall.
        */}
        <p className="text-sm text-muted-foreground">
          {isOpen
            ? `Message ${session.studentTurnCount} of ${session.maxStudentTurns} in this session.`
            : "This session has finished."}
        </p>
      </div>

      {/*
        M3's spec named this hand-off and deliberately left the seam: "a chat
        turn will later be able to trigger a lesson". This is M4 taking it.
        The subject is resolved from the session's own binding — an
        attempt-bound session points at the PRACTICE PROBLEM, because that is
        what endpoint 41 addresses and what a lesson is actually about.
      */}
      {lessonSubject ? (
        <RequestLessonButton subject={lessonSubject} label="Show me on the whiteboard" variant="ghost" />
      ) : null}

      <ChatTranscript messages={messages} />

      {isOpen ? (
        <ChatComposer sessionId={session.id} serverMessageIds={messages.map((message) => message.id)} />
      ) : (
        <SessionLimitBanner session={session} studentId={sessionRow.studentProfileId} />
      )}
    </div>
  );
}
