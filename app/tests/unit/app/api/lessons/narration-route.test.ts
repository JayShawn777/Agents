import { beforeEach, describe, expect, it, vi } from "vitest";

import { NARRATION_DAILY_BUDGET_CHARS, NARRATION_RUNS_PER_HOUR } from "@/lib/config";

/**
 * `app/api/lessons/[lessonId]/narration/route.ts` — endpoints 46 (POST) and
 * 47 (GET), plan §3. AC 17's retry is endpoint 46 again, not a third route.
 */

const VER_1 = "clh3k2j9x0000qwer1234abcd";

const afterCallbacks: (() => unknown)[] = [];
const afterMock = vi.fn((cb: () => unknown) => {
  afterCallbacks.push(cb);
});
vi.mock("next/server", () => ({ after: afterMock }));

const dalMock = {
  requireLessonForNarration: vi.fn(),
  fetchNarrationWithRelations: vi.fn(),
  verifySession: vi.fn(async (): Promise<{ userId: string } | null> => ({ userId: "user_1" })),
};
vi.mock("@/lib/auth/dal", () => dalMock);

const generateMock = {
  runNarrationGeneration: vi.fn(async () => ({ status: "READY" as const, narrationId: "narr_1", stepCount: 3, totalDurationMs: 9000 })),
  reapIfStaleNarration: vi.fn(async (n: unknown) => n),
};
vi.mock("@/lib/narration/generate", () => generateMock);

vi.mock("@/lib/storage/get-storage", () => ({
  getStoragePort: () => ({
    signedReadUrl: vi.fn(async (pathname: string) => ({
      url: `https://signed.example/${pathname}`,
      expiresAt: new Date("2026-09-01T00:05:00.000Z"),
    })),
  }),
}));

const dbMock = {
  studentProfile: { findUniqueOrThrow: vi.fn(async () => ({ personaId: null })) },
  persona: {
    findUnique: vi.fn(async ({ where }: { where: { slug?: string; id?: string } }) =>
      where.slug === "professor-love" || where.id === "persona_default"
        ? { id: "persona_default", slug: "professor-love", label: "Professor Love", providerVoiceId: "voice_default" }
        : null,
    ),
    findFirst: vi.fn(),
  },
  /**
   * The AC 21 caps count `NarrationRunAttempt` rows, not `LessonNarration` rows
   * (2026-09-02 security review): a retry UPSERTS the narration row and never
   * moves its `createdAt`, so an aged row was permanently uncapped. These mocks
   * moved with the queries.
   */
  narrationRunAttempt: {
    count: vi.fn(async () => 0),
    aggregate: vi.fn(async () => ({ _sum: { charactersBilled: 0 } })),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "attempt_1", ...data })),
  },
  lessonNarration: {
    upsert: vi.fn(
      async ({
        create,
      }: {
        where: unknown;
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => ({
        id: "narr_1",
        failureCode: null,
        stepCount: null,
        totalDurationMs: null,
        ...create,
      }),
    ),
  },
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") return (arg as (tx: typeof dbMock) => Promise<unknown>)(dbMock);
    return Promise.all(arg as unknown[]);
  }),
};
vi.mock("@/lib/db", () => ({ db: dbMock }));

const { POST, GET } = await import("@/app/api/lessons/[lessonId]/narration/route");

// ─────────────────────────── fixtures ───────────────────────────

function step(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    narration: "We add the two numerators.",
    ops: [{ kind: "label", id: "l1", text: "hi", at: { x: 0.1, y: 0.1 } }],
    durationMs: 3000,
    ...overrides,
  };
}

function script() {
  return {
    title: "Adding fractions",
    steps: [step({ id: "s1" }), step({ id: "s2" }), step({ id: "s3" })],
  };
}

function version(overrides: Record<string, unknown> = {}) {
  return {
    id: VER_1,
    lessonId: "les_1",
    version: 1,
    status: "READY",
    script: script(),
    ...overrides,
  };
}

function lesson(overrides: Record<string, unknown> = {}) {
  return {
    id: "les_1",
    studentProfileId: "sp_1",
    currentVersionId: VER_1,
    studentProfile: { id: "sp_1", status: "ACTIVE", gradeLevel: "GRADE_4" },
    versions: [version()],
    narration: null,
    ...overrides,
  };
}

function narrationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "narr_1",
    versionId: VER_1,
    lessonId: "les_1",
    studentProfileId: "sp_1",
    status: "PENDING",
    failureCode: null,
    stepCount: null,
    totalDurationMs: null,
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    persona: { id: "persona_default", slug: "professor-love", label: "Professor Love" },
    steps: [],
    ...overrides,
  };
}

const postReq = (url: string) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
const getReq = (url: string) => new Request(url);

const NARR_URL = "http://localhost/api/lessons/les_1/narration";
const ctx = () => ({ params: Promise.resolve({ lessonId: "les_1" }) });

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
  dalMock.verifySession.mockResolvedValue({ userId: "user_1" });
  dalMock.requireLessonForNarration.mockResolvedValue(lesson());
  dbMock.studentProfile.findUniqueOrThrow.mockResolvedValue({ personaId: null });
  dbMock.narrationRunAttempt.count.mockResolvedValue(0);
  dbMock.narrationRunAttempt.aggregate.mockResolvedValue({ _sum: { charactersBilled: 0 } });
  dbMock.lessonNarration.upsert.mockImplementation(
    async ({ create }: { where: unknown; create: Record<string, unknown> }) => ({
      id: "narr_1",
      failureCode: null,
      stepCount: null,
      totalDurationMs: null,
      ...create,
    }),
  );
});

// ─────────────────────────── endpoint 46 — POST ───────────────────────────

describe("requesting narration (endpoint 46)", () => {
  it("401s with no session, 404s a cross-account lesson, 403s a withdrawn profile", async () => {
    dalMock.verifySession.mockResolvedValue(null);
    expect((await POST(postReq(NARR_URL), ctx())).status).toBe(401);

    dalMock.verifySession.mockResolvedValue({ userId: "user_1" });
    dalMock.requireLessonForNarration.mockResolvedValue(null);
    expect((await POST(postReq(NARR_URL), ctx())).status).toBe(404);

    dalMock.requireLessonForNarration.mockResolvedValue(
      lesson({ studentProfile: { id: "sp_1", status: "CONSENT_WITHDRAWN", gradeLevel: "GRADE_4" } }),
    );
    expect((await POST(postReq(NARR_URL), ctx())).status).toBe(403);
    expect(dbMock.lessonNarration.upsert).not.toHaveBeenCalled();
  });

  it("409s when the lesson has no READY current version", async () => {
    dalMock.requireLessonForNarration.mockResolvedValue(lesson({ currentVersionId: null, versions: [] }));
    const res = await POST(postReq(NARR_URL), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toContain("isn't ready");
  });

  it("409s when the stored script no longer parses (M4 review lesson 23's re-parse discipline)", async () => {
    dalMock.requireLessonForNarration.mockResolvedValue(
      lesson({ versions: [version({ script: { title: "bad" } })] }),
    );
    expect((await POST(postReq(NARR_URL), ctx())).status).toBe(409);
  });

  it("202s and writes a PENDING grant row before scheduling generation", async () => {
    const res = await POST(postReq(NARR_URL), ctx());

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.data.narration.status).toBe("PENDING");
    expect(body.data.narration.persona).toEqual({ id: "persona_default", slug: "professor-love", label: "Professor Love" });

    expect(dbMock.lessonNarration.upsert).toHaveBeenCalledTimes(1);
    const call = dbMock.lessonNarration.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ versionId: VER_1 });
    expect(call.create).toMatchObject({ status: "PENDING", lessonId: "les_1", versionId: VER_1 });
  });

  /** `after()` must be registered EAGERLY, in request context — never inside a callback or an abort listener (M3's lesson). */
  it("schedules generation via after(), registered directly in the handler body", async () => {
    await POST(postReq(NARR_URL), ctx());

    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(generateMock.runNarrationGeneration).not.toHaveBeenCalled(); // not yet — only once the callback runs
    for (const cb of afterCallbacks) await cb();
    expect(generateMock.runNarrationGeneration).toHaveBeenCalledWith("narr_1", expect.anything());
  });

  it("409s while a run is already PENDING or GENERATING", async () => {
    for (const status of ["PENDING", "GENERATING"]) {
      vi.clearAllMocks();
      dalMock.verifySession.mockResolvedValue({ userId: "user_1" });
      dalMock.requireLessonForNarration.mockResolvedValue(lesson({ narration: narrationRow({ status }) }));

      const res = await POST(postReq(NARR_URL), ctx());
      expect(res.status).toBe(409);
      expect((await res.json()).error.message).toContain("already on its way");
      expect(dbMock.lessonNarration.upsert).not.toHaveBeenCalled();
    }
  });

  /** AC 17: a FAILED run is re-claimed by the SAME route, reset to PENDING, rather than a third route. */
  it("re-claims a FAILED run back to PENDING (AC 17's retry)", async () => {
    dalMock.requireLessonForNarration.mockResolvedValue(
      lesson({ narration: narrationRow({ status: "FAILED", failureCode: "TIMEOUT" }) }),
    );

    const res = await POST(postReq(NARR_URL), ctx());
    expect(res.status).toBe(202);
    const call = dbMock.lessonNarration.upsert.mock.calls[0][0];
    expect(call.update).toMatchObject({ status: "PENDING", failureCode: null });
  });

  it("429s over the hourly runs cap without writing anything", async () => {
    dbMock.narrationRunAttempt.count.mockResolvedValue(NARRATION_RUNS_PER_HOUR);
    const res = await POST(postReq(NARR_URL), ctx());
    expect(res.status).toBe(429);
    expect(dbMock.lessonNarration.upsert).not.toHaveBeenCalled();
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("429s over the daily character budget without writing anything", async () => {
    dbMock.narrationRunAttempt.aggregate.mockResolvedValue({ _sum: { charactersBilled: NARRATION_DAILY_BUDGET_CHARS } });
    const res = await POST(postReq(NARR_URL), ctx());
    expect(res.status).toBe(429);
    expect(dbMock.lessonNarration.upsert).not.toHaveBeenCalled();
  });

  /**
   * **The authoritative cap is re-counted INSIDE the transaction, not only
   * at step 7.** Regression test for the exact bug M4's review found in the
   * authoring cap: a cheap pre-check that passes for every one of N racing
   * requests because none of their writes have landed yet. Simulated here by
   * having the cheap step-7 check see room (0) while the count INSIDE the
   * transaction (which a real concurrent writer would have already bumped)
   * reports the cap already reached — proving the route re-checks rather
   * than trusting the step-7 result.
   */
  it("re-checks the runs cap inside the granting transaction, not only at step 7", async () => {
    let callsInsideTransaction = 0;
    dbMock.narrationRunAttempt.count.mockImplementation(async () => {
      callsInsideTransaction += 1;
      // First call is step 7's cheap pre-check (room to spare); every call
      // from inside `$transaction` (the second one) reports the cap reached.
      return callsInsideTransaction === 1 ? 0 : NARRATION_RUNS_PER_HOUR;
    });

    const res = await POST(postReq(NARR_URL), ctx());
    expect(res.status).toBe(429);
    expect(callsInsideTransaction).toBeGreaterThanOrEqual(2);
    expect(dbMock.lessonNarration.upsert).not.toHaveBeenCalled();
  });

  /**
   * The mechanism the whole 2026-09-02 cap fix rests on: the grant must INSERT a
   * ledger row every time, including on a retry that only upserts the narration
   * row. Without this insert the windows never move and an aged row is
   * unlimited paid TTS.
   */
  it("writes a NarrationRunAttempt ledger row inside the granting transaction", async () => {
    await POST(postReq(NARR_URL), ctx());

    expect(dbMock.narrationRunAttempt.create).toHaveBeenCalledTimes(1);
    const created = dbMock.narrationRunAttempt.create.mock.calls[0][0] as {
      data: { narrationId: string; studentProfileId: string };
    };
    expect(created.data.narrationId).toBe("narr_1");
    expect(created.data.studentProfileId).toBe("sp_1");
  });

  it("a RETRY also inserts a ledger row, even though it only upserts the narration row", async () => {
    // AC 17's retry: the same POST against a FAILED run.
    dalMock.requireLessonForNarration.mockResolvedValue(
      lesson({ narration: narrationRow({ status: "FAILED", failureCode: "UPSTREAM" }) }),
    );

    await POST(postReq(NARR_URL), ctx());

    // One upsert (reusing the row, per AC 17) and one NEW ledger row. This pair
    // is exactly what the bypass lacked.
    expect(dbMock.lessonNarration.upsert).toHaveBeenCalledTimes(1);
    expect(dbMock.narrationRunAttempt.create).toHaveBeenCalledTimes(1);
  });

  it("400s an undeclared body key", async () => {
    const req = new Request(NARR_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ persona: "smooth-j" }),
    });
    expect((await POST(req, ctx())).status).toBe(400);
    expect(dbMock.lessonNarration.upsert).not.toHaveBeenCalled();
  });
});

// ─────────────────────────── endpoint 47 — GET ───────────────────────────

describe("reading narration status (endpoint 47)", () => {
  it("401s with no session and 404s a cross-account lesson", async () => {
    dalMock.verifySession.mockResolvedValue(null);
    expect((await GET(getReq(NARR_URL), ctx())).status).toBe(401);

    dalMock.verifySession.mockResolvedValue({ userId: "user_1" });
    dalMock.requireLessonForNarration.mockResolvedValue(null);
    expect((await GET(getReq(NARR_URL), ctx())).status).toBe(404);
  });

  it("200s { narration: null } for a lesson never narrated", async () => {
    const res = await GET(getReq(NARR_URL), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).data.narration).toBeNull();
  });

  /** Owner, not Owner+ACTIVE — a parent who withdrew consent can still see what was made for their child. */
  it("200s for a withdrawn profile and does not reap", async () => {
    dalMock.requireLessonForNarration.mockResolvedValue(
      lesson({
        studentProfile: { id: "sp_1", status: "CONSENT_WITHDRAWN", gradeLevel: "GRADE_4" },
        narration: narrationRow({ status: "GENERATING" }),
      }),
    );

    const res = await GET(getReq(NARR_URL), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).data.narration.status).toBe("GENERATING");
    expect(generateMock.reapIfStaleNarration).not.toHaveBeenCalled();
  });

  it("reaps a stale GENERATING run to FAILED for an ACTIVE profile", async () => {
    dalMock.requireLessonForNarration.mockResolvedValue(
      lesson({ narration: narrationRow({ status: "GENERATING" }) }),
    );
    generateMock.reapIfStaleNarration.mockResolvedValue(narrationRow({ status: "FAILED", failureCode: "TIMEOUT" }));
    // The status changed (GENERATING -> FAILED), so the route re-fetches
    // relations rather than trusting the pre-reap snapshot.
    dalMock.fetchNarrationWithRelations.mockResolvedValue(narrationRow({ status: "FAILED", failureCode: "TIMEOUT" }));

    const res = await GET(getReq(NARR_URL), ctx());
    expect(generateMock.reapIfStaleNarration).toHaveBeenCalledTimes(1);
    expect((await res.json()).data.narration.status).toBe("FAILED");
  });

  /**
   * The M4 review's finding, restated for narration: a run that finishes
   * moments before the reaping read must not be shown to the child as a
   * failure. `reapIfStaleNarration` re-reads on a lost guard race; this
   * route must re-fetch relations (not trust the stale, pre-completion
   * `steps: []`) when that re-read reports a DIFFERENT status.
   */
  it("re-fetches relations when the reap's own re-read shows the run actually finished READY", async () => {
    dalMock.requireLessonForNarration.mockResolvedValue(
      lesson({ narration: narrationRow({ status: "GENERATING", steps: [] }) }),
    );
    // Simulates `reapIfStaleNarration` losing its guard race: the row was
    // already READY by the time it re-read, with no relations attached.
    generateMock.reapIfStaleNarration.mockResolvedValue(narrationRow({ status: "READY", steps: [] }));
    dalMock.fetchNarrationWithRelations.mockResolvedValue(
      narrationRow({
        status: "READY",
        stepCount: 1,
        steps: [
          {
            stepId: "s1",
            stepIndex: 0,
            startOffsetMs: 0,
            asset: { pathname: "students/sp_1/narration/key1.mp3", durationMs: 1000, cues: { v: 1, durationMs: 1000, words: [] } },
          },
        ],
      }),
    );

    const res = await GET(getReq(NARR_URL), ctx());
    const data = (await res.json()).data.narration;
    expect(data.status).toBe("READY");
    expect(data.steps).toHaveLength(1);
    expect(dalMock.fetchNarrationWithRelations).toHaveBeenCalledWith("narr_1");
  });

  it("does not re-fetch relations when the reap changes nothing", async () => {
    dalMock.requireLessonForNarration.mockResolvedValue(
      lesson({ narration: narrationRow({ status: "READY", stepCount: 0, steps: [] }) }),
    );
    // `reapIfStaleNarration` no-ops for a terminal status — same object back.
    generateMock.reapIfStaleNarration.mockImplementation(async (n: unknown) => n);

    await GET(getReq(NARR_URL), ctx());
    expect(dalMock.fetchNarrationWithRelations).not.toHaveBeenCalled();
  });

  /** The DTO's exact key set (plan §3): nothing internal ever crosses. */
  it("never leaks providerVoiceId, ttsModelId, pathname, cacheKey, charactersBilled, failureCode or cacheHits", async () => {
    dalMock.requireLessonForNarration.mockResolvedValue(
      lesson({
        narration: narrationRow({
          status: "READY",
          providerVoiceId: "voice_secret",
          ttsModelId: "eleven_multilingual_v2",
          charactersBilled: 999,
          cacheHits: 3,
          steps: [
            {
              stepId: "s1",
              stepIndex: 0,
              startOffsetMs: 0,
              asset: {
                pathname: "students/sp_1/narration/should-not-leak.mp3",
                durationMs: 1000,
                cues: { v: 1, durationMs: 1000, words: [] },
              },
            },
          ],
        }),
      }),
    );

    // `audioUrl` legitimately embeds the object's pathname (a signed URL
    // INTO our own store) — that is by design (`tests/unit/lib/narration/
    // dto.test.ts` asserts the same). What must never appear is the
    // INTERNAL field names/values this DTO is not allowed to carry.
    const raw = await (await GET(getReq(NARR_URL), ctx())).text();
    expect(raw).not.toContain("voice_secret");
    expect(raw).not.toContain("eleven_multilingual_v2");
    expect(raw).not.toContain("999");
    expect(raw).not.toContain("cacheHits");
    expect(raw).not.toContain("providerVoiceId");
    expect(raw).not.toContain("ttsModelId");
    expect(raw).not.toContain("charactersBilled");
    expect(raw).not.toContain("failureCode");
    expect(raw).not.toContain("cacheKey");

    const body = JSON.parse(raw);
    expect(Object.keys(body.data.narration).sort()).toEqual(
      ["failureMessage", "id", "persona", "status", "stepCount", "steps", "totalDurationMs", "versionId"].sort(),
    );
    expect(Object.keys(body.data.narration.steps[0]).sort()).toEqual(
      ["audioUrl", "audioUrlExpiresAt", "durationMs", "startOffsetMs", "stepId", "stepIndex", "words"].sort(),
    );
  });
});
