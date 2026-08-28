import type { DrawOp, Point } from "@/lib/lessons/script-schema";

/**
 * ADR-0019 §2, step 3 — the annotation geometry, as pure functions.
 *
 * Everything here is a pure function of (normalised coordinates, container
 * size, measured boxes). No DOM, no clock, no randomness, no reads of anything
 * global. That is not tidiness:
 *
 *   - **AC 11's determinism lives here.** "The canvas contents at the end of
 *     each step are identical both times" is a property of this module, and it
 *     is checkable without a browser.
 *   - **M4-3's legibility measurement runs against these functions**, so the
 *     measurement and the renderer cannot disagree about where anything is.
 *
 * NOT `server-only` — the player imports it in the browser, and the measurement
 * harness imports it in Node.
 */

/** A rectangle in container pixels, origin at the container's top-left. */
export type Box = { x: number; y: number; width: number; height: number };

export type Viewport = { width: number; height: number };

/**
 * Placed elements are centred on their normalised point. Centring rather than
 * top-left anchoring is what makes the model's own instruction — "leave roughly
 * 0.1 of vertical space between separate lines of work" — mean the same thing to
 * the model and to the renderer. With top-left anchoring, a wide element would
 * grow rightwards out of the space the model reserved for it.
 */
export function centreOf(point: Point, viewport: Viewport): { x: number; y: number } {
  return { x: point.x * viewport.width, y: point.y * viewport.height };
}

/** The box a placed element of `size` occupies when centred on `point`. */
export function boxAt(point: Point, size: { width: number; height: number }, viewport: Viewport): Box {
  const centre = centreOf(point, viewport);
  return {
    x: centre.x - size.width / 2,
    y: centre.y - size.height / 2,
    width: size.width,
    height: size.height,
  };
}

// ─────────────────────────── annotation geometry ───────────────────────────

/**
 * Padding around a target box, in pixels, before an annotation is drawn. A ring
 * drawn exactly on the bounding box reads as a border on the element rather
 * than as a mark made around it.
 */
const ANNOTATION_PADDING = 6;

export type Ellipse = { cx: number; cy: number; rx: number; ry: number };
export type Segment = { x1: number; y1: number; x2: number; y2: number };

/** `circle` — an ellipse around the target, not a circle, because text is wider than it is tall. */
export function ringFor(target: Box): Ellipse {
  return {
    cx: target.x + target.width / 2,
    cy: target.y + target.height / 2,
    // The 0.7 factor is the ratio between a bounding box's half-diagonal and
    // its half-width; without it an ellipse drawn on the box itself clips the
    // corners of what it is meant to enclose.
    rx: target.width / 2 + ANNOTATION_PADDING,
    ry: target.height / 2 + ANNOTATION_PADDING * 0.7,
  };
}

/** `underline` — along the bottom edge, slightly wider than the text. */
export function underlineFor(target: Box): Segment {
  const y = target.y + target.height + ANNOTATION_PADDING * 0.5;
  return { x1: target.x - 2, y1: y, x2: target.x + target.width + 2, y2: y };
}

/** `strike` — through the vertical middle. */
export function strikeFor(target: Box): Segment {
  const y = target.y + target.height / 2;
  return { x1: target.x - 2, y1: y, x2: target.x + target.width + 2, y2: y };
}

/** `highlight` — a filled rectangle behind the target. */
export function highlightFor(target: Box): Box {
  return {
    x: target.x - ANNOTATION_PADDING * 0.5,
    y: target.y - ANNOTATION_PADDING * 0.3,
    width: target.width + ANNOTATION_PADDING,
    height: target.height + ANNOTATION_PADDING * 0.6,
  };
}

/**
 * `arrow` — from the edge of one box to the edge of another, never from centre
 * to centre: an arrow that starts inside the thing it comes from looks like it
 * is pointing at itself.
 *
 * Returns an SVG path. `arc` bows the line perpendicular to its own direction,
 * so the curve is consistent whichever way the two boxes are arranged — a fixed
 * "bow upwards" looks wrong for a vertical arrow.
 */
export function arrowPathFor(from: Box, to: Box, curve: "straight" | "arc"): string {
  const start = edgePointTowards(from, centreOfBox(to));
  const end = edgePointTowards(to, centreOfBox(from));

  if (curve === "straight") {
    return `M ${round(start.x)} ${round(start.y)} L ${round(end.x)} ${round(end.y)}`;
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  // Perpendicular offset, capped so a long arrow does not bow off the canvas.
  const bow = Math.min(length * 0.2, 48);
  const midX = (start.x + end.x) / 2 + (-dy / length) * bow;
  const midY = (start.y + end.y) / 2 + (dx / length) * bow;

  return `M ${round(start.x)} ${round(start.y)} Q ${round(midX)} ${round(midY)} ${round(end.x)} ${round(end.y)}`;
}

/**
 * `brace` — a curly brace spanning two elements, drawn on whichever axis the
 * two are further apart on. Two things side by side get a brace underneath;
 * two things stacked get one to their left.
 */
export function bracePathFor(from: Box, to: Box): { path: string; labelAt: { x: number; y: number } } {
  const horizontal = Math.abs(centreOfBox(to).x - centreOfBox(from).x) >= Math.abs(centreOfBox(to).y - centreOfBox(from).y);

  if (horizontal) {
    const left = Math.min(from.x, to.x);
    const right = Math.max(from.x + from.width, to.x + to.width);
    const y = Math.max(from.y + from.height, to.y + to.height) + ANNOTATION_PADDING * 1.5;
    const mid = (left + right) / 2;
    const depth = 10;
    return {
      path: `M ${round(left)} ${round(y)} Q ${round(left)} ${round(y + depth)} ${round(mid - 6)} ${round(y + depth)} L ${round(mid)} ${round(y + depth * 1.6)} L ${round(mid + 6)} ${round(y + depth)} Q ${round(right)} ${round(y + depth)} ${round(right)} ${round(y)}`,
      labelAt: { x: mid, y: y + depth * 2.4 },
    };
  }

  const top = Math.min(from.y, to.y);
  const bottom = Math.max(from.y + from.height, to.y + to.height);
  const x = Math.min(from.x, to.x) - ANNOTATION_PADDING * 1.5;
  const mid = (top + bottom) / 2;
  const depth = 10;
  return {
    path: `M ${round(x)} ${round(top)} Q ${round(x - depth)} ${round(top)} ${round(x - depth)} ${round(mid - 6)} L ${round(x - depth * 1.6)} ${round(mid)} L ${round(x - depth)} ${round(mid + 6)} Q ${round(x - depth)} ${round(bottom)} ${round(x)} ${round(bottom)}`,
    labelAt: { x: x - depth * 2.4, y: mid },
  };
}

// ─────────────────────────── AC 13 / M4-3 measurement ───────────────────────────

/**
 * AC 13's first half: every drawn element fully within the canvas bounds.
 * Used by the player only as an assertion in tests, and by M4-3's legibility
 * measurement as its primary count.
 */
export function isWithinBounds(box: Box, viewport: Viewport): boolean {
  return box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height;
}

/** Do two boxes intersect at all? */
export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * AC 13's second half is "no two elements overlap ILLEGIBLY", which is not the
 * same as "no two elements overlap": a highlight is supposed to sit behind its
 * target, and a brace's label may touch it. So this measures the fraction of
 * the SMALLER box that is covered — a clip of a few pixels at the corner is
 * legible, half a fraction hidden behind another is not.
 */
export function overlapRatio(a: Box, b: Box): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (width <= 0 || height <= 0) return 0;
  const smaller = Math.min(a.width * a.height, b.width * b.height);
  return smaller === 0 ? 0 : (width * height) / smaller;
}

/** The share of the smaller element that may be covered before it counts as illegible. */
export const ILLEGIBLE_OVERLAP_RATIO = 0.25;

export function overlapsIllegibly(a: Box, b: Box): boolean {
  return overlapRatio(a, b) > ILLEGIBLE_OVERLAP_RATIO;
}

// ─────────────────────────── internals ───────────────────────────

function centreOfBox(box: Box): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Where a ray from the box's centre towards `towards` leaves the box. */
function edgePointTowards(box: Box, towards: { x: number; y: number }): { x: number; y: number } {
  const centre = centreOfBox(box);
  const dx = towards.x - centre.x;
  const dy = towards.y - centre.y;
  if (dx === 0 && dy === 0) return centre;

  const halfWidth = box.width / 2 + ANNOTATION_PADDING * 0.5;
  const halfHeight = box.height / 2 + ANNOTATION_PADDING * 0.5;
  // Scale the direction vector until it touches whichever edge it reaches
  // first. Guarding both divisions keeps a purely vertical or horizontal
  // direction from producing Infinity.
  const scaleX = dx === 0 ? Infinity : halfWidth / Math.abs(dx);
  const scaleY = dy === 0 ? Infinity : halfHeight / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);

  return { x: centre.x + dx * scale, y: centre.y + dy * scale };
}

function round(value: number): number {
  // Rounded to a tenth of a pixel so a path string is stable across runs — AC
  // 11 compares rendered output, and floating-point noise in the last decimal
  // would make two identical renders compare unequal.
  return Math.round(value * 10) / 10;
}

/** Every element id an op needs measured before it can be drawn. */
export function targetsOf(op: DrawOp): string[] {
  switch (op.kind) {
    case "write":
    case "label":
      return [];
    case "circle":
    case "underline":
    case "strike":
    case "highlight":
      return [op.target];
    case "arrow":
    case "brace":
      return [op.from, op.to];
  }
}

// ─────────────────────────── the layout pass (M4-3) ───────────────────────────

/**
 * Shifts a measured box back inside the stage, without resizing it.
 *
 * **Why this exists, and it is not a tidy-up.** M4-3's browser measurement —
 * the first thing ever to render a lesson in Chromium — found the reading
 * fixture's 36-character label at `y: 0.14` measuring `y -3..77` of a 257px
 * stage at 375px. The label wraps to four lines on a phone, `boxAt` centres it
 * on its point, and the stage clips with `overflow-hidden`: a child would have
 * seen the top line of a label sliced off. One of three fixtures failed, which
 * is far above plan §9.2's 5% threshold, so §9.2's "a deterministic layout pass
 * becomes M4 scope" is what this is.
 *
 * **It shifts rather than shrinks** because the model's coordinate is a
 * statement about where a thing belongs relative to the other things, and
 * scaling text down to fit is how a lesson becomes unreadable rather than
 * merely off-centre. A few pixels of movement preserves the arrangement; a
 * smaller font does not.
 *
 * An element larger than the stage on an axis cannot be made to fit by moving
 * it, so it is pinned to the top-left edge of that axis and left overflowing.
 * That keeps `isWithinBounds` false, which is honest: the measurement should
 * still report it rather than have the clamp quietly launder it into a pass.
 */
export function clampToBounds(box: Box, viewport: Viewport): Box {
  const shift = (start: number, extent: number, bound: number): number => {
    if (extent >= bound) return 0;
    return Math.min(Math.max(start, 0), bound - extent);
  };

  return {
    x: shift(box.x, box.width, viewport.width),
    y: shift(box.y, box.height, viewport.height),
    width: box.width,
    height: box.height,
  };
}

/**
 * The correction `clampToBounds` implies, in pixels — what the renderer adds to
 * an element's own centring transform.
 *
 * Returned separately from the clamped box because the two have different
 * consumers: the box feeds the annotation geometry (so a ring drawn around a
 * shifted label moves with it), and the offset feeds CSS. Deriving both from
 * one function is what stops them disagreeing.
 */
export function offsetToBounds(box: Box, viewport: Viewport): { dx: number; dy: number } {
  const clamped = clampToBounds(box, viewport);
  return { dx: clamped.x - box.x, dy: clamped.y - box.y };
}
