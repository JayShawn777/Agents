import { beforeEach, expect, it, vi } from "vitest";

/**
 * `app/api/practice-sets/[practiceSetId]/retry/route.ts`.
 *
 * This route had no test file at all until M2's review on 2026-08-27, which is
 * why it was the one M2 mutation missing the Owner+ACTIVE consent gate.
 */

const dalMock = { requirePracticeSet: vi.fn(), verifySession: vi.fn(async () => ({ userId: "user_1" })) };
vi.mock("@/lib/auth/dal", () => dalMock);

const afterMock = vi.fn();
vi.mock("next/server", () => ({ after: afterMock }));

const dbMock = {
  practiceProblem: { deleteMany: vi.fn() },
  practiceSet: { update: vi.fn() },
};
vi.mock("@/lib/db", () => ({ db: dbMock }));

const runPracticeGenerationMock = vi.fn(async () => undefined);
vi.mock("@/lib/practice/generate", () => ({ runPracticeGeneration: runPracticeGenerationMock }));

const { POST } = await import("@/app/api/practice-sets/[practiceSetId]/retry/route");

function req() {
  return new Request("http://localhost/api/practice-sets/set_1/retry", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}
function ctx() {
  return { params: Promise.resolve({ practiceSetId: "set_1" }) };
}

function set(overrides: Record<string, unknown> = {}) {
  return {
    id: "set_1",
    extractionId: "ex_1",
    status: "FAILED",
    failureCode: "UPSTREAM_FAILURE",
    generationAttempts: 1,
    createdAt: new Date(),
    finishedAt: null,
    studentProfileId: "sp_1",
    studentProfile: { status: "ACTIVE" },
    problems: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dalMock.verifySession.mockResolvedValue({ userId: "user_1" });
  dbMock.practiceProblem.deleteMany.mockResolvedValue({ count: 0 });
  dbMock.practiceSet.update.mockImplementation(async () => set({ status: "GENERATING", failureCode: null }));
});

it("404s a cross-account or nonexistent set", async () => {
  dalMock.requirePracticeSet.mockResolvedValue(null);
  expect((await POST(req(), ctx())).status).toBe(404);
});

it("retries a FAILED set: clears the old problems and schedules generation", async () => {
  dalMock.requirePracticeSet.mockResolvedValue(set());
  const res = await POST(req(), ctx());

  expect(res.status).toBe(202);
  expect(dbMock.practiceProblem.deleteMany).toHaveBeenCalledWith({ where: { practiceSetId: "set_1" } });
  expect(afterMock).toHaveBeenCalledOnce();
});

it("409s a set that is not FAILED — retry is not a way to regenerate a good set", async () => {
  dalMock.requirePracticeSet.mockResolvedValue(set({ status: "READY" }));
  const res = await POST(req(), ctx());

  expect(res.status).toBe(409);
  expect(afterMock).not.toHaveBeenCalled();
});

it("429s once generationAttempts has hit the cap", async () => {
  dalMock.requirePracticeSet.mockResolvedValue(set({ generationAttempts: 99 }));
  const res = await POST(req(), ctx());

  expect(res.status).toBe(429);
  expect(afterMock).not.toHaveBeenCalled();
});

// ─────────────── the finding this file was written for ───────────────

it("403s a profile whose consent is not ACTIVE, and generates nothing for it", async () => {
  dalMock.requirePracticeSet.mockResolvedValue(set({ studentProfile: { status: "CONSENT_WITHDRAWN" } }));
  const res = await POST(req(), ctx());

  expect(res.status).toBe(403);
  expect(afterMock).not.toHaveBeenCalled();
  expect(dbMock.practiceProblem.deleteMany).not.toHaveBeenCalled();
  expect(dbMock.practiceSet.update).not.toHaveBeenCalled();
});

it("the consent gate runs BEFORE the flow check — a withdrawn profile is 403, never 409", async () => {
  // A non-FAILED set would 409 on flow order. Consent must answer first, so
  // that a 409 can never confirm a withdrawn profile is otherwise writable
  // (ADR-0006 step 4 before step 5; the same ordering M0 AC 11 fixed).
  dalMock.requirePracticeSet.mockResolvedValue(
    set({ status: "READY", studentProfile: { status: "CONSENT_WITHDRAWN" } }),
  );
  expect((await POST(req(), ctx())).status).toBe(403);
});
