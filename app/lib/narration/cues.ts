import "server-only";

import { z } from "zod";

import type { NarrationAlignment } from "@/lib/narration/provider";
import { CUE_FORMAT_VERSION } from "@/lib/config";

/**
 * ADR-0021. Our own millisecond word timeline, derived once from the
 * vendor's CHARACTER-level `alignment` — never `normalized_alignment`,
 * which `docs/research/m5-narration-measurement.md` (Part 2, N2) measured
 * coming back padded with a leading AND trailing space, two characters that
 * would shift every cue in a lesson without ever looking like a wrong field
 * name, only like an unexplainable sync bug.
 */

export class AlignmentMismatchError extends Error {
  constructor(expectedLength: number, actualLength: number) {
    super(
      `alignment.characters (${actualLength} chars) does not reconstruct the input text ` +
        `(${expectedLength} chars) — the vendor's response cannot be trusted for cue derivation.`,
    );
    this.name = "AlignmentMismatchError";
  }
}

/**
 * The persisted shape (`NarrationAsset.cues`). Short keys because this is
 * stored once per asset and read on every playback that needs it — `v` is
 * `CUE_FORMAT_VERSION` as a number, stamped alongside the column of the same
 * name so a format change is a data question rather than an archaeology one.
 */
export const NarrationCuesSchema = z.object({
  v: z.number().int(),
  durationMs: z.number().int().nonnegative(),
  words: z.array(
    z.object({
      t: z.string().min(1),
      s: z.number().int().nonnegative(),
      e: z.number().int().nonnegative(),
    }),
  ),
});

export type NarrationCues = z.infer<typeof NarrationCuesSchema>;
export type NarrationWordCue = NarrationCues["words"][number];

/**
 * The derivation rule (ADR-0021, "stated so two people implement it
 * identically"):
 *
 *   - A word is a maximal run of non-whitespace characters in the text WE
 *     SENT (never the vendor's expanded/normalised text).
 *   - Its start is the start time of its first character; its end is the end
 *     time of its last character.
 *   - Times arrive in seconds as floats and are converted with
 *     `Math.round(seconds * 1000)`.
 *   - Punctuation attaches to the word it touches — it is adjacent to
 *     non-whitespace characters, so it is never its own run.
 *   - A run of whitespace produces no word.
 *   - Words are emitted in input order and clamped to be non-decreasing.
 *
 * Throws `AlignmentMismatchError` if `alignment.characters.join("")` does not
 * reconstruct `text` exactly. N2 measured this holding for `alignment` on a
 * real fixture; a caller for whom it is unexpectedly false has vendor data it
 * cannot trust, and must fail the run rather than persist a timeline nobody
 * can verify (ADR-0021's own follow-up list names this as the real decision
 * once N2 answered "does this happen at all").
 */
export function deriveNarrationCues(text: string, alignment: NarrationAlignment): NarrationCues {
  const { characters, characterStartTimesSeconds, characterEndTimesSeconds } = alignment;

  const joined = characters.join("");
  if (joined !== text) {
    throw new AlignmentMismatchError(text.length, joined.length);
  }

  const words: NarrationCues["words"] = [];
  let current: { chars: string[]; startMs: number; endMs: number } | null = null;
  let previousEndMs = 0;

  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i];
    const startMs = Math.round(characterStartTimesSeconds[i] * 1000);
    const endMs = Math.round(characterEndTimesSeconds[i] * 1000);

    if (isWhitespace(ch)) {
      if (current) {
        const closed = closeWord(current, previousEndMs);
        words.push(closed);
        previousEndMs = closed.e;
        current = null;
      }
      continue;
    }

    if (!current) {
      current = { chars: [ch], startMs, endMs };
    } else {
      current.chars.push(ch);
      current.endMs = endMs;
    }
  }
  if (current) {
    words.push(closeWord(current, previousEndMs));
  }

  // The asset's audio duration, from the LAST character's end time overall
  // — not the last WORD's end, so trailing silence (if any) is still
  // reflected in `durationMs`, which is what the step timeline sums.
  const durationMs =
    characterEndTimesSeconds.length > 0
      ? Math.round(characterEndTimesSeconds[characterEndTimesSeconds.length - 1] * 1000)
      : 0;

  return { v: Number(CUE_FORMAT_VERSION), durationMs, words };
}

function isWhitespace(ch: string): boolean {
  return /^\s$/.test(ch);
}

/**
 * Clamped to be non-decreasing against the previous word's end. N4 found no
 * degenerate spans in the measured fixture (zero characters with
 * `end < start`), but a derivation that persists once per asset must not
 * assume that holds forever — this is the repair pass ADR-0021's follow-up
 * list reserves for exactly that case, applied defensively rather than
 * conditionally.
 */
function closeWord(
  current: { chars: string[]; startMs: number; endMs: number },
  previousEndMs: number,
): NarrationWordCue {
  const s = Math.max(current.startMs, previousEndMs);
  const e = Math.max(current.endMs, s);
  return { t: current.chars.join(""), s, e };
}
