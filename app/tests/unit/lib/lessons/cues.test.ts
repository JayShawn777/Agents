import { describe, expect, it } from "vitest";

import { staticCueSource, type Cue } from "@/lib/lessons/cues";

/** `lib/lessons/cues.ts` — AC 7's injectable timeline. */

const TIMELINE: Cue[] = [
  { stepId: "s1", startOffsetMs: 0, durationMs: 4_000 },
  { stepId: "s2", startOffsetMs: 4_000, durationMs: 5_000 },
  { stepId: "s3", startOffsetMs: 9_000, durationMs: 3_000 },
];

describe("staticCueSource", () => {
  it("totals the authored durations", () => {
    expect(staticCueSource(TIMELINE).totalDurationMs).toBe(12_000);
  });

  it("resolves an elapsed time to the step showing at it", () => {
    const source = staticCueSource(TIMELINE);
    expect(source.stepIndexAt(0)).toBe(0);
    expect(source.stepIndexAt(3_999)).toBe(0);
    expect(source.stepIndexAt(4_000)).toBe(1);
    expect(source.stepIndexAt(8_999)).toBe(1);
    expect(source.stepIndexAt(9_000)).toBe(2);
  });

  it("clamps at both ends rather than returning something out of range", () => {
    const source = staticCueSource(TIMELINE);
    expect(source.stepIndexAt(-500)).toBe(0);
    expect(source.stepIndexAt(999_999)).toBe(2);
    expect(source.startOfStep(-3)).toBe(0);
    expect(source.startOfStep(99)).toBe(9_000);
  });

  it("survives an empty timeline without throwing", () => {
    const empty = staticCueSource([]);
    expect(empty.totalDurationMs).toBe(0);
    expect(empty.stepIndexAt(1_000)).toBe(0);
    expect(empty.startOfStep(2)).toBe(0);
  });

  /**
   * The offsets are passed in already computed rather than recomputed here, so
   * the numbers a client animates to are the ones the database stored. Two
   * derivations of "when does step 3 start" could drift by a rounding; one
   * cannot.
   */
  it("uses the offsets it was given rather than re-deriving them", () => {
    // A deliberately inconsistent timeline: offsets that do NOT match the
    // running sum. M5 will supply exactly this shape — real speech timings that
    // do not match the model's guessed durations.
    const narrated: Cue[] = [
      { stepId: "s1", startOffsetMs: 0, durationMs: 4_000 },
      { stepId: "s2", startOffsetMs: 6_200, durationMs: 5_000 },
      { stepId: "s3", startOffsetMs: 11_100, durationMs: 3_000 },
    ];
    const source = staticCueSource(narrated);

    expect(source.startOfStep(1)).toBe(6_200);
    expect(source.stepIndexAt(6_200)).toBe(1);
    // Still on step 1 at 6,000ms — the running sum would have said step 2 by
    // 4,000ms, and using it here would desync the canvas from the narration.
    expect(source.stepIndexAt(6_000)).toBe(0);
  });
});
