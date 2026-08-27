/**
 * AC 13 (plan §4, F24). The reply hit `CHAT_MAX_OUTPUT_TOKENS` and stops
 * mid-sentence.
 *
 * The criterion is specific: the client must be TOLD the reply was cut short
 * rather than the message simply ending. A child reading a tutor that stops
 * mid-thought concludes the tutor is broken, or worse, that they missed
 * something. Saying so plainly, and offering the obvious next move, costs one
 * line.
 *
 * Server component — the flag is already on the stored row.
 */
export function TruncatedNotice() {
  return (
    <p className="px-1 text-xs text-muted-foreground">
      That answer was longer than I had room for, so it stops partway. Ask me to carry on and I&apos;ll
      pick up where I left off.
    </p>
  );
}
