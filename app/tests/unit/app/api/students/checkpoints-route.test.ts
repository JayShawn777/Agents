import { beforeEach, expect, it, vi } from "vitest";

/** `app/api/students/[studentId]/checkpoints/route.ts` — M2.5 slice 5c. */

const dalMock = { requireStudentProfile: vi.fn(), verifySession: vi.fn(async () => ({ userId: "user_1" })) };
vi.mock("@/lib/auth/dal", () => dalMock);

const afterMock = vi.fn();
vi.mock("next/server", () => ({ after: afterMock }));

const dbMock = {
  skillMastery: { findMany: vi.fn() },
  practiceSet: { count: vi.fn(), create: vi.fn() },
};
vi.mock("@/lib/db", () => ({ db: dbMock }));

const runCheckpointGenerationMock = vi.fn(async () => undefined);
vi.mock("@/lib/checkpoints/generate", () => ({ runCheckpointGeneration: runCheckpointGenerationMock }));

const { POST } = await import("@/app/api/students/[studentId]/checkpoints/route");
const { CHECKPOINTS_PER_DAY, CHECKPOINT_MIN_SKILLS } = await import("@/lib/config");

function req() {
  return new Request("http://localhost/api/students/sp_1/checkpoints", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}
const ctx = () => ({ params: Promise.resolve({ studentId: "sp_1" }) });

const profile = (overrides: Record<string, unknown> = {}) => ({ id: "sp_1", status: "ACTIVE", ...overrides });

function mastery(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    skillCode: `s${i}`,
    attemptCount: 2,
    lastPracticedAt: new Date(Date.UTC(2026, 0, 1 + i)),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  dalMock.verifySession.mockResolvedValue({ userId: "user_1" });
  dalMock.requireStudentProfile.mockResolvedValue(profile());
  dbMock.skillMastery.findMany.mockResolvedValue(mastery(CHECKPOINT_MIN_SKILLS));
  dbMock.practiceSet.count.mockResolvedValue(0);
  dbMock.practiceSet.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "set_1",
    failureCode: null,
    createdAt: new Date(),
    finishedAt: null,
    ...data,
  }));
});

it("404s a cross-account or nonexistent profile", async () => {
  dalMock.requireStudentProfile.mockResolvedValue(null);
  expect((await POST(req(), ctx())).status).toBe(404);
});

it("403s a profile whose consent is not ACTIVE, spending nothing", async () => {
  dalMock.requireStudentProfile.mockResolvedValue(profile({ status: "CONSENT_WITHDRAWN" }));
  const res = await POST(req(), ctx());

  expect(res.status).toBe(403);
  expect(dbMock.practiceSet.create).not.toHaveBeenCalled();
  expect(afterMock).not.toHaveBeenCalled();
});

it("creates a CHECKPOINT set with no extractionId and schedules generation", async () => {
  const res = await POST(req(), ctx());

  expect(res.status).toBe(202);
  const created = dbMock.practiceSet.create.mock.calls[0][0].data as Record<string, unknown>;
  expect(created.kind).toBe("CHECKPOINT");
  expect(created.extractionId).toBeNull();
  expect(afterMock).toHaveBeenCalledOnce();
});

it("409s a student with too little history — before a row is written or a token spent", async () => {
  dbMock.skillMastery.findMany.mockResolvedValue(mastery(CHECKPOINT_MIN_SKILLS - 1));
  const res = await POST(req(), ctx());

  expect(res.status).toBe(409);
  expect(dbMock.practiceSet.create).not.toHaveBeenCalled();
  expect(afterMock).not.toHaveBeenCalled();
});

it("the too-little-history message invites more practice rather than reporting a failure", async () => {
  dbMock.skillMastery.findMany.mockResolvedValue(mastery(CHECKPOINT_MIN_SKILLS - 1));
  const body = (await (await POST(req(), ctx())).json()) as { error: { message: string } };

  expect(body.error.message).toMatch(/do a bit more/i);
  expect(body.error.message).not.toMatch(/fail|error|denied/i);
});

it("429s once the daily cap is reached, counting CHECKPOINT rows only", async () => {
  dbMock.practiceSet.count.mockResolvedValue(CHECKPOINTS_PER_DAY);
  const res = await POST(req(), ctx());

  expect(res.status).toBe(429);
  expect(dbMock.practiceSet.create).not.toHaveBeenCalled();
  expect(dbMock.practiceSet.count).toHaveBeenCalledWith({
    where: { studentProfileId: "sp_1", kind: "CHECKPOINT", createdAt: { gte: expect.any(Date) } },
  });
});

it("a day's practice sets do not count against the checkpoint cap", async () => {
  // The `kind` filter is the whole of it — without it, six practice sets would
  // lock a student out of checking what they remember.
  await POST(req(), ctx());

  const where = dbMock.practiceSet.count.mock.calls[0][0].where as { kind: string };
  expect(where.kind).toBe("CHECKPOINT");
});
