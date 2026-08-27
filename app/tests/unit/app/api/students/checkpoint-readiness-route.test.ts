import { beforeEach, expect, it, vi } from "vitest";

/** `app/api/students/[studentId]/checkpoint-readiness/route.ts` — M2.5 AC 4. */

const dalMock = { requireStudentProfile: vi.fn(), verifySession: vi.fn(async () => ({ userId: "user_1" })) };
vi.mock("@/lib/auth/dal", () => dalMock);

const dbMock = { skillMastery: { findMany: vi.fn() } };
vi.mock("@/lib/db", () => ({ db: dbMock }));

const { GET } = await import("@/app/api/students/[studentId]/checkpoint-readiness/route");
const { CHECKPOINT_MIN_SKILLS } = await import("@/lib/config");

const req = () => new Request("http://localhost/api/students/sp_1/checkpoint-readiness");
const ctx = () => ({ params: Promise.resolve({ studentId: "sp_1" }) });

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
  dalMock.requireStudentProfile.mockResolvedValue({ id: "sp_1", status: "ACTIVE" });
});

it("404s a cross-account or nonexistent profile", async () => {
  dalMock.requireStudentProfile.mockResolvedValue(null);
  expect((await GET(req(), ctx())).status).toBe(404);
});

it("available once the student has practised enough distinct skills", async () => {
  dbMock.skillMastery.findMany.mockResolvedValue(mastery(CHECKPOINT_MIN_SKILLS));
  const body = (await (await GET(req(), ctx())).json()) as { data: { available: boolean; reason: string | null } };

  expect(body.data.available).toBe(true);
  expect(body.data.reason).toBeNull();
});

it("unavailable below the minimum, with a machine-readable reason and the numbers behind it", async () => {
  dbMock.skillMastery.findMany.mockResolvedValue(mastery(CHECKPOINT_MIN_SKILLS - 1));
  const body = (await (await GET(req(), ctx())).json()) as {
    data: { available: boolean; reason: string; distinctSkills: number; required: number };
  };

  expect(body.data.available).toBe(false);
  expect(body.data.reason).toBe("NOT_ENOUGH_SKILLS");
  expect(body.data.distinctSkills).toBe(CHECKPOINT_MIN_SKILLS - 1);
  expect(body.data.required).toBe(CHECKPOINT_MIN_SKILLS);
});

it("the reason is a stable code, not prose — the client owns the wording", async () => {
  dbMock.skillMastery.findMany.mockResolvedValue([]);
  const body = (await (await GET(req(), ctx())).json()) as { data: { reason: string } };

  expect(body.data.reason).toMatch(/^[A-Z_]+$/);
});

it("a brand-new profile with no mastery rows at all is simply not ready", async () => {
  dbMock.skillMastery.findMany.mockResolvedValue([]);
  const body = (await (await GET(req(), ctx())).json()) as { data: { available: boolean; distinctSkills: number } };

  expect(body.data.available).toBe(false);
  expect(body.data.distinctSkills).toBe(0);
});
