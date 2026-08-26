import { beforeEach, describe, expect, it, vi } from "vitest";

const SESSION = { userId: "user_1" };

const dbMock = {
  studentProfile: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  directNotice: { findFirst: vi.fn() },
  parentalConsent: { findFirst: vi.fn() },
  deletionAudit: { create: vi.fn() },
  $transaction: vi.fn(async (ops: unknown[]) => ops),
};

const dalMock = {
  verifySession: vi.fn(async () => SESSION as { userId: string } | null),
  requireStudentProfile: vi.fn(),
};

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/auth/dal", () => dalMock);

const { POST } = await import("@/app/api/students/route");
const studentIdRoute = await import("@/app/api/students/[studentId]/route");

function req(opts: { method: string; body?: unknown }) {
  return new Request("http://localhost/api/students/abc", {
    method: opts.method,
    headers: opts.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

function ctx(studentId = "abc") {
  return { params: Promise.resolve({ studentId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  dalMock.verifySession.mockResolvedValue(SESSION);
});

describe("POST /api/students (endpoint 2)", () => {
  it("rejects a body carrying a display name at the age gate (AC 8/9) — 400, nothing created", async () => {
    const res = await POST(
      req({ method: "POST", body: { ageBand: "UNDER_13", displayName: "Sam" } }),
      ctx(),
    );
    const body = (await res.json()) as { ok: false; error: { code: string } };
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(dbMock.studentProfile.create).not.toHaveBeenCalled();
  });

  it("an ADULT age band activates immediately with no notice/consent step (AC 10)", async () => {
    dbMock.studentProfile.create.mockResolvedValue({
      id: "sp_1",
      ageBand: "ADULT",
      status: "ACTIVE",
      displayName: null,
      gradeLevel: null,
      subjects: [],
      avatarId: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const res = await POST(req({ method: "POST", body: { ageBand: "ADULT" } }), ctx());
    const body = (await res.json()) as { ok: true; data: { student: { status: string; nextStep: string } } };

    expect(res.status).toBe(201);
    expect(body.data.student.status).toBe("ACTIVE");
    expect(body.data.student.nextStep).toBe("PROFILE_DETAILS");
    expect(dbMock.studentProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ageBand: "ADULT", status: "ACTIVE" }),
      }),
    );
  });

  it("an under-18 age band starts NOTICE_PENDING with no status override", async () => {
    dbMock.studentProfile.create.mockResolvedValue({
      id: "sp_2",
      ageBand: "AGE_13_17",
      status: "NOTICE_PENDING",
      displayName: null,
      gradeLevel: null,
      subjects: [],
      avatarId: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const res = await POST(req({ method: "POST", body: { ageBand: "AGE_13_17" } }), ctx());
    const body = (await res.json()) as { ok: true; data: { student: { status: string; nextStep: string } } };

    expect(res.status).toBe(201);
    expect(body.data.student.status).toBe("NOTICE_PENDING");
    expect(body.data.student.nextStep).toBe("NOTICE");
    const createArgs = dbMock.studentProfile.create.mock.calls[0][0];
    expect(createArgs.data).not.toHaveProperty("status");
  });

  it("401s with no session", async () => {
    dalMock.verifySession.mockResolvedValue(null);
    const res = await POST(req({ method: "POST", body: { ageBand: "ADULT" } }), ctx());
    expect(res.status).toBe(401);
  });
});

describe("GET/PATCH/DELETE /api/students/[studentId] (endpoints 3-5)", () => {
  it("GET returns 404 for a cross-account or nonexistent profile (AC 32)", async () => {
    dalMock.requireStudentProfile.mockResolvedValue(null);
    const res = await studentIdRoute.GET(req({ method: "GET" }), ctx());
    expect(res.status).toBe(404);
  });

  it("PATCH against a non-ACTIVE profile is 403 even with an invalid body (AC 11)", async () => {
    dalMock.requireStudentProfile.mockResolvedValue({ id: "abc", status: "NOTICE_PENDING" });
    const res = await studentIdRoute.PATCH(
      req({ method: "PATCH", body: { gradeLevel: "NOT_A_REAL_GRADE" } }),
      ctx(),
    );
    const body = (await res.json()) as { ok: false; error: { code: string } };
    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(dbMock.studentProfile.update).not.toHaveBeenCalled();
  });

  it("PATCH against an ACTIVE profile with a valid body persists and returns the DTO", async () => {
    dalMock.requireStudentProfile.mockResolvedValue({ id: "abc", status: "ACTIVE" });
    dbMock.studentProfile.update.mockResolvedValue({
      id: "abc",
      ageBand: "AGE_13_17",
      status: "ACTIVE",
      displayName: "Sam",
      gradeLevel: "GRADE_5",
      subjects: ["MATH"],
      avatarId: "fox",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const res = await studentIdRoute.PATCH(
      req({
        method: "PATCH",
        body: { displayName: "Sam", gradeLevel: "GRADE_5", subjects: ["MATH"], avatarId: "fox" },
      }),
      ctx(),
    );
    const body = (await res.json()) as { ok: true; data: { student: { displayName: string; nextStep: string } } };
    expect(res.status).toBe(200);
    expect(body.data.student.displayName).toBe("Sam");
    expect(body.data.student.nextStep).toBe("NONE");
  });

  it("DELETE returns 404 cross-account and never touches the destructive path", async () => {
    dalMock.requireStudentProfile.mockResolvedValue(null);
    const res = await studentIdRoute.DELETE(req({ method: "DELETE" }), ctx());
    expect(res.status).toBe(404);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("DELETE on an owned profile writes a DeletionAudit and deletes the row", async () => {
    dalMock.requireStudentProfile.mockResolvedValue({ id: "abc", status: "ACTIVE" });
    const res = await studentIdRoute.DELETE(req({ method: "DELETE" }), ctx());
    const body = (await res.json()) as { ok: true; data: { deleted: true } };
    expect(res.status).toBe(200);
    expect(body.data.deleted).toBe(true);
    expect(dbMock.$transaction).toHaveBeenCalled();
    expect(dbMock.deletionAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: "PROFILE_DELETED", subjectRef: "abc" }) }),
    );
  });
});
