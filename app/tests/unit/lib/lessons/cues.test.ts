import { describe, expect, it } from "vitest";

import { narrationCueSource, staticCueSource, type Cue } from "@/lib/lessons/cues";

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

/**
 * `narrationCueSource` (M5, plan §4) — the thin adapter from a
 * `NarrationStepDTO`-shaped array to the same `CueSource` contract.
 *
 * Fixture note (retro lesson 20): this shape — `stepId`/`startOffsetMs`/
 * `durationMs`, non-contiguous — is exactly what `lib/narration/dto.ts`
 * (backend track, not built yet) will map a READY `LessonNarrationStep` row
 * into; a narrator's actual timing does not match the model's guessed
 * `durationMs`, which is the whole reason this file exists rather than
 * reusing `timeline` unchanged.
 */
describe("narrationCueSource", () => {
  const NARRATION_STEPS = [
    { stepId: "s1", stepIndex: 0, startOffsetMs: 0, durationMs: 3_500 },
    { stepId: "s2", stepIndex: 1, startOffsetMs: 3_500, durationMs: 4_800 },
    { stepId: "s3", stepIndex: 2, startOffsetMs: 8_300, durationMs: 2_900 },
  ];

  it("produces the same CueSource contract as staticCueSource, over real speech timings", () => {
    const source = narrationCueSource(NARRATION_STEPS);
    expect(source.totalDurationMs).toBe(11_200);
    expect(source.stepIndexAt(3_499)).toBe(0);
    expect(source.stepIndexAt(3_500)).toBe(1);
    expect(source.startOfStep(2)).toBe(8_300);
  });

  it("tolerates extra fields on the input (a full NarrationStepDTO, not just a Cue)", () => {
    const withExtras = NARRATION_STEPS.map((step) => ({
      ...step,
      audioUrl: `https://blob.example/${step.stepId}.mp3`,
      audioUrlExpiresAt: new Date().toISOString(),
      words: [],
    }));
    expect(narrationCueSource(withExtras).totalDurationMs).toBe(11_200);
  });

  it("survives no narration steps without throwing", () => {
    const source = narrationCueSource([]);
    expect(source.totalDurationMs).toBe(0);
    expect(source.stepIndexAt(1_000)).toBe(0);
  });
});
