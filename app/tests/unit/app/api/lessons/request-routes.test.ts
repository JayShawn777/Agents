import { beforeEach, describe, expect, it, vi } from "vitest";

import { LESSONS_PER_HOUR } from "@/lib/config";

/**
 * `app/api/extracted-problems/[problemId]/lessons/route.ts` (endpoint 40),
 * `app/api/practice-problems/[problemId]/lessons/route.ts` (endpoint 41), and
 * `app/api/lessons/[lessonId]/route.ts` (endpoint 42).
 */

/** Faithful `after()`: collects, and runs only when the test says the response ended. */
const afterCallbacks: (() => unknown)[] = [];
const afterMock = vi.fn((cb: () => unknown) => {
  afterCallbacks.push(cb);
});
vi.mock("next/server", () => ({ after: afterMock }));

const dalMock = {
  requireExtractedProblem: vi.fn(),
  requirePracticeProblem: vi.fn(),
  requireLesson: vi.fn(),
  verifySession: vi.fn(async (): Promise<{ userId: string } | null> => ({ userId: "user_1" })),
};
vi.mock("@/lib/auth/dal", () => dalMock);

const authorLessonMock = vi.fn(async () => ({ status: "READY" as const, versionId: "ver_1", stepCount: 3 }));
const reapIfStaleMock = vi.fn(async (lesson: { status: string }) => lesson);
vi.mock("@/lib/lessons/author", () => ({ authorLesson: authorLessonMock, reapIfStale: reapIfStaleMock }));

const dbMock = {
  attempt: { count: vi.fn() },
  chatSession: { count: vi.fn() },
  lesson: { count: vi.fn(), create: vi.fn(), update: vi.fn() },
  lessonScriptVersion: { count: vi.fn(), create: vi.fn(), aggregate: vi.fn() },
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") return (arg as (tx: typeof dbMock) => Promise<unknown>)(dbMock);
    return Promise.all(arg as unknown[]);
  }),
};
vi.mock("@/lib/db", () => ({ db: dbMock }));

const { POST: FROM_EXTRACTED } = await import("@/app/api/extracted-problems/[problemId]/lessons/route");
const { POST: FROM_PRACTICE } = await import("@/app/api/practice-problems/[problemId]/lessons/route");
const { GET: LESSON_GET } = await import("@/app/api/lessons/[lessonId]/route");

// ─────────────────────────── fixtures ───────────────────────────

function extractedProblem(overrides: Record<string, unknown> = {}) {
  return {
    id: "ep_1",
    text: "What is 1/4 + 1/4?",
    extraction: {
      id: "ex_1",
      status: "CONFIRMED",
      upload: {
        id: "up_1",
        studentProfileId: "sp_1",
        studentProfile: { id: "sp_1", status: "ACTIVE", gradeLevel: "GRADE_4" },
      },
    },
    ...overrides,
  };
}

function practiceProblem(overrides: Record<string, unknown> = {}) {
  return {
    id: "pp_1",
    text: "What is 1/2 + 1/4?",
    skillCode: "4.NF.B.3",
    practiceSet: {
      id: "set_1",
      status: "IN_PROGRESS",
      studentProfileId: "sp_1",
      studentProfile: { status: "ACTIVE", gradeLevel: "GRADE_4" },
    },
    attempts: [],
    ...overrides,
  };
}

const req = (url: string, body: unknown = {}) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const extractedCtx = () => ({ params: Promise.resolve({ problemId: "ep_1" }) });
const practiceCtx = () => ({ params: Promise.resolve({ problemId: "pp_1" }) });
const lessonCtx = () => ({ params: Promise.resolve({ lessonId: "les_1" }) });

const EXTRACTED_URL = "http://localhost/api/extracted-problems/ep_1/lessons";
const PRACTICE_URL = "http://localhost/api/practice-problems/pp_1/lessons";

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
  dalMock.verifySession.mockResolvedValue({ userId: "user_1" });
  dalMock.requireExtractedProblem.mockResolvedValue(extractedProblem());
  dalMock.requirePracticeProblem.mockResolvedValue(practiceProblem());
  // Engaged by default: one attempt exists.
  dbMock.attempt.count.mockResolvedValue(1);
  dbMock.chatSession.count.mockResolvedValue(0);
  dbMock.lesson.count.mockResolvedValue(0);
  dbMock.lessonScriptVersion.count.mockResolvedValue(0);
  dbMock.lesson.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "les_1",
    currentVersionId: null,
    createdAt: new Date(),
    extractedProblemId: null,
    practiceProblemId: null,
    ...data,
  }));
  dbMock.lessonScriptVersion.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "ver_1",
    failureCode: null,
    ...data,
  }));
});

// ─────────────────────────── endpoint 40 ───────────────────────────

describe("requesting a lesson on an extracted problem (endpoint 40)", () => {
  it("401s with no session", async () => {
    dalMock.verifySession.mockResolvedValue(null);
    expect((await FROM_EXTRACTED(req(EXTRACTED_URL), extractedCtx())).status).toBe(401);
    expect(dbMock.lesson.create).not.toHaveBeenCalled();
  });

  it("404s a cross-account or unknown problem (AC 20)", async () => {
    dalMock.requireExtractedProblem.mockResolvedValue(null);
    const res = await FROM_EXTRACTED(req(EXTRACTED_URL), extractedCtx());
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toBe("We couldn't find that.");
  });

  it("403s a non-ACTIVE profile", async () => {
    dalMock.requireExtractedProblem.mockResolvedValue(
      extractedProblem({
        extraction: {
          id: "ex_1",
          status: "CONFIRMED",
          upload: {
            id: "up_1",
            studentProfileId: "sp_1",
            studentProfile: { id: "sp_1", status: "CONSENT_WITHDRAWN", gradeLevel: "GRADE_4" },
          },
        },
      }),
    );
    expect((await FROM_EXTRACTED(req(EXTRACTED_URL), extractedCtx())).status).toBe(403);
    expect(dbMock.lesson.create).not.toHaveBeenCalled();
  });

  it("409s until the extraction is CONFIRMED", async () => {
    dalMock.requireExtractedProblem.mockResolvedValue(
      extractedProblem({
        extraction: {
          id: "ex_1",
          status: "COMPLETE",
          upload: {
            id: "up_1",
            studentProfileId: "sp_1",
            studentProfile: { id: "sp_1", status: "ACTIVE", gradeLevel: "GRADE_4" },
          },
        },
      }),
    );
    const res = await FROM_EXTRACTED(req(EXTRACTED_URL), extractedCtx());
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toContain("Check this worksheet over first");
  });

  /**
   * AC 5, and the reason it exists: without it, "explain this to me" sits on
   * every problem the moment a worksheet is uploaded, which is a
   * do-my-homework machine with extra steps.
   */
  it("409s a problem the student has never attempted or discussed (AC 5)", async () => {
    dbMock.attempt.count.mockResolvedValue(0);
    dbMock.chatSession.count.mockResolvedValue(0);

    const res = await FROM_EXTRACTED(req(EXTRACTED_URL), extractedCtx());
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toContain("Have a go at this one first");
    expect(dbMock.lesson.create).not.toHaveBeenCalled();
    expect(authorLessonMock).not.toHaveBeenCalled();
  });

  /**
   * The student never attempts an extracted row itself — M1 extracts it, M2
   * generates practice FROM it. Requiring an attempt on the extracted row would
   * make the gate unsatisfiable rather than strict.
   */
  it("accepts an attempt on a practice problem derived from it", async () => {
    dbMock.attempt.count.mockResolvedValue(1);
    dbMock.chatSession.count.mockResolvedValue(0);
    expect((await FROM_EXTRACTED(req(EXTRACTED_URL), extractedCtx())).status).toBe(202);
  });

  it("accepts a chat session on it, with no attempt at all", async () => {
    dbMock.attempt.count.mockResolvedValue(0);
    dbMock.chatSession.count.mockResolvedValue(1);
    expect((await FROM_EXTRACTED(req(EXTRACTED_URL), extractedCtx())).status).toBe(202);
  });

  it("409s a profile with no grade level rather than pitching a lesson blind", async () => {
    dalMock.requireExtractedProblem.mockResolvedValue(
      extractedProblem({
        extraction: {
          id: "ex_1",
          status: "CONFIRMED",
          upload: {
            id: "up_1",
            studentProfileId: "sp_1",
            studentProfile: { id: "sp_1", status: "ACTIVE", gradeLevel: null },
          },
        },
      }),
    );
    const res = await FROM_EXTRACTED(req(EXTRACTED_URL), extractedCtx());
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toContain("grade level");
  });

  it("429s past the hourly cap, with no lesson row and no AI call (AC 22)", async () => {
    dbMock.lessonScriptVersion.count.mockResolvedValue(LESSONS_PER_HOUR);
    expect((await FROM_EXTRACTED(req(EXTRACTED_URL), extractedCtx())).status).toBe(429);
    expect(dbMock.lesson.create).not.toHaveBeenCalled();
    expect(authorLessonMock).not.toHaveBeenCalled();
  });

  it("400s an undeclared body key", async () => {
    expect((await FROM_EXTRACTED(req(EXTRACTED_URL, { effort: "max" }), extractedCtx())).status).toBe(400);
  });

  /** AC 6: 202 and a PENDING row, because authoring takes 12-59 seconds. */
  it("202s with a PENDING lesson and schedules the authoring", async () => {
    const res = await FROM_EXTRACTED(req(EXTRACTED_URL), extractedCtx());

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.data.lesson.status).toBe("PENDING");
    expect(body.data.lesson.subject).toEqual({ kind: "EXTRACTED_PROBLEM", id: "ep_1" });

    // Scheduled, not awaited — the response must not hold open for a minute.
    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(authorLessonMock).not.toHaveBeenCalled();
  });

  it("writes both rows BEFORE the AI call, so a poll always has something to poll", async () => {
    await FROM_EXTRACTED(req(EXTRACTED_URL), extractedCtx());

    expect(dbMock.lesson.create).toHaveBeenCalledTimes(1);
    expect(dbMock.lessonScriptVersion.create).toHaveBeenCalledTimes(1);
    expect(dbMock.lessonScriptVersion.create.mock.calls[0][0].data).toMatchObject({
      version: 1,
      status: "PENDING",
    });

    for (const cb of afterCallbacks) await cb();
    expect(authorLessonMock).toHaveBeenCalledWith("ver_1");
  });

  it("never puts the model, effort or prompt version on the wire", async () => {
    const raw = await (await FROM_EXTRACTED(req(EXTRACTED_URL), extractedCtx())).text();
    expect(raw).not.toContain("claude-opus-5");
    expect(raw).not.toContain("promptVersion");
  });
});

// ─────────────────────────── endpoint 41 ───────────────────────────

describe("requesting a lesson on a practice problem (endpoint 41)", () => {
  it("403s a non-ACTIVE profile", async () => {
    dalMock.requirePracticeProblem.mockResolvedValue(
      practiceProblem({
        practiceSet: {
          id: "set_1",
          status: "IN_PROGRESS",
          studentProfileId: "sp_1",
          studentProfile: { status: "CONSENT_WITHDRAWN", gradeLevel: "GRADE_4" },
        },
      }),
    );
    expect((await FROM_PRACTICE(req(PRACTICE_URL), practiceCtx())).status).toBe(403);
  });

  it("409s while the set is still generating or has failed", async () => {
    for (const status of ["GENERATING", "FAILED"]) {
      dalMock.requirePracticeProblem.mockResolvedValue(
        practiceProblem({
          practiceSet: { id: "set_1", status, studentProfileId: "sp_1", studentProfile: { status: "ACTIVE", gradeLevel: "GRADE_4" } },
        }),
      );
      expect((await FROM_PRACTICE(req(PRACTICE_URL), practiceCtx())).status).toBe(409);
    }
  });

  it("409s a problem with no attempt on it (AC 5)", async () => {
    dbMock.attempt.count.mockResolvedValue(0);
    dbMock.chatSession.count.mockResolvedValue(0);
    expect((await FROM_PRACTICE(req(PRACTICE_URL), practiceCtx())).status).toBe(409);
  });

  it("202s bound to the practice problem, not to an extracted one", async () => {
    const res = await FROM_PRACTICE(req(PRACTICE_URL), practiceCtx());
    expect(res.status).toBe(202);
    expect((await res.json()).data.lesson.subject).toEqual({ kind: "PRACTICE_PROBLEM", id: "pp_1" });

    const data = dbMock.lesson.create.mock.calls[0][0].data;
    expect(data.practiceProblemId).toBe("pp_1");
    // Exactly one binding — the CHECK constraint would reject both.
    expect(data.extractedProblemId).toBeUndefined();
  });

  it("shares the hourly cap with endpoint 40", async () => {
    dbMock.lessonScriptVersion.count.mockResolvedValue(LESSONS_PER_HOUR);
    expect((await FROM_PRACTICE(req(PRACTICE_URL), practiceCtx())).status).toBe(429);
  });
});

// ─────────────────────────── endpoint 42 ───────────────────────────

describe("reading a lesson (endpoint 42)", () => {
  function lessonRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "les_1",
      studentProfileId: "sp_1",
      extractedProblemId: "ep_1",
      practiceProblemId: null,
      status: "READY",
      currentVersionId: "ver_1",
      createdAt: new Date(),
      updatedAt: new Date(),
      studentProfile: { id: "sp_1", status: "ACTIVE", gradeLevel: "GRADE_4" },
      versions: [
        {
          id: "ver_1",
          version: 1,
          status: "READY",
          script: null,
          stepCount: 3,
          totalDurationMs: 12_000,
          failureCode: null,
        },
      ],
      ...overrides,
    };
  }

  const getReq = () => new Request("http://localhost/api/lessons/les_1");

  beforeEach(() => {
    dalMock.requireLesson.mockResolvedValue(lessonRow());
    reapIfStaleMock.mockImplementation(async (lesson: { status: string }) => lesson);
  });

  it("401s with no session", async () => {
    dalMock.verifySession.mockResolvedValue(null);
    expect((await LESSON_GET(getReq(), lessonCtx())).status).toBe(401);
  });

  it("404s a cross-account or unknown lesson (AC 20)", async () => {
    dalMock.requireLesson.mockResolvedValue(null);
    expect((await LESSON_GET(getReq(), lessonCtx())).status).toBe(404);
  });

  it("200s with the lesson and its current version", async () => {
    const res = await LESSON_GET(getReq(), lessonCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.lesson.status).toBe("READY");
    expect(body.data.version.id).toBe("ver_1");
  });

  /** Same rule as the chat transcript read: a parent may look after withdrawing consent. */
  it("serves a lesson for a profile whose consent was withdrawn, and writes nothing", async () => {
    dalMock.requireLesson.mockResolvedValue(
      lessonRow({ status: "AUTHORING", studentProfile: { id: "sp_1", status: "CONSENT_WITHDRAWN", gradeLevel: "GRADE_4" } }),
    );

    expect((await LESSON_GET(getReq(), lessonCtx())).status).toBe(200);
    expect(reapIfStaleMock).not.toHaveBeenCalled();
  });

  /** AC 6: an AUTHORING row whose function was killed must not be polled forever. */
  it("lazily fails a stale AUTHORING lesson", async () => {
    dalMock.requireLesson.mockResolvedValue(lessonRow({ status: "AUTHORING" }));
    reapIfStaleMock.mockImplementation(async (lesson: { status: string }) => ({ ...lesson, status: "FAILED" }));

    const body = await (await LESSON_GET(getReq(), lessonCtx())).json();
    expect(body.data.lesson.status).toBe("FAILED");
    expect(body.data.version.status).toBe("FAILED");
  });

  it("never leaks the model, effort, prompt version or token counts", async () => {
    const raw = await (await LESSON_GET(getReq(), lessonCtx())).text();
    expect(raw).not.toContain("claude-opus-5");
    expect(raw).not.toContain("promptVersion");
    expect(raw).not.toContain("schemaVersion");
  });
});
