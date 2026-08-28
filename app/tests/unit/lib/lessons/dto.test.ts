import { describe, expect, it } from "vitest";

import { toLessonDetail, toLessonDTO, toLessonFlagDTO, toLessonVersionDTO } from "@/lib/lessons/dto";
import { LESSON_FAILURE_MESSAGES } from "@/lib/errors";

/** `lib/lessons/dto.ts` — plan §3's DTOs. */

const SCRIPT = {
  title: "Adding quarters",
  steps: [
    {
      id: "s1",
      narration: "We start with one quarter plus one quarter.",
      durationMs: 4_000,
      ops: [{ kind: "write", id: "sum", latex: "\\frac{1}{4}+\\frac{1}{4}", at: { x: 0.5, y: 0.3 }, size: "lg" }],
    },
    {
      id: "s2",
      narration: "The bottom number stays the same, so we add only the tops.",
      durationMs: 5_000,
      ops: [{ kind: "circle", id: "ring", target: "sum" }],
    },
    {
      id: "s3",
      narration: "One plus one is two, so the answer is two quarters.",
      durationMs: 3_000,
      ops: [{ kind: "write", id: "answer", latex: "\\frac{2}{4}", at: { x: 0.5, y: 0.6 }, size: "lg" }],
    },
  ],
};

function lesson(overrides: Record<string, unknown> = {}) {
  return {
    id: "les_1",
    status: "READY" as const,
    extractedProblemId: "ep_1",
    practiceProblemId: null,
    currentVersionId: "ver_1",
    createdAt: new Date("2026-08-28T10:00:00Z"),
    versions: [{ id: "ver_1", version: 1, failureCode: null }],
    ...overrides,
  };
}

/**
 * Cast once, here. `LessonScriptVersion.script` is a Prisma `Json` column, so
 * its type is `JsonValue`; a plain object literal does not structurally satisfy
 * it, and casting at every call site would bury the fixture in noise.
 */
function version(overrides: Record<string, unknown> = {}): Parameters<typeof toLessonVersionDTO>[0] {
  return {
    id: "ver_1",
    version: 1,
    status: "READY",
    script: SCRIPT,
    stepCount: 3,
    totalDurationMs: 12_000,
    ...overrides,
  } as unknown as Parameters<typeof toLessonVersionDTO>[0];
}

describe("LessonDTO", () => {
  it("has exactly the contracted keys", () => {
    expect(Object.keys(toLessonDTO(lesson())).sort()).toEqual(
      ["createdAt", "currentVersionId", "failureMessage", "id", "status", "subject", "versionCount"].sort(),
    );
  });

  it("reports the binding as a discriminated subject, for either kind", () => {
    expect(toLessonDTO(lesson()).subject).toEqual({ kind: "EXTRACTED_PROBLEM", id: "ep_1" });
    expect(
      toLessonDTO(lesson({ extractedProblemId: null, practiceProblemId: "pp_1" })).subject,
    ).toEqual({ kind: "PRACTICE_PROBLEM", id: "pp_1" });
  });

  /**
   * AC 10. `failureCode` may name a model, a provider error class or a parse
   * detail; it is mapped through a fixed allowlist and never returned verbatim.
   */
  it("maps a failure code through the allowlist, never verbatim", () => {
    const dto = toLessonDTO(
      lesson({ status: "FAILED", versions: [{ id: "ver_1", version: 1, failureCode: "REFUSED" }] }),
    );
    expect(dto.failureMessage).toBe(LESSON_FAILURE_MESSAGES.REFUSED);
    expect(dto.failureMessage).not.toContain("REFUSED");
  });

  it("falls back to a generic message for a code it does not recognise", () => {
    const dto = toLessonDTO(
      lesson({ status: "FAILED", versions: [{ id: "ver_1", version: 1, failureCode: "claude-opus-5-overloaded" }] }),
    );
    expect(dto.failureMessage).not.toContain("claude");
    expect(dto.failureMessage).toBeTruthy();
  });

  it("carries no failure message while the lesson is still going", () => {
    expect(toLessonDTO(lesson({ status: "AUTHORING" })).failureMessage).toBeNull();
    expect(toLessonDTO(lesson()).failureMessage).toBeNull();
  });

  it("counts versions so a client can offer a regeneration against the cap", () => {
    expect(
      toLessonDTO(lesson({ versions: [
        { id: "ver_1", version: 1, failureCode: null },
        { id: "ver_2", version: 2, failureCode: null },
      ] }))
        .versionCount,
    ).toBe(2);
  });
});

describe("LessonVersionDTO", () => {
  it("has exactly the contracted keys", () => {
    expect(Object.keys(toLessonVersionDTO(version())).sort()).toEqual(
      ["id", "script", "status", "stepCount", "timeline", "totalDurationMs", "version"].sort(),
    );
  });

  /** They describe how we called a vendor, and none of it is a client's business. */
  it("never carries the model, effort, prompt version, schema version or token counts", () => {
    const payload = JSON.stringify(
      toLessonVersionDTO({
        ...version(),
        // Fields deliberately present on the row and absent from the DTO.
        ...({ model: "claude-opus-5", effort: "high", promptVersion: "m4.0", schemaVersion: "1", inputTokens: 900, outputTokens: 4569, failureCode: null } as Record<string, unknown>),
      } as never),
    );
    expect(payload).not.toContain("claude-opus-5");
    expect(payload).not.toContain("m4.0");
    expect(payload).not.toContain("4569");
    expect(payload).not.toContain("promptVersion");
  });

  /** ADR-0019 §3: the LaTeX is rendered on the server so no KaTeX ships to the browser. */
  it("server-renders each write op's LaTeX and keeps the source beside it", () => {
    const dto = toLessonVersionDTO(version());
    const write = dto.script!.steps[0].ops[0] as { kind: string; latex: string; latexHtml: string };

    expect(write.kind).toBe("write");
    expect(write.latexHtml).toContain("katex");
    // AC 16's text view needs readable source, and a screen reader must not be
    // handed KaTeX markup.
    expect(write.latex).toBe("\\frac{1}{4}+\\frac{1}{4}");
  });

  it("leaves annotation ops untouched — there is nothing to render", () => {
    const dto = toLessonVersionDTO(version());
    expect(dto.script!.steps[1].ops[0]).toEqual({ kind: "circle", id: "ring", target: "sum" });
  });

  /** AC 7: the running sum, derived here rather than trusted from the model. */
  it("derives a monotonic timeline from the durations", () => {
    expect(toLessonVersionDTO(version()).timeline).toEqual([
      { stepId: "s1", startOffsetMs: 0, durationMs: 4_000 },
      { stepId: "s2", startOffsetMs: 4_000, durationMs: 5_000 },
      { stepId: "s3", startOffsetMs: 9_000, durationMs: 3_000 },
    ]);
  });

  /**
   * AC 2, as a shape rather than a promise: a version that is not READY cannot
   * hand a client something to draw, whatever is in the column.
   */
  it("returns no script for a version that is not READY", () => {
    for (const status of ["PENDING", "AUTHORING", "FAILED"] as const) {
      const dto = toLessonVersionDTO(version({ status }));
      expect(dto.script).toBeNull();
      expect(dto.timeline).toBeNull();
    }
  });

  /**
   * `script` is a `Json` column, so its TypeScript type is a lie the moment
   * anything writes to the database outside this app. A malformed document must
   * surface as "no script" rather than as a renderer crash in front of a child.
   */
  it("returns no script when the stored document does not validate", () => {
    const dto = toLessonVersionDTO(version({ script: { title: "broken", steps: [{ nope: true }] } }));
    expect(dto.script).toBeNull();
  });

  it("returns no script when the column is null", () => {
    expect(toLessonVersionDTO(version({ script: null })).script).toBeNull();
  });
});

describe("LessonFlagDTO and the detail response", () => {
  it("has exactly the contracted keys", () => {
    const flag = toLessonFlagDTO({
      id: "flag_1",
      versionId: "ver_1",
      stepIndex: 2,
      reason: "CONFUSING",
      createdAt: new Date("2026-08-28T10:05:00Z"),
    });
    expect(Object.keys(flag).sort()).toEqual(["createdAt", "id", "reason", "stepIndex", "versionId"].sort());
    expect(flag.stepIndex).toBe(2);
  });

  it("allows a flag with no step, because AC 18 says the index is optional", () => {
    const flag = toLessonFlagDTO({
      id: "flag_2",
      versionId: "ver_1",
      stepIndex: null,
      reason: "WRONG",
      createdAt: new Date(),
    });
    expect(flag.stepIndex).toBeNull();
  });

  it("pairs the lesson with its current version, or with null before one exists", () => {
    expect(toLessonDetail(lesson(), version()).version?.id).toBe("ver_1");
    expect(toLessonDetail(lesson({ status: "PENDING", currentVersionId: null, versions: [] }), null).version).toBeNull();
  });
});
