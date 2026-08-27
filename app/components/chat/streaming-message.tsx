"use client";

/**
 * The in-flight assistant bubble (plan §4, F25).
 *
 * **A deliberate simplification of plan §4, and the reason it is safe.** The
 * plan says this component "lazily imports KaTeX and re-renders on `done`",
 * accepting one lazy chunk on the chat route as a departure from ADR-0005's
 * no-KaTeX-in-the-browser rule. That turns out to be unnecessary: the terminal
 * `done` event carries a full `ChatMessageDTO`, and `contentHtml` on it was
 * already rendered SERVER-side by `lib/chat/dto.ts` before it was put on the
 * wire. So the finished reply's mathematics arrives as HTML, exactly like every
 * other surface in this app.
 *
 * The result is that **no KaTeX JavaScript ships to the browser anywhere**,
 * ADR-0005 holds without an exception, and the chat route carries no lazy
 * chunk. What remains true from the plan's reasoning is the part that motivated
 * it: partial LaTeX cannot be rendered, because a token boundary lands
 * mid-`\frac` constantly. So the bubble shows plain text while streaming and
 * swaps to the server's HTML the moment the reply is complete.
 *
 * So this component only ever renders STREAMING text. The instant `done`
 * arrives, the composer swaps it for a `MessageBubble` built from the event's
 * `ChatMessageDTO`, which carries the server's HTML — there is no state in
 * which this component needs to render mathematics, and no `html` prop.
 *
 * The classes are shared with `message-bubble.tsx` on purpose: that swap must
 * not visibly reflow.
 */
export function StreamingMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-start">
      <div className="flex max-w-[85ch] flex-col gap-2">
        <div className="rounded-2xl rounded-bl-sm bg-muted px-4 py-3 text-sm text-foreground">
          {text.length > 0 ? (
            <p className="whitespace-pre-wrap">{text}</p>
          ) : (
            // AC 2's waiting state. It is replaced by the first delta, so how
            // long it is on screen IS the first-token latency the budget is
            // about — which is why a child should never see it for long.
            <p className="text-muted-foreground" aria-live="polite">
              Thinking…
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
