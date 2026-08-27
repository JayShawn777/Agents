import { MessageBubble } from "@/components/chat/message-bubble";
import type { ChatMessageDTO } from "@/lib/schemas/dto";

/**
 * The stored conversation (plan §4, F24). SERVER component: every stored
 * message's LaTeX is already rendered to `contentHtml` by `lib/chat/dto.ts`, so
 * this surface ships no KaTeX JavaScript — the same rule M1 and M2 follow
 * (ADR-0005).
 *
 * The one deliberate departure from that rule lives in `streaming-message.tsx`,
 * which cannot server-render a reply that has not finished arriving. That is
 * documented in plan §4 as a decision rather than an oversight, and it is why
 * `ChatMessageDTO` carries both `content` and a nullable `contentHtml`.
 *
 * Messages arrive in `sequence` order from the DAL and are rendered in that
 * order, not re-sorted here — the transcript's order is the database's, and a
 * second opinion about it in the UI is a way for the two to disagree.
 */
export function ChatTranscript({ messages }: { messages: ChatMessageDTO[] }) {
  return (
    <ol className="flex flex-col gap-4">
      {messages.map((message) => (
        <li key={message.id}>
          <MessageBubble message={message} />
        </li>
      ))}
    </ol>
  );
}
