import "server-only";

import katex from "katex";

/**
 * Renders an `ExtractedProblemDTO.text` string (plain prose with LaTeX
 * delimited `$…$` inline and `$$…$$` display, per ADR-0005) to safe HTML,
 * server-side only. `import "server-only"` guards against this ever being
 * pulled into a client bundle by mistake — ADR-0005's whole point is that
 * NO KaTeX JavaScript ships to the browser, only `katex.min.css`
 * (`app/layout.tsx`). Only `problem-list.tsx` (a server component) calls
 * this.
 *
 * `trust: false` and `strict: "ignore"` (ADR-0005) mean the output contains
 * no scriptable HTML, so `dangerouslySetInnerHTML` on the result is safe —
 * the input is model output, not user input, and is length-capped by
 * `lib/ai/extraction-schema.ts`'s `text: z.string().max(2000)`.
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

export function renderProblemText(text: string): string {
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
