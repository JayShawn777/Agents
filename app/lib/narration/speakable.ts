import "server-only";

/**
 * M5 plan §8.1 — measured, not guessed
 * (`docs/research/m5-narration-measurement.md`, Part 2, N3).
 *
 *   | input                        | chars | s/char |
 *   |------------------------------|-------|--------|
 *   | `\frac{1}{4} is one quarter` |    26 | 0.0911 |
 *   | `3x + 5 = 20`                |    11 | 0.1562 |
 *   | `one quarter`                |    11 | 0.1014 |
 *
 * **LaTeX runs BELOW the plain-prose rate**, which is the signature of the
 * markup being SWALLOWED rather than read out — if `\frac{1}{4}` were being
 * spoken literally ("backslash frac open brace one close brace") the rate
 * would be far higher, not lower. The child hears something like "one four
 * is one quarter": a confident, fluent, WRONG explanation of their homework.
 * And because the vendor's character `alignment` still maps 1:1 onto the
 * text we sent (N2), the swallowed characters — `\`, `{`, `}` — still carry
 * real time spans, corrupting the word cues along with the audio.
 *
 * **Bare symbols and operators are the opposite finding and must stay
 * unflagged.** `3x + 5 = 20` runs ABOVE the plain-prose rate — the signature
 * of "three x plus five equals twenty" actually being spoken in full. N3's
 * own conclusion: "No normaliser is needed for `+`, `=` or a coefficient."
 * Flagging bare math here would fail every ordinary lesson step for a
 * problem this measurement shows does not exist.
 *
 * `$`, `^` and `_` are deliberately NOT flagged. A dollar sign in narration
 * prose is far more likely to be currency ("costs $5") than a LaTeX math-mode
 * delimiter, and neither `^` nor `_` was exercised by N3. Flagging characters
 * nobody has actually measured would be inventing a rule — precisely what
 * N1/N3 were run to avoid (plan §8.1: "closed, and derived from what N1/N3
 * actually find, not imagined").
 */
export const UNSPEAKABLE_MARKUP_PATTERN = /\\[a-zA-Z]|[{}]/;

/** `true` if `text` contains none of the markers `UNSPEAKABLE_MARKUP_PATTERN` catches. */
export function isSpeakableNarration(text: string): boolean {
  return !UNSPEAKABLE_MARKUP_PATTERN.test(text);
}
