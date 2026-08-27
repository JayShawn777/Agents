import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ChatSessionDTO } from "@/lib/schemas/dto";

/**
 * AC 6 (plan §4, F24). A session that has ended, and the next action it must
 * offer.
 *
 * The wrap-up message itself is NOT here — it is a stored assistant message
 * written by the closing transaction (ADR-0012 §1), so it appears in the
 * transcript in its proper place and a parent reading the transcript later sees
 * the same ending the child saw. This banner is the surrounding state: the
 * composer is gone, and here is where to go next.
 *
 * AC 6 asks for "a next action" by name. A bounded session that just stops,
 * with nowhere to go, reads to a child as a punishment for using it rather than
 * as a finish — which is the failure the bound exists to prevent.
 *
 * Deliberately says nothing about how the session went. A wrap-up is not a
 * report card, and this surface renders no count, score or percentage (M2
 * AC 20's rule, which does not stop applying because the screen changed).
 */
const REASON: Record<string, string> = {
  CLOSED_TURN_LIMIT: "That's a full session on this problem.",
  CLOSED_TIME_LIMIT: "We're out of time for this session.",
  CLOSED_BY_STUDENT: "You ended this session.",
};

export function SessionLimitBanner({
  session,
  studentId,
}: {
  session: ChatSessionDTO;
  studentId: string;
}) {
  return (
    <Alert>
      <AlertTitle>{REASON[session.status] ?? "This session has finished."}</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <p>You can start a fresh session on this problem whenever you like, or go and try some practice.</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" render={<Link href={`/students/${studentId}`} />}>
            Back to my work
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
