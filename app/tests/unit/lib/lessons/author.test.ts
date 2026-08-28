import { beforeEach, describe, expect, it, vi } from "vitest";

import { LESSON_AUTHORING_TIMEOUT_MS, LESSON_EFFORT, LESSON_MODEL, LESSON_SCHEMA_VERSION } from "@/lib/config";

/** `lib/lessons/author.ts` — the M4 authoring status machine. */

const dbMock = {
  lessonScriptVersion: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  lesson: { update: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") return (arg as (tx: typeof dbMock) => Promise<unknown>)(dbMock);
    return Promise.all(arg as unknown[]);
  }),
};
vi.mock("@/lib/db", () => ({ db: dbMock }));

const parseMock = vi.fn();
vi.mock("@/lib/ai/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/client")>();
  return { ...actual, getAnthropicClient: () => ({ messages: { parse: parseMock } }) };
});

const { authorLesson, reapIfStale } = await import("@/lib/lessons/author");
const { AnthropicError, APIConnectionTimeoutError } = await import("@anthropic-ai/sdk");
const { MissingAnthropicApiKeyError } = await import("@/lib/ai/client");

const SCRIPT = {
  title: "Adding quarters",
  steps: [
    {
      id: "s1",
      narration: "We start with one quarter plus one quarter.",
      durationMs: 4_000,
      ops: [{ kind: "write", id: "sum", latex: "\\frac{1}{4}+\\frac{1}{4}", at: { x: 0.5, y: 0.3 }, size: "lg" }],
    },
    { id: "s2", narration: "The bottom stays the same.", durationMs: 5_000, ops: [{ kind: "circle", id: "ring", target: "sum" }] },
    {
      id: "s3",
      narration: "So the answer is two quarters.",
      durationMs: 3_000,
      ops: [{ kind: "write", id: "answer", latex: "\\frac{2}{4}", at: { x: 0.5, y: 0.6 }, size: "lg" }],
    },
  ],
};

function versionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ver_1",
    lessonId: "les_1",
    status: "PENDING",
    lesson: {
      id: "les_1",
      studentProfile: { gradeLevel: "GRADE_4" },
      extractedProblem: { text: "What is 1/4 + 1/4?", subject: "MATH" },
      practiceProblem: null,
    },
    ...overrides,
  };
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    stop_reason: "end_turn",
    parsed_output: SCRIPT,
    usage: { input_tokens: 900, output_tokens: 1174 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  dbMock.lessonScriptVersion.findUnique.mockResolvedValue(versionRow());
  dbMock.lessonScriptVersion.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "ver_1",
    ...data,
  }));
  dbMock.lessonScriptVersion.updateMany.mockResolvedValue({ count: 1 });
  dbMock.lesson.update.mockResolvedValue({});
  dbMock.lesson.updateMany.mockResolvedValue({ count: 1 });
  parseMock.mockResolvedValue(response());
});

describe("the happy path", () => {
  it("authors, validates, and marks both rows READY", async () => {
    const result = await authorLesson("ver_1");

    expect(result).toEqual({ status: "READY", versionId: "ver_1", stepCount: 3 });
    const final = dbMock.lessonScriptVersion.update.mock.calls.at(-1)?.[0].data;
    expect(final).toMatchObject({
      status: "READY",
      stepCount: 3,
      // AC 7: derived here as the running sum, never trusted from the model.
      totalDurationMs: 12_000,
      schemaVersion: LESSON_SCHEMA_VERSION,
      model: LESSON_MODEL,
      effort: LESSON_EFFORT,
      inputTokens: 900,
      outputTokens: 1174,
    });
  });

  /** AC 19: the repoint is what makes a version current; the old row is untouched. */
  it("repoints the lesson at the new version", async () => {
    await authorLesson("ver_1");
    expect(dbMock.lesson.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { status: "READY", currentVersionId: "ver_1" } }),
    );
  });

  it("moves to AUTHORING before the model is called, so a poll can see it", async () => {
    let statusWhenCalled: unknown;
    parseMock.mockImplementation(async () => {
      statusWhenCalled = dbMock.lesson.update.mock.calls[0]?.[0].data.status;
      return response();
    });

    await authorLesson("ver_1");
    expect(statusWhenCalled).toBe("AUTHORING");
  });

  /** AC 1 / AC 9: the prompt carries the problem and the facts, and no identifier. */
  it("sends the problem text and no identifier", async () => {
    await authorLesson("ver_1");
    const payload = JSON.stringify(parseMock.mock.calls[0][0]);

    expect(payload).toContain("What is 1/4 + 1/4?");
    expect(payload).not.toContain("les_1");
    expect(payload).not.toContain("ver_1");
  });

  it("resolves the subject from a practice problem's skill code", async () => {
    dbMock.lessonScriptVersion.findUnique.mockResolvedValue(
      versionRow({
        lesson: {
          id: "les_1",
          studentProfile: { gradeLevel: "GRADE_4" },
          extractedProblem: null,
          practiceProblem: { text: "What is 1/2 + 1/4?", skillCode: "4.NF.B.3" },
        },
      }),
    );

    const result = await authorLesson("ver_1");
    expect(result.status).toBe("READY");
    expect(JSON.stringify(parseMock.mock.calls[0][0])).toContain("What is 1/2 + 1/4?");
  });
});

describe("failure classification", () => {
  /** Read before the content is trusted — a refusal is a 200. */
  it("treats a refusal as REFUSED, before reading parsed_output", async () => {
    parseMock.mockResolvedValue(response({ stop_reason: "refusal", parsed_output: SCRIPT }));
    expect(await authorLesson("ver_1")).toEqual({ status: "FAILED", failureCode: "REFUSED" });
  });

  /** AC 2 / AC 3: the vocabulary is closed, so an unrenderable script never persists. */
  it("treats a null parse as PARSE_FAILED and persists no script", async () => {
    parseMock.mockResolvedValue(response({ parsed_output: null }));

    expect(await authorLesson("ver_1")).toEqual({ status: "FAILED", failureCode: "PARSE_FAILED" });
    const final = dbMock.lessonScriptVersion.update.mock.calls.at(-1)?.[0].data;
    expect(final.status).toBe("FAILED");
    expect(final.script).not.toEqual(SCRIPT);
  });

  /**
   * The check zod cannot do: this script validates perfectly and still circles
   * an element nobody drew, which renders as an annotation over empty space.
   */
  it("rejects a script that refers to an element nobody drew", async () => {
    parseMock.mockResolvedValue(
      response({
        parsed_output: {
          ...SCRIPT,
          steps: [{ ...SCRIPT.steps[0], ops: [{ kind: "circle", id: "ring", target: "ghost" }] }, ...SCRIPT.steps.slice(1)],
        },
      }),
    );

    expect(await authorLesson("ver_1")).toEqual({ status: "FAILED", failureCode: "INVALID_SCRIPT" });
  });

  it("maps typed SDK errors most-specific-first", async () => {
    const cases: [Error, string][] = [
      [new MissingAnthropicApiKeyError(), "INTERNAL"],
      [new APIConnectionTimeoutError({ message: "timed out" }), "TIMEOUT"],
      [new AnthropicError("something upstream"), "UPSTREAM"],
      [new Error("unknown"), "INTERNAL"],
    ];

    for (const [error, expected] of cases) {
      vi.clearAllMocks();
      dbMock.lessonScriptVersion.findUnique.mockResolvedValue(versionRow());
      dbMock.lessonScriptVersion.update.mockResolvedValue({});
      dbMock.lesson.update.mockResolvedValue({});
      parseMock.mockRejectedValue(error);

      expect(await authorLesson("ver_1")).toEqual({ status: "FAILED", failureCode: expected });
    }
  });

  /**
   * Both are gated at the route. Reaching here without them is an invariant
   * violation, and it must NOT be defaulted — guessing MATH and GRADE_4 is how
   * this project nearly shipped a maths app, and it would put the wrong reading
   * level in front of a child.
   */
  it("refuses to author with no grade level, rather than guessing one", async () => {
    dbMock.lessonScriptVersion.findUnique.mockResolvedValue(
      versionRow({
        lesson: {
          id: "les_1",
          studentProfile: { gradeLevel: null },
          extractedProblem: { text: "x", subject: "MATH" },
          practiceProblem: null,
        },
      }),
    );

    expect(await authorLesson("ver_1")).toEqual({ status: "FAILED", failureCode: "INTERNAL" });
    expect(parseMock).not.toHaveBeenCalled();
  });

  it("refuses to author with no resolvable subject, rather than guessing MATH", async () => {
    dbMock.lessonScriptVersion.findUnique.mockResolvedValue(
      versionRow({
        lesson: {
          id: "les_1",
          studentProfile: { gradeLevel: "GRADE_4" },
          extractedProblem: { text: "x", subject: null },
          practiceProblem: null,
        },
      }),
    );

    expect(await authorLesson("ver_1")).toEqual({ status: "FAILED", failureCode: "INTERNAL" });
    expect(parseMock).not.toHaveBeenCalled();
  });
});

describe("re-entry", () => {
  /** A racing trigger must not author twice — each call is billed. */
  it("skips a version that is not PENDING, making no AI call", async () => {
    for (const status of ["AUTHORING", "READY", "FAILED"]) {
      vi.clearAllMocks();
      dbMock.lessonScriptVersion.findUnique.mockResolvedValue(versionRow({ status }));

      expect(await authorLesson("ver_1")).toEqual({ status: "SKIPPED" });
      expect(parseMock).not.toHaveBeenCalled();
    }
  });

  it("throws for a version id that does not exist, rather than inventing a result", async () => {
    dbMock.lessonScriptVersion.findUnique.mockResolvedValue(null);
    await expect(authorLesson("nope")).rejects.toThrow(/no LessonScriptVersion row/);
  });
});

describe("the stale reaper (AC 6)", () => {
  const lesson = (overrides: Record<string, unknown> = {}) =>
    ({ id: "les_1", status: "AUTHORING", updatedAt: new Date(Date.now() - LESSON_AUTHORING_TIMEOUT_MS - 1_000), ...overrides }) as never;

  it("fails an AUTHORING lesson whose function died, so a client stops polling forever", async () => {
    const result = await reapIfStale(lesson());

    expect(result.status).toBe("FAILED");
    expect(dbMock.lesson.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "les_1", status: "AUTHORING" } }),
    );
    expect(dbMock.lessonScriptVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "FAILED", failureCode: "TIMEOUT" } }),
    );
  });

  it("leaves a lesson still inside the budget alone", async () => {
    const result = await reapIfStale(lesson({ updatedAt: new Date() }));
    expect(result.status).toBe("AUTHORING");
    expect(dbMock.lesson.updateMany).not.toHaveBeenCalled();
  });

  it("leaves a lesson that is not AUTHORING alone", async () => {
    for (const status of ["PENDING", "READY", "FAILED"]) {
      vi.clearAllMocks();
      const result = await reapIfStale(lesson({ status }));
      expect(result.status).toBe(status);
      expect(dbMock.lesson.updateMany).not.toHaveBeenCalled();
    }
  });

  /** The original function recovering just before this read must win. */
  it("writes no version row when it loses the guard race", async () => {
    dbMock.lesson.updateMany.mockResolvedValue({ count: 0 });
    await reapIfStale(lesson());
    expect(dbMock.lessonScriptVersion.updateMany).not.toHaveBeenCalled();
  });
});
