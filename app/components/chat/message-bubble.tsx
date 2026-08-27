import { TruncatedNotice } from "@/components/chat/truncated-notice";
import type { ChatMessageDTO } from "@/lib/schemas/dto";

/**
 * One message in the transcript (plan §4, F24). Server component, and the ONE
 * place a stored message's markup is decided — the streaming bubble
 * (`streaming-message.tsx`) deliberately reuses these classes rather than
 * inventing its own, so a reply does not visibly reflow the moment it finishes.
 *
 * `contentHtml` is KaTeX rendered SERVER-side by `lib/chat/dto.ts` (AC 17,
 * ADR-0005), so no KaTeX JavaScript ships for a stored transcript. It is
 * non-null only for assistant messages; a student's own message renders as
 * plain text, because a child writing "I have $5 and my sister has $3" must not
 * have their sentence silently reinterpreted as notation.
 *
 * `dangerouslySetInnerHTML` is safe here specifically: `renderMathText` escapes
 * every non-math span and runs KaTeX with `trust: false`, so its output carries
 * no scriptable HTML. See that function's docstring.
 */
export function MessageBubble({ message }: { message: ChatMessageDTO }) {
  const isStudent = message.role === "USER";

  return (
    <div className={isStudent ? "flex justify-end" : "flex justify-start"}>
      <div className="flex max-w-[85ch] flex-col gap-2">
        <div
          className={
            isStudent
              ? "rounded-2xl rounded-br-sm bg-primary px-4 py-3 text-sm text-primary-foreground"
              : "rounded-2xl rounded-bl-sm bg-muted px-4 py-3 text-sm text-foreground"
          }
        >
          {message.contentHtml !== null ? (
            <div
              className="whitespace-pre-wrap [&_.katex]:text-[1.05em]"
              dangerouslySetInnerHTML={{ __html: message.contentHtml }}
            />
          ) : (
            <p className="whitespace-pre-wrap">{message.content}</p>
          )}
        </div>

        {/*
          AC 12. A partial reply is persisted deliberately (ADR-0013 §4) and a
          parent may read it, so it MUST be marked as incomplete rather than
          rendered as the tutor's considered answer. An empty partial is the
          abandoned-turn stub and says something different: nothing arrived.
        */}
        {message.partial ? (
          <p className="px-1 text-xs text-muted-foreground">
            {message.content.length === 0
              ? "This reply didn't come through. Ask again to have another go."
              : "This reply was cut off before it finished."}
          </p>
        ) : null}

        {message.truncated ? <TruncatedNotice /> : null}
      </div>
    </div>
  );
}
