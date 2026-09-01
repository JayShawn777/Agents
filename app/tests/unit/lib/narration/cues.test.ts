import { describe, expect, it } from "vitest";

import { AlignmentMismatchError, deriveNarrationCues, NarrationCuesSchema } from "@/lib/narration/cues";
import type { NarrationAlignment } from "@/lib/narration/provider";
import ac14Fixture from "@/tests/fixtures/narration/ac14-alignment.json";

/**
 * `lib/narration/cues.ts` — ADR-0021's derivation, gated on plan §8.1's N2/N4
 * (`docs/research/m5-narration-measurement.md`, Part 2).
 *
 * The AC 14 fixture — "solve for x: 3x plus 5 equals 20" — is a REAL captured
 * response (`tests/fixtures/narration/ac14-alignment.json`), not a
 * hand-invented one (retro lesson 20: a fixture must be a state a real writer
 * — here, the vendor's own API — actually produces). The expected word spans
 * below were hand-derived from that fixture's raw arrays independently of
 * `deriveNarrationCues`'s implementation, so this test can actually catch a
 * derivation bug rather than mirroring whatever the function happens to do.
 */

function toAlignment(raw: typeof ac14Fixture.alignment): NarrationAlignment {
  return {
    characters: raw.characters,
    characterStartTimesSeconds: raw.character_start_times_seconds,
    characterEndTimesSeconds: raw.character_end_times_seconds,
  };
}

describe("the AC 14 fixture — a real response, not invented", () => {
  it("groups into exactly the 8 whitespace-delimited words N4 found, with hand-derived spans", () => {
    const cues = deriveNarrationCues(ac14Fixture.text, toAlignment(ac14Fixture.alignment));

    expect(cues.words.map((w) => w.t)).toEqual(["solve", "for", "x:", "3x", "plus", "5", "equals", "20"]);
    expect(cues.words).toEqual([
      { t: "solve", s: 0, e: 464 },
      { t: "for", s: 522, e: 685 },
      { t: "x:", s: 859, e: 1115 },
      { t: "3x", s: 1324, e: 1672 },
      { t: "plus", s: 1718, e: 1927 },
      { t: "5", s: 2009, e: 2252 },
      { t: "equals", s: 2368, e: 2740 },
      { t: "20", s: 2810, e: 3622 },
    ]);
  });

  it("attaches punctuation to the word it touches (\"x:\" stays one word)", () => {
    const cues = deriveNarrationCues(ac14Fixture.text, toAlignment(ac14Fixture.alignment));
    expect(cues.words.some((w) => w.t === "x:")).toBe(true);
  });

  it("takes durationMs from the LAST character's end time, not the last word's", () => {
    const cues = deriveNarrationCues(ac14Fixture.text, toAlignment(ac14Fixture.alignment));
    expect(cues.durationMs).toBe(3622);
  });

  it("produces times that are non-decreasing across the whole sequence", () => {
    const cues = deriveNarrationCues(ac14Fixture.text, toAlignment(ac14Fixture.alignment));
    for (const word of cues.words) {
      expect(word.e).toBeGreaterThanOrEqual(word.s);
    }
    for (let i = 1; i < cues.words.length; i++) {
      expect(cues.words[i].s).toBeGreaterThanOrEqual(cues.words[i - 1].e);
    }
  });

  it("produces a shape that round-trips through NarrationCuesSchema (the persisted format)", () => {
    const cues = deriveNarrationCues(ac14Fixture.text, toAlignment(ac14Fixture.alignment));
    expect(NarrationCuesSchema.safeParse(cues).success).toBe(true);
    expect(cues.v).toBe(1);
  });
});

describe("word grouping rules (ADR-0021's stated derivation)", () => {
  it("emits one word per maximal run of non-whitespace characters", () => {
    const text = "ab cd";
    const alignment: NarrationAlignment = {
      characters: ["a", "b", " ", "c", "d"],
      characterStartTimesSeconds: [0, 0.1, 0.2, 0.3, 0.4],
      characterEndTimesSeconds: [0.1, 0.2, 0.3, 0.4, 0.5],
    };
    const cues = deriveNarrationCues(text, alignment);
    expect(cues.words).toEqual([
      { t: "ab", s: 0, e: 200 },
      { t: "cd", s: 300, e: 500 },
    ]);
  });

  it("produces no word for a run of whitespace", () => {
    const text = "a  b";
    const alignment: NarrationAlignment = {
      characters: ["a", " ", " ", "b"],
      characterStartTimesSeconds: [0, 0.1, 0.2, 0.3],
      characterEndTimesSeconds: [0.1, 0.2, 0.3, 0.4],
    };
    const cues = deriveNarrationCues(text, alignment);
    expect(cues.words).toEqual([
      { t: "a", s: 0, e: 100 },
      { t: "b", s: 300, e: 400 },
    ]);
  });

  it("converts seconds to integer milliseconds with Math.round", () => {
    const text = "a";
    const alignment: NarrationAlignment = {
      characters: ["a"],
      characterStartTimesSeconds: [0.1234],
      characterEndTimesSeconds: [0.5678],
    };
    const cues = deriveNarrationCues(text, alignment);
    expect(cues.words).toEqual([{ t: "a", s: 123, e: 568 }]);
  });
});

describe("ADR-0021's foundation: alignment must reconstruct our own input", () => {
  it("throws AlignmentMismatchError if alignment.characters does not reconstruct the text", () => {
    const alignment: NarrationAlignment = {
      characters: ["h", "i"],
      characterStartTimesSeconds: [0, 0.1],
      characterEndTimesSeconds: [0.1, 0.2],
    };
    expect(() => deriveNarrationCues("bye", alignment)).toThrow(AlignmentMismatchError);
  });

  /**
   * This is the trap ADR-0021 names by name: `normalized_alignment` comes
   * back padded with a leading and trailing space, so feeding it here (as if
   * it were `alignment`) must fail loudly rather than silently shift every
   * cue.
   */
  it("rejects the padded shape normalized_alignment actually has", () => {
    const paddedAlignment: NarrationAlignment = {
      characters: [" ", "h", "i", " "],
      characterStartTimesSeconds: [0, 0, 0.1, 0.2],
      characterEndTimesSeconds: [0, 0.1, 0.2, 0.2],
    };
    expect(() => deriveNarrationCues("hi", paddedAlignment)).toThrow(AlignmentMismatchError);
  });
});

describe("defensive clamping (N4 found no degenerate spans, but the derivation must not assume that forever)", () => {
  it("clamps a word's start to the previous word's end rather than going backwards", () => {
    const text = "a b";
    // Pathological: 'b' claims to start BEFORE 'a' ends.
    const alignment: NarrationAlignment = {
      characters: ["a", " ", "b"],
      characterStartTimesSeconds: [0, 0.5, 0.1],
      characterEndTimesSeconds: [1, 0.5, 0.2],
    };
    const cues = deriveNarrationCues(text, alignment);
    expect(cues.words[1].s).toBeGreaterThanOrEqual(cues.words[0].e);
    expect(cues.words[1].e).toBeGreaterThanOrEqual(cues.words[1].s);
  });
});
