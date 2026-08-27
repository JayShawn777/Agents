import "server-only";

import katex from "katex";

/**
 * Server-side KaTeX segment renderer (plan §5.0, S16), for `lib/practice/**`
 * DTO builders (`textHtml`, `workedSolutionHtml`) — ADR-0005's convention
 * carried into M2: mathematics is LaTeX delimited `$…$` / `$$…$$` inside
 * plain prose, and no KaTeX JavaScript ships to the browser for a
 * server-rendered surface.
 *
 * DEVIATION, FLAGGED: the plan describes this as "extracted from the
 * existing `components/uploads/problem-list.tsx` [render logic]." That
 * logic already lives in its own module — `components/uploads/render-math.ts`
 * — which is a **frontend-owned file** (`components/**`) this task's scope
 * explicitly excludes editing, and it is a near-identical function to the
 * one below. Rather than import across the frontend/backend boundary (which
 * would make an M2 backend module depend on a `components/` file, the
 * opposite of this app's layering) or edit a file outside this track's
 * scope, this is a fresh, independent copy under `lib/`, matching the
 * shared-module home the plan actually specifies (`lib/math/render.ts`).
 * The two implementations are behaviourally identical today; a follow-up
 * (noted in this milestone's report) is to delete one and have both tracks
 * import the single survivor once both are stable and this is not two
 * engineers editing the same file mid-milestone.
 */

const MATH_SEGMENT = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Renders a string containing inline `$…$` / display `$$…$$` LaTeX to safe
 * HTML. `trust: false` and `strict: "ignore"` mean the output contains no
 * scriptable HTML, so `dangerouslySetInnerHTML` on the result is safe — the
 * input is model output (a generated practice problem, or a worked
 * solution), never raw user input, and every caller in `lib/practice/**` is
 * already length-capped by its own zod schema before this ever runs.
 */
export function renderMathText(text: string): string {
  let html = "";
  let lastIndex = 0;

  for (const match of text.matchAll(MATH_SEGMENT)) {
    const index = match.index ?? 0;
    html += escapeHtml(text.slice(lastIndex, index));

    const displayExpression = match[1];
    const inlineExpression = match[2];
    const displayMode = displayExpression !== undefined;
    const expression = displayExpression ?? inlineExpression ?? "";

    html += katex.renderToString(expression, {
      throwOnError: false,
      trust: false,
      strict: "ignore",
      displayMode,
    });

    lastIndex = index + match[0].length;
  }

  html += escapeHtml(text.slice(lastIndex));
  return html;
}
