import { describe, expect, it } from "vitest";

import {
  DRAW_OP_KINDS,
  DrawOpSchema,
  LessonScriptSchema,
  referencedIds,
  type LessonScript,
} from "@/lib/lessons/script-schema";
import { assertSpeakableNarration, validateScriptReferences, deriveTimeline } from "@/lib/lessons/validate";
import { LESSON_MAX_STEPS, LESSON_MIN_STEPS, NARRATION_CHAR_CAP } from "@/lib/config";

/** `lib/lessons/script-schema.ts` + `validate.ts` — ADR-0014 §2. */

function step(id: string, ops: unknown[], narration = "First, line up the decimal points.") {
  return { id, narration, ops, durationMs: 4_000 };
}

function script(overrides: Partial<LessonScript> = {}): unknown {
  return {
    title: "Adding quarters",
    steps: [
      step("s1", [{ kind: "write", id: "sum", latex: "\\frac{1}{4}+\\frac{1}{4}", at: { x: 0.5, y: 0.3 }, size: "lg" }]),
      step("s2", [{ kind: "circle", id: "ring", target: "sum" }]),
      step("s3", [{ kind: "write", id: "answer", latex: "\\frac{2}{4}", at: { x: 0.5, y: 0.6 }, size: "lg" }]),
    ],
    ...overrides,
  };
}

describe("the closed vocabulary (AC 3)", () => {
  it("accepts every documented primitive", () => {
    const ops: Record<(typeof DRAW_OP_KINDS)[number], unknown> = {
      write: { kind: "write", id: "a", latex: "x", at: { x: 0.1, y: 0.1 }, size: "md" },
      label: { kind: "label", id: "b", text: "carry the one", at: { x: 0.2, y: 0.2 } },
      circle: { kind: "circle", id: "c", target: "a" },
      underline: { kind: "underline", id: "d", target: "a" },
      strike: { kind: "strike", id: "e", target: "a" },
      highlight: { kind: "highlight", id: "f", target: "a" },
      arrow: { kind: "arrow", id: "g", from: "a", to: "b", curve: "arc" },
      brace: { kind: "brace", id: "h", from: "a", to: "b", label: null },
    };
    for (const kind of DRAW_OP_KINDS) {
      expect(DrawOpSchema.safeParse(ops[kind]).success, kind).toBe(true);
    }
  });

  /**
   * The point of a closed union: an unrenderable script must fail at authoring
   * time. If this ever passes, the failure mode moves to a blank canvas in
   * front of a child.
   */
  it("rejects a kind the renderer does not implement", () => {
    expect(DrawOpSchema.safeParse({ kind: "numberline", id: "n", at: { x: 0.1, y: 0.1 } }).success).toBe(false);
    expect(DrawOpSchema.safeParse({ kind: "grid", id: "g" }).success).toBe(false);
  });

  it("keeps DRAW_OP_KINDS and the union in step", () => {
    // A kind added to the union but not the list would ship a renderer that
    // silently skips it.
    const unionKinds = DrawOpSchema.options.map((option) => option.shape.kind.value);
    expect([...unionKinds].sort()).toEqual([...DRAW_OP_KINDS].sort());
  });
});

describe("the normalised canvas (AC 13)", () => {
  it("rejects a coordinate outside 0-1, on either axis", () => {
    const base = { kind: "write", id: "a", latex: "x", size: "md" };
    expect(DrawOpSchema.safeParse({ ...base, at: { x: 1.5, y: 0.5 } }).success).toBe(false);
    expect(DrawOpSchema.safeParse({ ...base, at: { x: 0.5, y: -0.1 } }).success).toBe(false);
    expect(DrawOpSchema.safeParse({ ...base, at: { x: 0, y: 1 } }).success).toBe(true);
  });

  /** Annotations carry no coordinates at all — they point at an element, not a place. */
  it("gives annotation ops no coordinates to get wrong", () => {
    const parsed = DrawOpSchema.parse({ kind: "circle", id: "c", target: "a" });
    expect(parsed).not.toHaveProperty("at");
    expect(referencedIds(parsed)).toEqual(["a"]);
  });
});

describe("the document bounds (AC 8)", () => {
  it("rejects a script with too few or too many steps", () => {
    const one = script({ steps: [step("s1", [{ kind: "label", id: "a", text: "hi", at: { x: 0.1, y: 0.1 } }])] as never });
    expect(LessonScriptSchema.safeParse(one).success).toBe(false);

    const many = script({
      steps: Array.from({ length: LESSON_MAX_STEPS + 1 }, (_, i) =>
        step(`s${i}`, [{ kind: "label", id: `l${i}`, text: "x", at: { x: 0.1, y: 0.1 } }]),
      ) as never,
    });
    expect(LessonScriptSchema.safeParse(many).success).toBe(false);
    expect(LESSON_MIN_STEPS).toBeLessThan(LESSON_MAX_STEPS);
  });

  /** M5's constraint, enforced in M4: one step's narration must fit one TTS request. */
  it("rejects narration past the cap", () => {
    const long = script({
      steps: [
        step("s1", [{ kind: "label", id: "a", text: "x", at: { x: 0.1, y: 0.1 } }], "x".repeat(NARRATION_CHAR_CAP + 1)),
        step("s2", [{ kind: "label", id: "b", text: "x", at: { x: 0.1, y: 0.1 } }]),
        step("s3", [{ kind: "label", id: "c", text: "x", at: { x: 0.1, y: 0.1 } }]),
      ] as never,
    });
    expect(LessonScriptSchema.safeParse(long).success).toBe(false);
  });

  it("rejects a step that draws nothing", () => {
    const empty = script({ steps: [step("s1", []), step("s2", []), step("s3", [])] as never });
    expect(LessonScriptSchema.safeParse(empty).success).toBe(false);
  });

  it("accepts a well-formed script", () => {
    expect(LessonScriptSchema.safeParse(script()).success).toBe(true);
  });

  /** AC 7: the model authors duration only. An authored offset would be a second source of truth. */
  it("has no authored start offset to contradict the derived one", () => {
    const parsed = LessonScriptSchema.parse(script());
    expect(parsed.steps[0]).not.toHaveProperty("startOffsetMs");
  });
});

describe("referential integrity (the check zod cannot do)", () => {
  it("passes a script whose references all resolve backwards", () => {
    expect(validateScriptReferences(LessonScriptSchema.parse(script()))).toEqual([]);
  });

  /**
   * The failure this file exists for: this parses cleanly and renders as an
   * annotation floating over nothing.
   */
  it("catches an annotation pointing at an element nobody wrote", () => {
    const bad = LessonScriptSchema.parse(
      script({
        steps: [
          step("s1", [{ kind: "circle", id: "ring", target: "ghost" }]),
          step("s2", [{ kind: "label", id: "b", text: "x", at: { x: 0.1, y: 0.1 } }]),
          step("s3", [{ kind: "label", id: "c", text: "x", at: { x: 0.1, y: 0.1 } }]),
        ] as never,
      }),
    );
    const issues = validateScriptReferences(bad);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("UNKNOWN_REFERENCE");
  });

  /**
   * Distinguished from the above on purpose: the element exists, but not yet.
   * The canvas builds up in order, so this draws over empty space at the moment
   * it happens however tidy the final frame looks.
   */
  it("catches a reference to an element defined in a LATER step", () => {
    const bad = LessonScriptSchema.parse(
      script({
        steps: [
          step("s1", [{ kind: "circle", id: "ring", target: "later" }]),
          step("s2", [{ kind: "write", id: "later", latex: "x", at: { x: 0.1, y: 0.1 }, size: "md" }]),
          step("s3", [{ kind: "label", id: "c", text: "x", at: { x: 0.1, y: 0.1 } }]),
        ] as never,
      }),
    );
    const issues = validateScriptReferences(bad);
    expect(issues.map((issue) => issue.code)).toEqual(["FORWARD_REFERENCE"]);
  });

  it("catches a duplicated id, which would make an annotation ambiguous", () => {
    const bad = LessonScriptSchema.parse(
      script({
        steps: [
          step("s1", [{ kind: "write", id: "dup", latex: "x", at: { x: 0.1, y: 0.1 }, size: "md" }]),
          step("s2", [{ kind: "write", id: "dup", latex: "y", at: { x: 0.2, y: 0.2 }, size: "md" }]),
          step("s3", [{ kind: "circle", id: "ring", target: "dup" }]),
        ] as never,
      }),
    );
    expect(validateScriptReferences(bad).map((issue) => issue.code)).toContain("DUPLICATE_ID");
  });

  it("catches an op referring to itself", () => {
    const bad = LessonScriptSchema.parse(
      script({
        steps: [
          step("s1", [{ kind: "circle", id: "loop", target: "loop" }]),
          step("s2", [{ kind: "label", id: "b", text: "x", at: { x: 0.1, y: 0.1 } }]),
          step("s3", [{ kind: "label", id: "c", text: "x", at: { x: 0.1, y: 0.1 } }]),
        ] as never,
      }),
    );
    expect(validateScriptReferences(bad).map((issue) => issue.code)).toEqual(["SELF_REFERENCE"]);
  });
});

describe("the speakable guard (M5 plan §8.1) — authoring-path only, NOT a schema constraint", () => {
  it("passes a script whose narration is plain prose, even with LaTeX in the `write` op's latex field", () => {
    // `script()`'s `write` ops already carry LaTeX in `latex` — that field is
    // never spoken, so its presence must not trip the guard.
    expect(assertSpeakableNarration(LessonScriptSchema.parse(script()))).toEqual([]);
  });

  it("catches narration that still carries LaTeX markup", () => {
    const bad = LessonScriptSchema.parse(
      script({
        steps: [
          step("s1", [{ kind: "label", id: "a", text: "x", at: { x: 0.1, y: 0.1 } }], "This is \\frac{1}{4} of the whole."),
          step("s2", [{ kind: "label", id: "b", text: "x", at: { x: 0.1, y: 0.1 } }]),
          step("s3", [{ kind: "label", id: "c", text: "x", at: { x: 0.1, y: 0.1 } }]),
        ] as never,
      }),
    );
    const issues = assertSpeakableNarration(bad);
    expect(issues).toHaveLength(1);
    expect(issues[0].stepIndex).toBe(0);
  });

  /** N3's measured finding: bare operators and coefficients are spoken correctly and must NOT be flagged. */
  it("does not flag bare symbols and operators", () => {
    const ok = LessonScriptSchema.parse(
      script({
        steps: [
          step("s1", [{ kind: "label", id: "a", text: "x", at: { x: 0.1, y: 0.1 } }], "solve for x: 3x plus 5 equals 20"),
          step("s2", [{ kind: "label", id: "b", text: "x", at: { x: 0.1, y: 0.1 } }]),
          step("s3", [{ kind: "label", id: "c", text: "x", at: { x: 0.1, y: 0.1 } }]),
        ] as never,
      }),
    );
    expect(assertSpeakableNarration(ok)).toEqual([]);
  });
});

describe("the derived timeline (AC 7)", () => {
  it("is the running sum of durations, and monotonic by construction", () => {
    const parsed = LessonScriptSchema.parse(script());
    const { offsets, totalDurationMs } = deriveTimeline(parsed);

    expect(offsets.map((entry) => entry.startOffsetMs)).toEqual([0, 4_000, 8_000]);
    expect(totalDurationMs).toBe(12_000);
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i].startOffsetMs).toBe(offsets[i - 1].startOffsetMs + offsets[i - 1].durationMs);
    }
  });
});
