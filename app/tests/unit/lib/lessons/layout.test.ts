import { describe, expect, it } from "vitest";

import {
  arrowPathFor,
  boxAt,
  bracePathFor,
  centreOf,
  highlightFor,
  ILLEGIBLE_OVERLAP_RATIO,
  clampToBounds,
  isWithinBounds,
  offsetToBounds,
  overlapRatio,
  overlaps,
  overlapsIllegibly,
  ringFor,
  strikeFor,
  underlineFor,
  type Box,
} from "@/lib/lessons/layout";

/** `lib/lessons/layout.ts` — ADR-0019 §2's pure geometry. */

const PHONE = { width: 375, height: 500 };
const LAPTOP = { width: 1280, height: 720 };

const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });

describe("normalised placement (AC 13)", () => {
  it("scales the same point to both viewports without touching the document", () => {
    expect(centreOf({ x: 0.5, y: 0.25 }, PHONE)).toEqual({ x: 187.5, y: 125 });
    expect(centreOf({ x: 0.5, y: 0.25 }, LAPTOP)).toEqual({ x: 640, y: 180 });
  });

  /**
   * Centring, not top-left anchoring. It is what makes the model's own
   * instruction — leave space between lines of work — mean the same thing to
   * the model and to the renderer.
   */
  it("centres a placed element on its point", () => {
    expect(boxAt({ x: 0.5, y: 0.5 }, { width: 100, height: 40 }, PHONE)).toEqual({
      x: 137.5,
      y: 230,
      width: 100,
      height: 40,
    });
  });
});

describe("determinism (AC 11)", () => {
  /**
   * The property AC 11 actually rests on. Every function here is pure, so
   * "played twice, identical both times" is checkable without a browser — which
   * is the whole reason the geometry was pulled out of the component.
   */
  it("produces byte-identical output for the same inputs, repeatedly", () => {
    const a = box(100, 100, 80, 30);
    const b = box(300, 220, 60, 30);

    for (let run = 0; run < 3; run++) {
      expect(arrowPathFor(a, b, "arc")).toBe(arrowPathFor(a, b, "arc"));
      expect(ringFor(a)).toEqual(ringFor(a));
      expect(bracePathFor(a, b).path).toBe(bracePathFor(a, b).path);
    }
  });

  /**
   * Path strings are compared, so floating-point noise in the last decimal
   * would make two identical renders differ. Rounding is part of the contract,
   * not a cosmetic choice.
   */
  it("rounds path coordinates so no float noise reaches the comparison", () => {
    const path = arrowPathFor(box(0, 0, 33, 17), box(101, 67, 29, 13), "arc");
    for (const number of path.match(/-?\d+\.?\d*/g) ?? []) {
      const decimals = number.split(".")[1];
      expect(decimals === undefined || decimals.length <= 1).toBe(true);
    }
  });
});

describe("annotations sit around their target, not on it", () => {
  const target = box(100, 100, 80, 30);

  it("rings the target with an ellipse that encloses it", () => {
    const ring = ringFor(target);
    expect(ring.cx).toBe(140);
    expect(ring.cy).toBe(115);
    // Wider and taller than the box, or it clips what it is meant to enclose.
    expect(ring.rx).toBeGreaterThan(target.width / 2);
    expect(ring.ry).toBeGreaterThan(target.height / 2);
  });

  it("underlines below the box and strikes through its middle", () => {
    expect(underlineFor(target).y1).toBeGreaterThan(target.y + target.height);
    expect(strikeFor(target).y1).toBe(target.y + target.height / 2);
    // Both run at least the full width, so they do not stop short of the text.
    expect(underlineFor(target).x2 - underlineFor(target).x1).toBeGreaterThanOrEqual(target.width);
  });

  it("highlights a rectangle that fully contains the target", () => {
    const highlight = highlightFor(target);
    expect(highlight.x).toBeLessThan(target.x);
    expect(highlight.y).toBeLessThan(target.y);
    expect(highlight.x + highlight.width).toBeGreaterThan(target.x + target.width);
    expect(highlight.y + highlight.height).toBeGreaterThan(target.y + target.height);
  });
});

describe("arrows start at an edge, never at a centre", () => {
  /** An arrow that begins inside the thing it comes from looks like it points at itself. */
  it("leaves the source box and stops at the target box", () => {
    const from = box(0, 0, 100, 40);
    const to = box(400, 0, 100, 40);
    const path = arrowPathFor(from, to, "straight");
    const [startX] = path.match(/M (-?\d+\.?\d*)/)!.slice(1).map(Number);

    // Starts at the right-hand edge of `from` (plus padding), not its centre.
    expect(startX).toBeGreaterThanOrEqual(from.x + from.width / 2);
    expect(startX).toBeLessThan(to.x);
  });

  it("handles a purely vertical arrow without dividing by zero", () => {
    const path = arrowPathFor(box(100, 0, 50, 20), box(100, 300, 50, 20), "straight");
    expect(path).not.toContain("NaN");
    expect(path).not.toContain("Infinity");
  });

  /**
   * The bow is perpendicular to the arrow's own direction, so a vertical arrow
   * curves sideways rather than "upwards" — a fixed bow direction looks wrong
   * for anything not horizontal.
   */
  it("bows an arc perpendicular to its direction, whichever way it runs", () => {
    const horizontal = arrowPathFor(box(0, 100, 40, 20), box(300, 100, 40, 20), "arc");
    const vertical = arrowPathFor(box(100, 0, 40, 20), box(100, 300, 40, 20), "arc");
    expect(horizontal).toContain("Q");
    expect(vertical).toContain("Q");
    expect(horizontal).not.toBe(vertical);
  });

  it("caps the bow so a long arrow does not swing off the canvas", () => {
    const path = arrowPathFor(box(0, 300, 20, 20), box(1200, 300, 20, 20), "arc");
    const controlY = Number(path.match(/Q -?\d+\.?\d* (-?\d+\.?\d*)/)![1]);
    expect(Math.abs(controlY - 310)).toBeLessThanOrEqual(48);
  });
});

describe("braces choose their axis from the arrangement", () => {
  it("goes underneath two elements side by side", () => {
    const { path, labelAt } = bracePathFor(box(0, 100, 60, 30), box(200, 100, 60, 30));
    expect(path.startsWith("M 0 ")).toBe(true);
    // The label sits below both boxes.
    expect(labelAt.y).toBeGreaterThan(130);
  });

  it("goes to the left of two elements stacked vertically", () => {
    const { labelAt } = bracePathFor(box(100, 0, 60, 30), box(100, 200, 60, 30));
    expect(labelAt.x).toBeLessThan(100);
  });
});

describe("the AC 13 / M4-3 measurement helpers", () => {
  it("detects an element outside the canvas at one width but not the other", () => {
    const wide = box(900, 100, 200, 40);
    expect(isWithinBounds(wide, LAPTOP)).toBe(true);
    expect(isWithinBounds(wide, PHONE)).toBe(false);
  });

  it("counts a negative origin as out of bounds", () => {
    expect(isWithinBounds(box(-5, 10, 50, 20), PHONE)).toBe(false);
    expect(isWithinBounds(box(0, 0, 50, 20), PHONE)).toBe(true);
  });

  /**
   * AC 13 says "no two elements overlap ILLEGIBLY", which is not "no two
   * elements overlap": a highlight is supposed to sit behind its target. So the
   * measure is what fraction of the smaller element is covered.
   */
  it("distinguishes a clipped corner from a buried element", () => {
    const a = box(0, 0, 100, 100);
    const clipped = box(95, 95, 100, 100);
    const buried = box(10, 10, 100, 100);

    expect(overlaps(a, clipped)).toBe(true);
    expect(overlapsIllegibly(a, clipped)).toBe(false);
    expect(overlapsIllegibly(a, buried)).toBe(true);
    expect(overlapRatio(a, clipped)).toBeLessThan(ILLEGIBLE_OVERLAP_RATIO);
  });

  it("reports no overlap for separated boxes", () => {
    expect(overlaps(box(0, 0, 50, 50), box(100, 100, 50, 50))).toBe(false);
    expect(overlapRatio(box(0, 0, 50, 50), box(100, 100, 50, 50))).toBe(0);
  });

  it("measures the ratio against the SMALLER element, so a big box cannot hide a small one", () => {
    const big = box(0, 0, 400, 400);
    const small = box(10, 10, 20, 20);
    // The small box is entirely covered; as a share of the big box that would
    // look negligible, which is exactly the wrong reading.
    expect(overlapRatio(big, small)).toBe(1);
    expect(overlapsIllegibly(big, small)).toBe(true);
  });
});

/**
 * The layout pass (M4-3). Every case below is a shape the browser measurement
 * actually produced or would produce; the reading fixture's is the one that
 * failed in Chromium before this existed.
 */
describe("clamping a measured box back into the stage", () => {
  const STAGE = { width: 343, height: 257 };

  it("leaves a box that already fits exactly where it is", () => {
    const fits = box(100, 100, 80, 20);
    expect(clampToBounds(fits, STAGE)).toEqual(fits);
    expect(offsetToBounds(fits, STAGE)).toEqual({ dx: 0, dy: 0 });
  });

  /**
   * The measured failure: the reading fixture's `rule` label at `y: 0.14`,
   * wrapped to four lines on a phone, measured `y -3..77` and was clipped by
   * the stage's `overflow-hidden`. Three pixels down is the whole fix.
   */
  it("pushes a label that overflows the top edge back down", () => {
    const overflowing = box(229, -3, 75, 80);
    expect(clampToBounds(overflowing, STAGE)).toEqual({ x: 229, y: 0, width: 75, height: 80 });
    expect(offsetToBounds(overflowing, STAGE)).toEqual({ dx: 0, dy: 3 });
    expect(isWithinBounds(clampToBounds(overflowing, STAGE), STAGE)).toBe(true);
  });

  it("pulls a box back from the right and bottom edges", () => {
    const overflowing = box(300, 240, 80, 40);
    expect(clampToBounds(overflowing, STAGE)).toEqual({ x: 263, y: 217, width: 80, height: 40 });
    expect(offsetToBounds(overflowing, STAGE)).toEqual({ dx: -37, dy: -23 });
  });

  it("shifts without resizing — the arrangement survives, the font does not shrink", () => {
    const moved = clampToBounds(box(-40, -40, 120, 60), STAGE);
    expect(moved.width).toBe(120);
    expect(moved.height).toBe(60);
  });

  /**
   * An element taller or wider than the stage cannot be made to fit by moving
   * it. Pinning it to the edge and leaving `isWithinBounds` false is deliberate:
   * the clamp must not launder a real overflow into a passing measurement.
   */
  it("pins an element bigger than the stage and still reports it out of bounds", () => {
    const huge = box(-20, -50, 400, 400);
    expect(clampToBounds(huge, STAGE)).toEqual({ x: 0, y: 0, width: 400, height: 400 });
    expect(isWithinBounds(clampToBounds(huge, STAGE), STAGE)).toBe(false);
  });

  /** Applying the clamp to its own output must change nothing — the renderer re-measures. */
  it("is idempotent", () => {
    const once = clampToBounds(box(229, -3, 75, 80), STAGE);
    expect(clampToBounds(once, STAGE)).toEqual(once);
    expect(offsetToBounds(once, STAGE)).toEqual({ dx: 0, dy: 0 });
  });
});
