import { z } from "zod";

import {
  LESSON_MAX_OPS_PER_STEP,
  LESSON_MAX_STEP_MS,
  LESSON_MAX_STEPS,
  LESSON_MIN_STEP_MS,
  LESSON_MIN_STEPS,
  NARRATION_CHAR_CAP,
} from "@/lib/config";

/**
 * ADR-0014 §2 — the `LessonScript` document.
 *
 * ONE zod schema that is simultaneously the model's output format, the
 * persistence validator and the TypeScript type, exactly as ADR-0005
 * established for extraction. There is no second definition of this shape
 * anywhere, which is what makes "the model cannot emit something we cannot
 * render" true by construction rather than by review.
 *
 * NOT `server-only`: the player renders these documents in the browser and
 * needs the types. Nothing here reaches a database or a vendor.
 *
 * **The vocabulary is closed on purpose (AC 3).** An unknown `kind` fails
 * parsing, so an unrenderable script is rejected at authoring time rather than
 * discovered as a blank canvas in front of a child. The cost of that choice is
 * that widening the set later invalidates every stored script — which is why
 * `LESSON_SCHEMA_VERSION` is stamped on every row, and why plan §9.2's M4-4
 * measures sufficiency BEFORE any authoring prompt is written.
 */

/**
 * A point in the normalised logical canvas (ADR-0014 §4). 0-1 on both axes,
 * never pixels: the model has no idea what viewport a child is holding, and
 * AC 13 requires the same script to be legible at 375px and at 1280px. The
 * renderer maps to pixels at play time.
 */
export const PointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

/**
 * An element handle. Lowercase, short, and stable — steps refer to each other's
 * output by id and never by coordinate, so a later step can circle a thing an
 * earlier step wrote without either of them agreeing on where it ended up.
 */
export const ElementIdSchema = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/);

/**
 * The eight primitives. All 2D, all addressable, all referring to earlier
 * elements by id.
 *
 * Two families, and the split is the whole design: `write` and `label` PLACE
 * something at a coordinate; the other six ANNOTATE something already placed.
 * Annotations carry no coordinates at all, which is what stops the model
 * inventing an arrow that starts nowhere near the thing it points at.
 */
export const DrawOpSchema = z.discriminatedUnion("kind", [
  /** Mathematics, in the same LaTeX convention as M1's extracted problems (AC 14). */
  z.object({
    kind: z.literal("write"),
    id: ElementIdSchema,
    latex: z.string().min(1).max(200),
    at: PointSchema,
    size: z.enum(["sm", "md", "lg"]),
  }),
  /** Plain words. Prose, not notation — a caption, a step name, a question. */
  z.object({
    kind: z.literal("label"),
    id: ElementIdSchema,
    text: z.string().min(1).max(120),
    at: PointSchema,
  }),
  z.object({ kind: z.literal("circle"), id: ElementIdSchema, target: ElementIdSchema }),
  z.object({ kind: z.literal("underline"), id: ElementIdSchema, target: ElementIdSchema }),
  z.object({ kind: z.literal("strike"), id: ElementIdSchema, target: ElementIdSchema }),
  z.object({ kind: z.literal("highlight"), id: ElementIdSchema, target: ElementIdSchema }),
  z.object({
    kind: z.literal("arrow"),
    id: ElementIdSchema,
    from: ElementIdSchema,
    to: ElementIdSchema,
    curve: z.enum(["straight", "arc"]),
  }),
  z.object({
    kind: z.literal("brace"),
    id: ElementIdSchema,
    from: ElementIdSchema,
    to: ElementIdSchema,
    label: z.string().max(60).nullable(),
  }),
]);

export const LessonStepSchema = z.object({
  /** Stable across regenerations of the same step. M5's cues key off it; AC 18's flags point at it. */
  id: ElementIdSchema,
  /**
   * AC 8. TEXT ONLY — nothing in M4 speaks it. It is also the whole content of
   * AC 16's static text view, so it has to stand on its own without the canvas:
   * narration that says "as you can see here" is a bug this cap will not catch.
   */
  narration: z.string().min(1).max(NARRATION_CHAR_CAP),
  ops: z.array(DrawOpSchema).min(1).max(LESSON_MAX_OPS_PER_STEP),
  /**
   * AC 7. The model authors DURATION only. Start offsets are the running sum,
   * derived at persistence time — see ADR-0014 §2 for why asking for both
   * invites a timeline no schema constraint can validate.
   */
  durationMs: z.number().int().min(LESSON_MIN_STEP_MS).max(LESSON_MAX_STEP_MS),
});

export const LessonScriptSchema = z.object({
  title: z.string().min(1).max(120),
  steps: z.array(LessonStepSchema).min(LESSON_MIN_STEPS).max(LESSON_MAX_STEPS),
});

export type Point = z.infer<typeof PointSchema>;
export type DrawOp = z.infer<typeof DrawOpSchema>;
export type LessonStep = z.infer<typeof LessonStepSchema>;
export type LessonScript = z.infer<typeof LessonScriptSchema>;

/** The `kind` values a renderer must implement. Exported so a test can assert the two agree. */
export const DRAW_OP_KINDS = [
  "write",
  "label",
  "circle",
  "underline",
  "strike",
  "highlight",
  "arrow",
  "brace",
] as const;

export type DrawOpKind = (typeof DRAW_OP_KINDS)[number];

/** The ops that PLACE an element at a coordinate, as opposed to annotating one. */
export function isPlacementOp(op: DrawOp): op is Extract<DrawOp, { at: Point }> {
  return op.kind === "write" || op.kind === "label";
}

/** Every element id an op REFERS TO (not the id it defines). */
export function referencedIds(op: DrawOp): string[] {
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
