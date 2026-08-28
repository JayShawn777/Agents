import { beforeEach, describe, expect, it, vi } from "vitest";

import { LESSONS_PER_HOUR, MAX_LESSON_VERSIONS } from "@/lib/config";

/**
 * `app/api/lessons/[lessonId]/versions/route.ts` (endpoint 43),
 * `.../versions/[versionId]/route.ts` (endpoint 44), and
 * `.../flags/route.ts` (endpoint 45).
 */

/**
 * Real ids are cuids (`@default(cuid())`), and endpoint 45 validates the
 * body's `versionId` with `z.cuid()`. Fixture ids therefore have to be
 * cuid-SHAPED or the tests exercise a 400 instead of the handler — which is
 * exactly what they did on first run.
 */
const VER_1 = "clh3k2j9x0000qwer1234abcd";
const VER_2 = "clh3k2j9x0001qwer5678efgh";

const afterCallbacks: (() => unknown)[] = [];
const afterMock = vi.fn((cb: () => unknown) => {
  afterCallbacks.push(cb);
});
vi.mock("next/server", () => ({ after: afterMock }));

const dalMock = {
  requireLesson: vi.fn(),
  verifySession: vi.fn(async (): Promise<{ userId: string } | null> => ({ userId: "user_1" })),
};
vi.mock("@/lib/auth/dal", () => dalMock);

const authorLessonMock = vi.fn(async () => ({ status: "READY" as const, versionId: VER_2, stepCount: 3 }));
vi.mock("@/lib/lessons/author", () => ({ authorLesson: authorLessonMock, reapIfStale: vi.fn(async (l: unknown) => l) }));

const dbMock = {
  // `findUniqueOrThrow` is how `openNextVersion` reads the owning profile so it
  // can re-count the authoring cap INSIDE its own transaction — the step-7
  // count alone is a read-then-write that concurrent requests walk straight
  // past. `lessonFlag.count` is the flag route's own cap, which it previously
  // had none of.
  lesson: { update: vi.fn(), findUniqueOrThrow: vi.fn(async () => ({ studentProfileId: "sp_1" })) },
  lessonScriptVersion: { count: vi.fn(), create: vi.fn(), aggregate: vi.fn() },
  lessonFlag: { create: vi.fn(), count: vi.fn(async () => 0) },
  // Takes an options argument now (`{ isolationLevel: "Serializable" }`), which
  // this shim ignores — but it must not choke on it.
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") return (arg as (tx: typeof dbMock) => Promise<unknown>)(dbMock);
    return Promise.all(arg as unknown[]);
  }),
};
vi.mock("@/lib/db", () => ({ db: dbMock }));

const { POST: REGENERATE } = await import("@/app/api/lessons/[lessonId]/versions/route");
const { GET: VERSION_GET } = await import("@/app/api/lessons/[lessonId]/versions/[versionId]/route");
const { POST: FLAG } = await import("@/app/api/lessons/[lessonId]/flags/route");

// ─────────────────────────── fixtures ───────────────────────────

function version(overrides: Record<string, unknown> = {}) {
  return {
    id: VER_1,
    lessonId: "les_1",
    version: 1,
    status: "READY",
    script: null,
    schemaVersion: "1",
    stepCount: 6,
    totalDurationMs: 24_000,
    model: "claude-opus-5",
    effort: "high",
    promptVersion: "m4.0-probe",
    failureCode: null,
    inputTokens: 900,
    outputTokens: 1174,
    createdAt: new Date(),
    ...overrides,
  };
}

function lesson(overrides: Record<string, unknown> = {}) {
  return {
    id: "les_1",
    studentProfileId: "sp_1",
    extractedProblemId: "ep_1",
    practiceProblemId: null,
    status: "READY",
    currentVersionId: VER_1,
    createdAt: new Date(),
    updatedAt: new Date(),
    studentProfile: { id: "sp_1", status: "ACTIVE", gradeLevel: "GRADE_4" },
    versions: [version()],
    ...overrides,
  };
}

const post = (url: string, body: unknown = {}) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const REGEN_URL = "http://localhost/api/lessons/les_1/versions";
const FLAG_URL = "http://localhost/api/lessons/les_1/flags";

const lessonCtx = () => ({ params: Promise.resolve({ lessonId: "les_1" }) });
const versionCtx = (versionId = VER_1) => ({ params: Promise.resolve({ lessonId: "les_1", versionId }) });

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
  dalMock.verifySession.mockResolvedValue({ userId: "user_1" });
  dalMock.requireLesson.mockResolvedValue(lesson());
  dbMock.lessonScriptVersion.count.mockResolvedValue(0);
  dbMock.lessonScriptVersion.aggregate.mockResolvedValue({ _max: { version: 1 } });
  dbMock.lessonScriptVersion.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...version(),
    id: VER_2,
    ...data,
  }));
  dbMock.lesson.update.mockResolvedValue({});
  dbMock.lessonFlag.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "flag_1",
    createdAt: new Date("2026-08-28T10:00:00Z"),
    ...data,
  }));
});

// ─────────────────────────── endpoint 43 ───────────────────────────

describe("regenerating a lesson (endpoint 43)", () => {
  it("401s with no session, 404s a cross-account lesson, 403s a withdrawn profile", async () => {
    dalMock.verifySession.mockResolvedValue(null);
    expect((await REGENERATE(post(REGEN_URL), lessonCtx())).status).toBe(401);

    dalMock.verifySession.mockResolvedValue({ userId: "user_1" });
    dalMock.requireLesson.mockResolvedValue(null);
    expect((await REGENERATE(post(REGEN_URL), lessonCtx())).status).toBe(404);

    dalMock.requireLesson.mockResolvedValue(
      lesson({ studentProfile: { id: "sp_1", status: "CONSENT_WITHDRAWN", gradeLevel: "GRADE_4" } }),
    );
    expect((await REGENERATE(post(REGEN_URL), lessonCtx())).status).toBe(403);
    expect(dbMock.lessonScriptVersion.create).not.toHaveBeenCalled();
  });

  it("202s with a new PENDING version and schedules the authoring", async () => {
    const res = await REGENERATE(post(REGEN_URL), lessonCtx());

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.data.lesson.status).toBe("PENDING");
    expect(body.data.lesson.versionCount).toBe(2);

    expect(dbMock.lessonScriptVersion.create.mock.calls[0][0].data).toMatchObject({
      lessonId: "les_1",
      version: 2,
      status: "PENDING",
    });

    for (const cb of afterCallbacks) await cb();
    expect(authorLessonMock).toHaveBeenCalledWith(VER_2);
  });

  /**
   * AC 19's real guarantee. `currentVersionId` is repointed by `authorLesson`
   * only once the NEW run succeeds, so a regeneration that fails leaves the
   * child with the lesson they already had rather than with nothing.
   */
  it("leaves currentVersionId pointing at the old version while the new one authors", async () => {
    await REGENERATE(post(REGEN_URL), lessonCtx());

    const update = dbMock.lesson.update.mock.calls[0][0];
    expect(update.data).toEqual({ status: "PENDING" });
    expect(update.data).not.toHaveProperty("currentVersionId");
  });

  /**
   * Two concurrent runs on one lesson would race to repoint
   * `currentVersionId`, and the child would get whichever finished last rather
   * than whichever they asked for.
   */
  it("409s while a version is already in flight", async () => {
    for (const status of ["PENDING", "AUTHORING"]) {
      vi.clearAllMocks();
      dalMock.verifySession.mockResolvedValue({ userId: "user_1" });
      dalMock.requireLesson.mockResolvedValue(lesson({ versions: [version({ status })] }));

      const res = await REGENERATE(post(REGEN_URL), lessonCtx());
      expect(res.status).toBe(409);
      expect((await res.json()).error.message).toContain("already on its way");
      expect(dbMock.lessonScriptVersion.create).not.toHaveBeenCalled();
    }
  });

  it("409s at the version cap, which AC 19 does not set for itself", async () => {
    dalMock.requireLesson.mockResolvedValue(
      lesson({
        versions: Array.from({ length: MAX_LESSON_VERSIONS }, (_, i) =>
          version({ id: `${VER_1}${i}`, version: i + 1, status: "READY" }),
        ),
      }),
    );

    const res = await REGENERATE(post(REGEN_URL), lessonCtx());
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toContain("a few different explanations");
  });

  /**
   * The cap counts authoring RUNS, not lessons. Counting lessons would leave
   * regeneration uncapped per hour — the version cap bounds one lesson at five,
   * but nothing would bound pressing the button across lesson after lesson.
   */
  it("429s past the hourly authoring cap, counted over versions", async () => {
    dbMock.lessonScriptVersion.count.mockResolvedValue(LESSONS_PER_HOUR);

    expect((await REGENERATE(post(REGEN_URL), lessonCtx())).status).toBe(429);
    expect(dbMock.lessonScriptVersion.create).not.toHaveBeenCalled();
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("400s an undeclared body key", async () => {
    expect((await REGENERATE(post(REGEN_URL, { style: "simpler" }), lessonCtx())).status).toBe(400);
  });
});

// ─────────────────────────── endpoint 44 ───────────────────────────

describe("fetching one version (endpoint 44)", () => {
  const get = () => new Request(`http://localhost/api/lessons/les_1/versions/${VER_1}`);

  it("200s with the named version, so a superseded one stays playable (AC 19)", async () => {
    dalMock.requireLesson.mockResolvedValue(
      lesson({
        currentVersionId: VER_2,
        versions: [version({ id: VER_1, version: 1 }), version({ id: VER_2, version: 2 })],
      }),
    );

    const res = await VERSION_GET(get(), versionCtx(VER_1));
    expect(res.status).toBe(200);
    expect((await res.json()).data.version).toBe(1);
  });

  /**
   * Resolved at step 3, not checked at step 5, so a real id on somebody else's
   * lesson is indistinguishable from one that does not exist (AC 20). A 409
   * would have confirmed the id is real.
   */
  it("404s a version id that belongs to a different lesson", async () => {
    const res = await VERSION_GET(get(), versionCtx("clh3k2j9x0009zzzz9999zzzz"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toBe("We couldn't find that.");
  });

  it("404s when the lesson itself is not the caller's", async () => {
    dalMock.requireLesson.mockResolvedValue(null);
    expect((await VERSION_GET(get(), versionCtx())).status).toBe(404);
  });

  it("never leaks the model, effort, prompt version or token counts", async () => {
    const raw = await (await VERSION_GET(get(), versionCtx())).text();
    expect(raw).not.toContain("claude-opus-5");
    expect(raw).not.toContain("m4.0-probe");
    expect(raw).not.toContain("1174");
  });
});

// ─────────────────────────── endpoint 45 ───────────────────────────

describe("flagging a lesson (endpoint 45)", () => {
  const body = { versionId: VER_1, stepIndex: 2, reason: "CONFUSING" };

  it("201s and persists the flag against the version that was on screen (AC 18)", async () => {
    const res = await FLAG(post(FLAG_URL, body), lessonCtx());

    expect(res.status).toBe(201);
    expect(dbMock.lessonFlag.create.mock.calls[0][0].data).toEqual({
      lessonId: "les_1",
      versionId: VER_1,
      stepIndex: 2,
      reason: "CONFUSING",
    });
    expect((await res.json()).data.flag.reason).toBe("CONFUSING");
  });

  /** AC 18: "with the step index IF ONE WAS SELECTED" — a child may flag the whole lesson. */
  it("accepts a flag with no step selected", async () => {
    const res = await FLAG(post(FLAG_URL, { ...body, stepIndex: null }), lessonCtx());
    expect(res.status).toBe(201);
    expect(dbMock.lessonFlag.create.mock.calls[0][0].data.stepIndex).toBeNull();
  });

  it("403s a withdrawn profile", async () => {
    dalMock.requireLesson.mockResolvedValue(
      lesson({ studentProfile: { id: "sp_1", status: "CONSENT_WITHDRAWN", gradeLevel: "GRADE_4" } }),
    );
    expect((await FLAG(post(FLAG_URL, body), lessonCtx())).status).toBe(403);
    expect(dbMock.lessonFlag.create).not.toHaveBeenCalled();
  });

  /**
   * `versionId` arrives in the BODY, so nothing upstream has scoped it.
   * Resolving it against the already-owned lesson is what stops a caller
   * attaching a flag to a version of somebody else's lesson.
   */
  it("404s a versionId that is not on this lesson", async () => {
    const res = await FLAG(post(FLAG_URL, { ...body, versionId: "clh3k2j9x0009zzzz9999zzzz" }), lessonCtx());
    expect(res.status).toBe(404);
    expect(dbMock.lessonFlag.create).not.toHaveBeenCalled();
  });

  /** A flag on step 99 of a six-step lesson is not actionable by anyone. */
  it("400s a step index past the end of that version", async () => {
    const res = await FLAG(post(FLAG_URL, { ...body, stepIndex: 99 }), lessonCtx());
    expect(res.status).toBe(400);
    expect(dbMock.lessonFlag.create).not.toHaveBeenCalled();
  });

  it("400s a reason outside the fixed allowlist", async () => {
    const res = await FLAG(post(FLAG_URL, { ...body, reason: "it made me sad" }), lessonCtx());
    expect(res.status).toBe(400);
  });

  /** Free text on a child-facing surface is a personal-data channel we chose not to open. */
  it("400s an attempt to send free text alongside the reason", async () => {
    const res = await FLAG(post(FLAG_URL, { ...body, comment: "my name is Ada and I live at..." }), lessonCtx());
    expect(res.status).toBe(400);
    expect(dbMock.lessonFlag.create).not.toHaveBeenCalled();
  });
});
