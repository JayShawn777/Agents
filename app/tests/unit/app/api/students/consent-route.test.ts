import { beforeEach, describe, expect, it, vi } from "vitest";

const SESSION = { userId: "user_1" };

const dbMock = {
  user: { findUniqueOrThrow: vi.fn(async () => ({ id: "user_1", email: "parent@example.com" })) },
  directNotice: { findFirst: vi.fn() },
};

const dalMock = {
  verifySession: vi.fn(async () => SESSION as { userId: string } | null),
  requireStudentProfile: vi.fn(),
};

const submitConsentMock = vi.fn();
const withdrawConsentMock = vi.fn();

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/auth/dal", () => dalMock);
vi.mock("@/lib/consent/service", () => ({
  submitConsent: submitConsentMock,
  withdrawConsent: withdrawConsentMock,
}));

const consentRoute = await import("@/app/api/students/[studentId]/consent/route");
const withdrawRoute = await import("@/app/api/students/[studentId]/consent/withdraw/route");
const { DIRECT_NOTICE_VERSION } = await import("@/lib/notice/copy");
const { CONSENT_TEXT_VERSION } = await import("@/lib/config");

function req(body: unknown) {
  return new Request("http://localhost/api/students/sp_1/consent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ctx(studentId = "sp_1") {
  return { params: Promise.resolve({ studentId }) };
}

const VALID_BODY = {
  directNoticeId: "c000000000000000000000001",
  noticeVersion: DIRECT_NOTICE_VERSION,
  consentTextVersion: CONSENT_TEXT_VERSION,
  consentingAdultName: "Pat Parent",
  relationship: "PARENT",
  scopes: ["DATA_PROCESSING"],
  method: "EMAIL_PLUS",
  methodInput: {},
  affirmed: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  dalMock.verifySession.mockResolvedValue(SESSION);
  dalMock.requireStudentProfile.mockResolvedValue({ id: "sp_1", status: "NOTICE_PENDING" });
  dbMock.directNotice.findFirst.mockResolvedValue({ id: "notice_1", studentProfileId: "sp_1" });
});

describe("POST /api/students/[studentId]/consent (endpoint 8)", () => {
  it("404s cross-account", async () => {
    dalMock.requireStudentProfile.mockResolvedValue(null);
    const res = await consentRoute.POST(req(VALID_BODY), ctx());
    expect(res.status).toBe(404);
  });

  it("AC 15: 409s with no DirectNotice at all for this profile, even with a garbage body — no call to submitConsent", async () => {
    dbMock.directNotice.findFirst.mockResolvedValue(null);
    const res = await consentRoute.POST(req({ garbage: true }), ctx());
    const body = (await res.json()) as { ok: false; error: { code: string } };
    expect(res.status).toBe(409);
    expect(body.error.code).toBe("CONFLICT");
    expect(submitConsentMock).not.toHaveBeenCalled();
  });

  it("409s when the profile is already ACTIVE, before the body is even parsed", async () => {
    dalMock.requireStudentProfile.mockResolvedValue({ id: "sp_1", status: "ACTIVE" });
    const res = await consentRoute.POST(req({ garbage: true }), ctx());
    expect(res.status).toBe(409);
    expect(submitConsentMock).not.toHaveBeenCalled();
  });

  it("AC 20: a bare {consentingAdultName, relationship, affirmed} body is 400, and submitConsent is never reached", async () => {
    const res = await consentRoute.POST(
      req({ consentingAdultName: "Pat", relationship: "PARENT", affirmed: true }),
      ctx(),
    );
    expect(res.status).toBe(400);
    expect(submitConsentMock).not.toHaveBeenCalled();
  });

  it("maps a service-level CONFLICT result to 409", async () => {
    submitConsentMock.mockResolvedValue({ ok: false, code: "STALE_CONSENT_TEXT_VERSION" });
    const res = await consentRoute.POST(req(VALID_BODY), ctx());
    expect(res.status).toBe(409);
  });

  it("AC 18: 202s with verifiedAt null and status CONSENT_PENDING on success", async () => {
    submitConsentMock.mockResolvedValue({
      ok: true,
      student: {
        id: "sp_1",
        ageBand: "UNDER_13",
        status: "CONSENT_PENDING",
        displayName: null,
        gradeLevel: null,
        subjects: [],
        avatarId: null,
        createdAt: new Date(),
      },
      consent: {
        id: "consent_1",
        method: "EMAIL_PLUS",
        consentTextVersion: CONSENT_TEXT_VERSION,
        noticeVersion: DIRECT_NOTICE_VERSION,
        relationship: "PARENT",
        submittedAt: new Date(),
        verifiedAt: null,
        withdrawnAt: null,
      },
    });

    const res = await consentRoute.POST(req(VALID_BODY), ctx());
    const body = (await res.json()) as {
      ok: true;
      data: { student: { status: string; nextStep: string }; consent: { verifiedAt: string | null } };
    };
    expect(res.status).toBe(202);
    expect(body.data.student.status).toBe("CONSENT_PENDING");
    expect(body.data.student.nextStep).toBe("CONSENT_PENDING");
    expect(body.data.consent.verifiedAt).toBeNull();
  });
});

describe("POST /api/students/[studentId]/consent/withdraw (endpoint 12)", () => {
  it("404s cross-account", async () => {
    dalMock.requireStudentProfile.mockResolvedValue(null);
    const res = await withdrawRoute.POST(req({ confirm: true }), ctx());
    expect(res.status).toBe(404);
  });

  it("409s when the service reports NOT_ACTIVE", async () => {
    withdrawConsentMock.mockResolvedValue({ ok: false, code: "NOT_ACTIVE" });
    const res = await withdrawRoute.POST(req({ confirm: true }), ctx());
    const body = (await res.json()) as { ok: false; error: { code: string } };
    expect(res.status).toBe(409);
    expect(body.error.code).toBe("CONFLICT");
  });

  it("AC 24: 201s with status CONSENT_WITHDRAWN on success", async () => {
    withdrawConsentMock.mockResolvedValue({
      ok: true,
      student: {
        id: "sp_1",
        ageBand: "UNDER_13",
        status: "CONSENT_WITHDRAWN",
        displayName: "Sam",
        gradeLevel: "GRADE_5",
        subjects: ["MATH"],
        avatarId: "fox",
        createdAt: new Date(),
      },
    });
    const res = await withdrawRoute.POST(req({ confirm: true }), ctx());
    const body = (await res.json()) as { ok: true; data: { student: { status: string } } };
    expect(res.status).toBe(201);
    expect(body.data.student.status).toBe("CONSENT_WITHDRAWN");
    expect(withdrawConsentMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user_1" }),
    );
  });

  it("400s on a missing confirm field", async () => {
    const res = await withdrawRoute.POST(req({}), ctx());
    expect(res.status).toBe(400);
    expect(withdrawConsentMock).not.toHaveBeenCalled();
  });
});
