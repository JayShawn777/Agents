/**
 * The current step's caption line (M5, owner's 2026-09-01 decision: captions
 * are ON by default).
 *
 * **The current step's line only, never the whole script.** This component
 * receives `narration` already narrowed to `script.steps[stepIndex].narration`
 * by `LessonPlayer` — it has no access to the whole script, so "the caption
 * shows the whole script" is not a bug that can be written here, it is a type
 * this file cannot express.
 *
 * **Not "use client".** No hooks, no state, no event handler — a plain
 * function of props. It renders inside `LessonPlayer` (already a client
 * component), so it ships to the browser either way; adding the directive
 * here would say "this file needs interactivity" when it does not
 * (CLAUDE.md: push `"use client"` to the smallest leaf that actually needs
 * it, never further).
 *
 * `aria-live="polite"` is on the paragraph itself, unkeyed, so a screen
 * reader gets an in-place text update as steps advance rather than a
 * remounted region — the exact behaviour M4's version already had; this file
 * only adds the `enabled` gate and the caption styling.
 *
 * AC 16's `lesson-text-view.tsx` is untouched and stays the permanent,
 * complete fallback regardless of this toggle — a child with captions off
 * (or a `FAILED`/absent narration run, AC 17) still has the whole script to
 * read there.
 */

export function LessonCaptions({
  narration,
  enabled,
}: {
  narration: string;
  /** Unused directly — kept for a future word-level highlight (out of M5's scope), not needed to key this text. */
  stepIndex: number;
  enabled: boolean;
}) {
  if (!enabled) return null;

  return (
    <p
      className="min-h-[3rem] rounded-lg bg-muted/40 px-4 py-3 text-sm text-foreground"
      aria-live="polite"
      data-testid="lesson-caption"
    >
      {narration}
    </p>
  );
}
