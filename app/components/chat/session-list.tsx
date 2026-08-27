import Link from "next/link";

import type { ChatSessionDTO } from "@/lib/schemas/dto";

/**
 * AC 14 (plan §4, F27): the account owner's list of a profile's chat sessions,
 * one row each, with its status.
 *
 * Server component. Renders no transcript content — a session's messages are
 * read on its own page, so this list stays a list rather than becoming a
 * scrollable archive of everything a child has ever said.
 *
 * Deliberately renders no count of turns, no duration and no per-session
 * anything a parent could read as a performance measure. A parent reading
 * transcripts is exercising oversight, not grading; M2 AC 20's rule that a
 * child never sees a falling number has a sibling here, which is that a
 * transcript list is not a report.
 */
const STATUS_LABEL: Record<string, string> = {
  OPEN: "In progress",
  CLOSED_TURN_LIMIT: "Finished",
  CLOSED_TIME_LIMIT: "Finished",
  CLOSED_BY_STUDENT: "Finished",
};

export function SessionList({ sessions }: { sessions: ChatSessionDTO[] }) {
  if (sessions.length === 0) {
    return (
      <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
        This profile hasn&apos;t had any tutor conversations yet.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {sessions.map((session) => (
        <li key={session.id}>
          <Link
            href={`/chat/${session.id}`}
            className="flex flex-col gap-1 rounded-lg border border-border p-4 text-sm transition-colors hover:bg-muted"
          >
            <span className="font-medium text-foreground">
              {new Date(session.openedAt).toLocaleDateString(undefined, {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
            <span className="text-muted-foreground">{STATUS_LABEL[session.status] ?? "Finished"}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
