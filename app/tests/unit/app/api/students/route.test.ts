import { beforeEach, describe, expect, it, vi } from "vitest";

const SESSION = { userId: "user_1" };

const dbMock = {
  studentProfile: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  directNotice: { findFirst: vi.fn() },
  parentalConsent: {
    findFirst: vi.fn(),
    findMany: vi.fn(async () => [] as unknown[]),
    deleteMany: vi.fn(),
  },
  // `DELETE` now runs through `deleteStudentData` (`lib/deletion/service.ts`,
  // B13), which reads `Upload` rows before anything else (ADR-0007 §1,
  // blobs-first). Defaults to no uploads, matching every test below: none
  // of them exercise the blob-deletion half, which
  // `tests/unit/lib/deletion/service.test.ts` covers directly against a
  // fake `StoragePort`.
  upload: {
    findMany: vi.fn(async () => [] as Array<{ pathname: string }>),
    updateMany: vi.fn(),
  },
  // M5 §7.2 — the second PROFILE_BLOB_SOURCES entry. Defaults to no
  // narration assets, matching every test below.
  narrationAsset: {
    findMany: vi.fn(async () => [] as Array<{ pathname: string }>),
  },
  user: { findMany: vi.fn(async () => [] as unknown[]) },
  consentAuditArtifact: { createMany: vi.fn() },
  deletionAudit: { create: vi.fn() },
  // `deleteStudentData`'s row-destroying phase uses the interactive form,
  // `db.$transaction(async (tx) => {...})` — `tx` is just `dbMock` itself
  // here, since every model method above is already a `vi.fn()`.
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") {
      return (arg as (tx: typeof dbMock) => Promise<unknown>)(dbMock);
    }
    return arg;
  }),
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
  it("rejects a body carrying a display name at the age gate (AC 8/9) — 400, nothing created, and a non-empty explanation", async () => {
    const res = await POST(
      req({ method: "POST", body: { ageBand: "UNDER_13", displayName: "Sam" } }),
      ctx(),
    );
    const body = (await res.json()) as {
      ok: false;
      error: { code: string; fieldErrors?: Record<string, string[]>; formErrors?: string[] };
    };
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(dbMock.studentProfile.create).not.toHaveBeenCalled();
    // A .strict() schema's "unrecognized key" violation lands in
    // `formErrors`, not `fieldErrors` — `fieldErrors` alone would be `{}`
    // here, an empty explanation for the single most legally important
    // validation in the app.
    expect(body.error.formErrors?.length).toBeGreaterThan(0);
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

  it("DELETE on an owned profile with no consent history writes a DeletionAudit and deletes the row", async () => {
    dalMock.requireStudentProfile.mockResolvedValue({ id: "abc", status: "ACTIVE" });
    dbMock.parentalConsent.findMany.mockResolvedValue([]);

    const res = await studentIdRoute.DELETE(req({ method: "DELETE" }), ctx());
    const body = (await res.json()) as { ok: true; data: { deleted: true } };

    expect(res.status).toBe(200);
    expect(body.data.deleted).toBe(true);
    expect(dbMock.$transaction).toHaveBeenCalled();
    expect(dbMock.deletionAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: "PROFILE_DELETED", subjectRef: "abc" }) }),
    );
    // Nothing to pseudonymise or delete when there was never a consent row.
    expect(dbMock.consentAuditArtifact.createMany).not.toHaveBeenCalled();
    expect(dbMock.parentalConsent.deleteMany).not.toHaveBeenCalled();
    expect(dbMock.studentProfile.delete).toHaveBeenCalledWith({ where: { id: "abc" } });
  });

  it("DELETE on a CONSENTED profile (blocker 3, ADR-0007 §6/AC 50) pseudonymises every ParentalConsent row into a ConsentAuditArtifact and deletes the consent rows BEFORE the profile cascade", async () => {
    dalMock.requireStudentProfile.mockResolvedValue({ id: "abc", status: "ACTIVE" });
    const submittedAt = new Date("2026-01-01T00:00:00.000Z");
    const verifiedAt = new Date("2026-01-02T00:00:00.000Z");
    dbMock.parentalConsent.findMany.mockResolvedValue([
      {
        id: "consent_1",
        userId: "user_1",
        studentProfileId: "abc",
        consentTextVersion: "2026-08-26.1",
        noticeVersion: "2026-08-26.1",
        method: "EMAIL_PLUS",
        submittedAt,
        verifiedAt,
        withdrawnAt: null,
      },
    ]);
    dbMock.user.findMany.mockResolvedValue([{ id: "user_1", email: "parent@example.com" }]);

    const res = await studentIdRoute.DELETE(req({ method: "DELETE" }), ctx());
    const body = (await res.json()) as { ok: true; data: { deleted: true } };

    expect(res.status).toBe(200);
    expect(body.data.deleted).toBe(true);

    // One artifact per consent row, carrying only the ADR-0007 §6 allowlist
    // — no name, no relationship, no IP, no user agent, no foreign key.
    expect(dbMock.consentAuditArtifact.createMany).toHaveBeenCalledTimes(1);
    const createManyArgs = dbMock.consentAuditArtifact.createMany.mock.calls[0][0] as {
      data: Array<Record<string, unknown>>;
    };
    expect(createManyArgs.data).toHaveLength(1);
    const artifact = createManyArgs.data[0];
    expect(artifact).toMatchObject({
      consentTextVersion: "2026-08-26.1",
      noticeVersion: "2026-08-26.1",
      method: "EMAIL_PLUS",
      submittedAt,
      verifiedAt,
      withdrawnAt: null,
    });
    expect(artifact).not.toHaveProperty("studentProfileId");
    expect(artifact).not.toHaveProperty("consentingAdultName");
    expect(artifact).not.toHaveProperty("relationship");
    expect(artifact).not.toHaveProperty("ipAddress");
    expect(artifact).not.toHaveProperty("userAgent");
    expect(typeof artifact.adultIdentityHash).toBe("string");
    expect(artifact.adultIdentityHash).not.toBe("parent@example.com");
    expect(artifact.purgeAfter).toBeInstanceOf(Date);

    // The consent rows are destroyed explicitly, and — because this mock
    // resolves synchronously in the order the handler calls it — BEFORE the
    // studentProfile cascade delete.
    expect(dbMock.parentalConsent.deleteMany).toHaveBeenCalledWith({
      where: { studentProfileId: "abc" },
    });
    const createManyOrder = dbMock.consentAuditArtifact.createMany.mock.invocationCallOrder[0];
    const deleteManyOrder = dbMock.parentalConsent.deleteMany.mock.invocationCallOrder[0];
    const profileDeleteOrder = dbMock.studentProfile.delete.mock.invocationCallOrder[0];
    expect(createManyOrder).toBeLessThan(deleteManyOrder);
    expect(deleteManyOrder).toBeLessThan(profileDeleteOrder);
  });
});
