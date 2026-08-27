"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * AC 18 and AC 19 (plan §4, F25): a plain message and a retry.
 *
 * `message` is ALWAYS an allowlisted string chosen server-side — either an
 * `ApiError.message` or the `message` on a terminal `{ type: 'error' }` NDJSON
 * event, both drawn from `CHAT_FAILURE_MESSAGES` / `ERROR_MESSAGES`. No stack
 * trace, model identifier, `stop_details` category or provider payload can
 * reach this component, because none of them is ever put on the wire
 * (`lib/chat/stream.ts`). This component does not need to sanitise anything and
 * must not start trying to.
 *
 * Retry re-sends the SAME `clientTurnId`, which is what makes it safe: the turn
 * is idempotent on that key (ADR-0013 §3), so a retry either replays a reply
 * that was already generated — costing nothing — or regenerates one that was
 * abandoned. It never creates a second turn.
 */
export function ChatError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>That didn&apos;t go through</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <p>{message}</p>
        <Button size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  );
}
