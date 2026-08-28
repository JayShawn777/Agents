import type { RenderableDrawOp, RenderableLessonScript } from "@/lib/schemas/dto";

/**
 * AC 16 — the lesson as an ordered, static worked example.
 *
 * > "every step's narration text and its drawn content are presented as an
 * > ordered, static worked example, **complete without the canvas**"
 *
 * A SIBLING of the player, not a mode inside it (plan §4). That distinction is
 * the point: this renders no canvas, runs no timers and imports nothing from
 * the player, so it cannot be broken by a change to playback and it works with
 * JavaScript disabled. Server component.
 *
 * **Annotations are described by what they point AT, not by element id.**
 * "Circled around 1/4 + 1/4" means something to a child; "circle → sum" means
 * nothing to anyone. Resolving ids to their own content is what makes this a
 * worked example rather than a dump of the document.
 */
export function LessonTextView({ script }: { script: RenderableLessonScript }) {
  // Every placed element's own content, by id, so an annotation can be
  // described in terms a reader recognises.
  const contentById = new Map<string, { text: string; html: string | null }>();
  for (const step of script.steps) {
    for (const op of step.ops) {
      if (op.kind === "write") contentById.set(op.id, { text: op.latex, html: op.latexHtml });
      else if (op.kind === "label") contentById.set(op.id, { text: op.text, html: null });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-medium text-foreground">{script.title}</h2>
      <ol className="flex flex-col gap-4">
        {script.steps.map((step, index) => (
          <li key={step.id} className="rounded-lg border border-border p-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Step {index + 1}</p>
            <p className="text-sm text-foreground">{step.narration}</p>

            <ul className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
              {step.ops.map((op) => (
                <li key={op.id}>{describe(op, contentById)}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}

function describe(
  op: RenderableDrawOp,
  contentById: Map<string, { text: string; html: string | null }>,
): React.ReactNode {
  const named = (id: string) => contentById.get(id)?.text ?? "the previous step";

  switch (op.kind) {
    case "write":
      // The server-rendered KaTeX, so the text view shows real mathematics too
      // (AC 14 does not stop applying here).
      return <span dangerouslySetInnerHTML={{ __html: op.latexHtml }} />;
    case "label":
      return <span>{op.text}</span>;
    case "circle":
      return <span>Circled: {named(op.target)}</span>;
    case "underline":
      return <span>Underlined: {named(op.target)}</span>;
    case "strike":
      return <span>Crossed out: {named(op.target)}</span>;
    case "highlight":
      return <span>Highlighted: {named(op.target)}</span>;
    case "arrow":
      return (
        <span>
          Arrow from {named(op.from)} to {named(op.to)}
        </span>
      );
    case "brace":
      return (
        <span>
          {op.label ? `${op.label}: ` : "Grouped: "}
          {named(op.from)} to {named(op.to)}
        </span>
      );
    default:
      return null;
  }
}
