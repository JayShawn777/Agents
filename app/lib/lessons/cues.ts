/**
 * AC 7's cue source.
 *
 * > "the player takes that timeline from an injectable cue source rather than
 * > computing it inline. *(M5 replaces the cue source with narration timings; if
 * > the player owns the timing, M5 becomes a rewrite.)*"
 *
 * That parenthesis is the whole reason this file exists. M4's timeline is the
 * running sum of authored step durations; M5's will be the real speech timings
 * that come back from a TTS vendor, and they will not agree — a narrator does
 * not take exactly 4,000ms to say what the model guessed would take 4,000ms.
 * If the player computed offsets from `durationMs` itself, M5 would have to
 * reach inside it. Instead M5 supplies a different `CueSource` and the player
 * does not change.
 *
 * Everything here is pure and browser-safe.
 */

export type Cue = {
  stepId: string;
  startOffsetMs: number;
  durationMs: number;
};

export type CueSource = {
  cues: readonly Cue[];
  totalDurationMs: number;
  /** The step index showing at `elapsedMs`. Clamped at both ends. */
  stepIndexAt(elapsedMs: number): number;
  /** Where step `index` begins. Clamped, so a caller cannot seek off the end. */
  startOfStep(index: number): number;
};

/**
 * M4's implementation: offsets derived from authored durations.
 *
 * The timeline is passed in already computed (`deriveTimeline`, server-side)
 * rather than recomputed here, so the offsets a client animates to are the same
 * numbers the database stored — one source of truth for "when does step 3
 * start", not two that could drift by a rounding.
 */
export function staticCueSource(timeline: readonly Cue[]): CueSource {
  const cues = [...timeline];
  // The END of the last cue, not the sum of the durations. The two agree only
  // for a contiguous timeline, and this module exists precisely because M5's
  // narration will make it non-contiguous — `cues.test.ts` already builds that
  // shape (offsets 0 / 6200 / 11100), where the sum is 12000 and the real end
  // is 14100. Summing would cut the last step off 2.1 seconds early.
  const last = cues.at(-1);
  const totalDurationMs = last ? last.startOffsetMs + last.durationMs : 0;

  return {
    cues,
    totalDurationMs,

    stepIndexAt(elapsedMs: number): number {
      if (cues.length === 0) return 0;
      if (elapsedMs < 0) return 0;
      // Walk rather than binary-search: a lesson is at most
      // `LESSON_MAX_STEPS` long, and a loop that is obviously correct beats a
      // search that is nearly correct at this size.
      for (let index = cues.length - 1; index >= 0; index--) {
        if (elapsedMs >= cues[index].startOffsetMs) return index;
      }
      return 0;
    },

    startOfStep(index: number): number {
      if (cues.length === 0) return 0;
      const clamped = Math.min(Math.max(index, 0), cues.length - 1);
      return cues[clamped].startOffsetMs;
    },
  };
}
