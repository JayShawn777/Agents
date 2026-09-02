import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `PATCH /api/students/[studentId]` (endpoint 4), the M5 extension (plan §3
 * row 4†): `personaId`/`captionsEnabled`, still Owner+ACTIVE, still
 * `.strict()`, and the new 409 when `personaId` doesn't resolve to an
 * existing, non-retired persona.
 */

const SESSION = { userId: "user_1" };

const dbMock = {
  studentProfile: { update: vi.fn() },
  directNotice: { findFirst: vi.fn() },
  parentalConsent: { findFirst: vi.fn() },
  persona: { findFirst: vi.fn(), findUnique: vi.fn() },
};

const dalMock = {
  verifySession: vi.fn(async () => SESSION as { userId: string } | null),
  requireStudentProfile: vi.fn(),
};

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/auth/dal", () => dalMock);

const { PATCH } = await import("@/app/api/students/[studentId]/route");

function req(body: unknown) {
  return new Request("http://localhost/api/students/abc", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = () => ({ params: Promise.resolve({ studentId: "abc" }) });

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: "abc",
    ageBand: "AGE_13_17",
    status: "ACTIVE",
    displayName: "Sam",
    gradeLevel: "GRADE_5",
    subjects: ["MATH"],
    avatarId: "fox",
    personaId: null,
    captionsEnabled: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dalMock.verifySession.mockResolvedValue(SESSION);
  dalMock.requireStudentProfile.mockResolvedValue(profile());
  dbMock.studentProfile.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
    profile(data as Record<string, unknown>),
  );
});

describe("PATCH persona selection (AC 3/4)", () => {
  it("409s a personaId that does not resolve to a non-retired persona, and writes nothing", async () => {
    dbMock.persona.findFirst.mockResolvedValue(null);

    const res = await PATCH(req({ personaId: "clh3k2j9x0000persona00001" }), ctx());
    expect(res.status).toBe(409);
    expect(dbMock.studentProfile.update).not.toHaveBeenCalled();
  });

  it("409s a RETIRED persona specifically (findFirst is scoped to retiredAt: null)", async () => {
    dbMock.persona.findFirst.mockResolvedValue(null); // scoped query itself excludes retired rows

    const res = await PATCH(req({ personaId: "clh3k2j9x0000persona00001" }), ctx());
    expect(res.status).toBe(409);
    expect(dbMock.persona.findFirst).toHaveBeenCalledWith({
      where: { id: "clh3k2j9x0000persona00001", retiredAt: null },
    });
  });

  it("200s and persists a resolving personaId, returning the persona on the response", async () => {
    const PERSONA_ID = "clh3k2j9x0002personaabcde";
    dbMock.persona.findFirst.mockResolvedValue({ id: PERSONA_ID, slug: "coach-vale", label: "Coach Vale" });
    dbMock.persona.findUnique.mockResolvedValue({ id: PERSONA_ID, slug: "coach-vale", label: "Coach Vale" });

    const res = await PATCH(req({ personaId: PERSONA_ID }), ctx());
    expect(res.status).toBe(200);

    const update = dbMock.studentProfile.update.mock.calls[0][0];
    expect(update.data).toEqual({ personaId: PERSONA_ID });

    const body = (await res.json()) as { data: { student: { persona: unknown } } };
    expect(body.data.student.persona).toEqual({ id: PERSONA_ID, slug: "coach-vale", label: "Coach Vale" });
  });

  it("200s captionsEnabled: false and persists it (AC 18)", async () => {
    const res = await PATCH(req({ captionsEnabled: false }), ctx());
    expect(res.status).toBe(200);
    expect(dbMock.studentProfile.update.mock.calls[0][0].data).toEqual({ captionsEnabled: false });
    const body = (await res.json()) as { data: { student: { captionsEnabled: boolean } } };
    expect(body.data.student.captionsEnabled).toBe(false);
  });

  it("resolves persona on the response even when this PATCH didn't touch personaId", async () => {
    dalMock.requireStudentProfile.mockResolvedValue(profile({ personaId: "persona_existing" }));
    dbMock.studentProfile.update.mockResolvedValue(profile({ personaId: "persona_existing", displayName: "Ada" }));
    dbMock.persona.findUnique.mockResolvedValue({ id: "persona_existing", slug: "professor-o", label: "Professor O" });

    const res = await PATCH(req({ displayName: "Ada" }), ctx());
    expect(res.status).toBe(200);
    expect(dbMock.persona.findFirst).not.toHaveBeenCalled(); // no personaId in THIS body, no resolution check
    const body = (await res.json()) as { data: { student: { persona: unknown } } };
    expect(body.data.student.persona).toEqual({ id: "persona_existing", slug: "professor-o", label: "Professor O" });
  });

  it("403s a non-ACTIVE profile even with an invalid personaId, before the persona lookup runs (AC 11 ordering)", async () => {
    dalMock.requireStudentProfile.mockResolvedValue(profile({ status: "CONSENT_WITHDRAWN" }));

    const res = await PATCH(req({ personaId: "not-a-cuid" }), ctx());
    expect(res.status).toBe(403);
    expect(dbMock.persona.findFirst).not.toHaveBeenCalled();
    expect(dbMock.studentProfile.update).not.toHaveBeenCalled();
  });

  it("400s a malformed personaId (not cuid-shaped)", async () => {
    const res = await PATCH(req({ personaId: "not-a-cuid" }), ctx());
    expect(res.status).toBe(400);
    expect(dbMock.studentProfile.update).not.toHaveBeenCalled();
  });

  it("400s an undeclared body key, still .strict()", async () => {
    const res = await PATCH(req({ voiceStyle: "excited" }), ctx());
    expect(res.status).toBe(400);
  });
});
