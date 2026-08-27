import { OpenChatButton } from "@/components/chat/open-chat-button";
import { LowConfidenceBadge } from "@/components/uploads/low-confidence-badge";
import { ProblemRowActions } from "@/components/uploads/problem-row-actions";
import { renderProblemText } from "@/components/uploads/render-math";
import type { ExtractedProblemDTO } from "@/lib/schemas/dto";

/**
 * The extracted problems, editable so a student can correct a misread (plan
 * §4/§5.2, F16; M1 AC 21, 26, 28, 29; ADR-0005). Server component — math
 * rendering (`katex.renderToString`, via `render-math.ts`) happens HERE,
 * server-side, so no KaTeX JavaScript ships to the browser. Each row's
 * edit/delete affordance is delegated to the client `ProblemRowActions`.
 *
 * Ordinals are the model's report of position on the page and are NEVER
 * renumbered after a delete (M1 AC 29) — display falls back to the list
 * position only when a problem has no `label`, so a gap in `ordinal` after
 * a delete is invisible to the student.
 */
export function ProblemList({
  extractionId,
  problems,
  editable,
  chatEnabled = false,
}: {
  extractionId: string;
  problems: ExtractedProblemDTO[];
  editable: boolean;
  /**
   * M3 AC 1's entry point, on only once the extraction is CONFIRMED — chat is
   * bound to a problem the student has actually reviewed (endpoint 35 enforces
   * the same rule with a 409, so this only decides whether the button is worth
   * offering, never whether it is allowed).
   */
  chatEnabled?: boolean;
}) {
  return (
    <ol className="flex flex-col gap-4">
      {problems.map((problem, index) => (
        <li key={problem.id} className="rounded-lg border border-border p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {problem.label ? `Problem ${problem.label}` : `Problem ${index + 1}`}
            </span>
            {problem.lowConfidence ? <LowConfidenceBadge /> : null}
          </div>
          <ProblemRowActions
            extractionId={extractionId}
            problem={problem}
            renderedHtml={renderProblemText(problem.text)}
            editable={editable}
          />
          {chatEnabled ? (
            <div className="mt-3">
              <OpenChatButton
                subject={{ kind: "EXTRACTED_PROBLEM", problemId: problem.id }}
                label="Ask about this one"
              />
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
