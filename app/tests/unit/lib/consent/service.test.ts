import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = {
  directNotice: { findFirst: vi.fn() },
  parentalConsent: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(), // must NEVER be called — the append-only guarantee under test
  },
  studentProfile: {
    update: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
  consentVerificationChallenge: {
    create: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") {
      return (arg as (tx: typeof dbMock) => Promise<unknown>)(dbMock);
    }
    return arg;
  }),
};

const providerMock = {
  method: "EMAIL_PLUS",
  begin: vi.fn(),
  corroborate: vi.fn(),
};

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/consent/methods/registry", () => ({
  getConsentMethodProvider: vi.fn(() => providerMock),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9", "user-agent": "test-agent" }),
}));

const { submitConsent, verifyConsent, declineConsent, withdrawConsent } = await import(
  "@/lib/consent/service"
);
const { DIRECT_NOTICE_VERSION } = await import("@/lib/notice/copy");
const { CONSENT_TEXT_VERSION } = await import("@/lib/config");

const ACTIVE_STUDENT = { id: "sp_1", status: "ACTIVE" } as const;
const PENDING_STUDENT = { id: "sp_1", status: "NOTICE_PENDING" } as const;

const NOTICE = {
  id: "notice_1",
  studentProfileId: "sp_1",
  noticeVersion: DIRECT_NOTICE_VERSION,
};

const VALID_INPUT = {
  directNoticeId: "notice_1",
  noticeVersion: DIRECT_NOTICE_VERSION,
  consentTextVersion: CONSENT_TEXT_VERSION,
  consentingAdultName: "Pat Parent",
  relationship: "PARENT",
  scopes: ["DATA_PROCESSING"],
  method: "EMAIL_PLUS",
  methodInput: {},
  affirmed: true as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.directNotice.findFirst.mockResolvedValue(NOTICE);
});

describe("submitConsent (endpoint 8)", () => {
  it("rejects with ALREADY_ACTIVE and writes nothing when the profile is already ACTIVE", async () => {
    const result = await submitConsent({
      student: ACTIVE_STUDENT as never,
      userId: "user_1",
      userEmail: "parent@example.com",
      input: VALID_INPUT as never,
    });
    expect(result).toEqual({ ok: false, code: "ALREADY_ACTIVE" });
    expect(dbMock.parentalConsent.create).not.toHaveBeenCalled();
  });

  it("rejects with NOTICE_MISMATCH when no DirectNotice matches directNoticeId for this profile", async () => {
    dbMock.directNotice.findFirst.mockResolvedValue(null);
    const result = await submitConsent({
      student: PENDING_STUDENT as never,
      userId: "user_1",
      userEmail: "parent@example.com",
      input: VALID_INPUT as never,
    });
    expect(result).toEqual({ ok: false, code: "NOTICE_MISMATCH" });
    expect(dbMock.parentalConsent.create).not.toHaveBeenCalled();
  });

  it("rejects with NOTICE_MISMATCH when the submitted noticeVersion is stale relative to the actual notice row", async () => {
    dbMock.directNotice.findFirst.mockResolvedValue({ ...NOTICE, noticeVersion: DIRECT_NOTICE_VERSION });
    const result = await submitConsent({
      student: PENDING_STUDENT as never,
      userId: "user_1",
      userEmail: "parent@example.com",
      input: { ...VALID_INPUT, noticeVersion: "1999-01-01.1" } as never,
    });
    expect(result).toEqual({ ok: false, code: "NOTICE_MISMATCH" });
  });

  it("rejects with STALE_CONSENT_TEXT_VERSION when the body's consent text version is not current", async () => {
    const result = await submitConsent({
      student: PENDING_STUDENT as never,
      userId: "user_1",
      userEmail: "parent@example.com",
      input: { ...VALID_INPUT, consentTextVersion: "1999-01-01.1" } as never,
    });
    expect(result).toEqual({ ok: false, code: "STALE_CONSENT_TEXT_VERSION" });
    expect(dbMock.parentalConsent.create).not.toHaveBeenCalled();
  });

  it("AC 17/18: a pending method (EMAIL_PLUS) appends a consent row with verifiedAt null, writes a challenge row, and moves the profile to CONSENT_PENDING — never ACTIVE", async () => {
    const created = {
      id: "consent_1",
      studentProfileId: "sp_1",
      submittedAt: new Date("2026-01-01T00:00:00.000Z"),
      verifiedAt: null,
      method: "EMAIL_PLUS",
    };
    dbMock.parentalConsent.create.mockResolvedValue(created);
    providerMock.begin.mockResolvedValue({
      kind: "pending",
      evidenceRef: null,
      challenge: { tokenHash: "a".repeat(64), expiresAt: new Date(Date.now() + 3600_000) },
    });
    dbMock.studentProfile.update.mockResolvedValue({ ...PENDING_STUDENT, status: "CONSENT_PENDING" });

    const result = await submitConsent({
      student: PENDING_STUDENT as never,
      userId: "user_1",
      userEmail: "parent@example.com",
      input: VALID_INPUT as never,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.consent.verifiedAt).toBeNull();
    expect(result.student.status).toBe("CONSENT_PENDING");

    expect(dbMock.parentalConsent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        studentProfileId: "sp_1",
        userId: "user_1",
        directNoticeId: "notice_1",
        method: "EMAIL_PLUS",
        ipAddress: "203.0.113.9",
        userAgent: "test-agent",
      }),
    });
    expect(dbMock.consentVerificationChallenge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ parentalConsentId: "consent_1", method: "EMAIL_PLUS" }),
    });
    // THE LOAD-BEARING ASSERTION for AC 18/19: the append-only rule's one
    // permitted mutation must never fire on submission — only on
    // corroboration (verifyConsent, tested below).
    expect(dbMock.parentalConsent.update).not.toHaveBeenCalled();
    expect(dbMock.parentalConsent.updateMany).not.toHaveBeenCalled();
  });

  it("a synchronous ('verified') method stamps verifiedAt strictly after submittedAt and activates in the same transaction (generic AC 19 path)", async () => {
    const submittedAt = new Date("2026-01-01T00:00:00.000Z");
    dbMock.parentalConsent.create.mockResolvedValue({
      id: "consent_1",
      studentProfileId: "sp_1",
      submittedAt,
      verifiedAt: null,
    });
    providerMock.begin.mockResolvedValue({ kind: "verified", evidenceRef: "txn_abc" });
    dbMock.parentalConsent.updateMany.mockResolvedValue({ count: 1 });
    dbMock.parentalConsent.findUniqueOrThrow.mockResolvedValue({
      id: "consent_1",
      submittedAt,
      verifiedAt: new Date(),
    });
    dbMock.studentProfile.findUniqueOrThrow.mockResolvedValue({ ...PENDING_STUDENT, status: "ACTIVE" });

    const result = await submitConsent({
      student: PENDING_STUDENT as never,
      userId: "user_1",
      userEmail: "parent@example.com",
      input: VALID_INPUT as never,
    });

    expect(result.ok).toBe(true);
    expect(dbMock.parentalConsent.updateMany).toHaveBeenCalledWith({
      where: { id: "consent_1", verifiedAt: null },
      data: { verifiedAt: expect.any(Date), methodEvidence: "txn_abc" },
    });
    const call = dbMock.parentalConsent.updateMany.mock.calls[0][0] as { data: { verifiedAt: Date } };
    expect(call.data.verifiedAt.getTime()).toBeGreaterThan(submittedAt.getTime());
    expect(dbMock.studentProfile.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "CONSENT_PENDING" }) }),
    );
  });
});

describe("verifyConsent (endpoint 9)", () => {
  it("returns NOT_FOUND when no challenge matches the token", async () => {
    dbMock.consentVerificationChallenge.findUnique.mockResolvedValue(null);
    const result = await verifyConsent("unknown-token");
    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(providerMock.corroborate).not.toHaveBeenCalled();
  });

  it("maps a provider EXPIRED/ALREADY_USED/REJECTED failure without ever stamping", async () => {
    dbMock.consentVerificationChallenge.findUnique.mockResolvedValue({ id: "chal_1", method: "EMAIL_PLUS" });
    providerMock.corroborate.mockResolvedValue({ ok: false, code: "EXPIRED" });

    const result = await verifyConsent("token");
    expect(result).toEqual({ ok: false, code: "EXPIRED" });
    expect(dbMock.parentalConsent.updateMany).not.toHaveBeenCalled();
  });

  it("AC 19: on success, stamps verifiedAt (via the ONE permitted conditional UPDATE) strictly after submittedAt and activates the profile", async () => {
    dbMock.consentVerificationChallenge.findUnique.mockResolvedValue({ id: "chal_1", method: "EMAIL_PLUS" });
    providerMock.corroborate.mockResolvedValue({ ok: true, consentId: "consent_1", evidenceRef: "chal_1" });
    const submittedAt = new Date("2026-01-01T00:00:00.000Z");
    dbMock.parentalConsent.findUniqueOrThrow.mockResolvedValue({
      id: "consent_1",
      studentProfileId: "sp_1",
      submittedAt,
    });
    dbMock.parentalConsent.updateMany.mockResolvedValue({ count: 1 });
    dbMock.studentProfile.findUniqueOrThrow.mockResolvedValue({ ...PENDING_STUDENT, status: "ACTIVE" });

    const result = await verifyConsent("token");

    expect(result).toEqual({ ok: true, student: expect.objectContaining({ status: "ACTIVE" }) });
    expect(dbMock.parentalConsent.updateMany).toHaveBeenCalledWith({
      where: { id: "consent_1", verifiedAt: null },
      data: { verifiedAt: expect.any(Date), methodEvidence: "chal_1" },
    });
    const stampCall = dbMock.parentalConsent.updateMany.mock.calls[0][0] as { data: { verifiedAt: Date } };
    expect(stampCall.data.verifiedAt.getTime()).toBeGreaterThan(submittedAt.getTime());
    expect(dbMock.studentProfile.update).toHaveBeenCalledWith({
      where: { id: "sp_1" },
      data: { status: "ACTIVE", activatedAt: expect.any(Date) },
    });
    // Never any other shape of write against ParentalConsent.
    expect(dbMock.parentalConsent.update).not.toHaveBeenCalled();
  });

  it("is idempotent: a replay where the conditional UPDATE affects zero rows does not re-activate or error", async () => {
    dbMock.consentVerificationChallenge.findUnique.mockResolvedValue({ id: "chal_1", method: "EMAIL_PLUS" });
    providerMock.corroborate.mockResolvedValue({ ok: true, consentId: "consent_1", evidenceRef: "chal_1" });
    dbMock.parentalConsent.findUniqueOrThrow.mockResolvedValue({
      id: "consent_1",
      studentProfileId: "sp_1",
      submittedAt: new Date(),
    });
    dbMock.parentalConsent.updateMany.mockResolvedValue({ count: 0 }); // already verified
    dbMock.studentProfile.findUniqueOrThrow.mockResolvedValue({ ...PENDING_STUDENT, status: "ACTIVE" });

    const result = await verifyConsent("token");
    expect(result.ok).toBe(true);
    expect(dbMock.studentProfile.update).not.toHaveBeenCalled();
  });
});

describe("declineConsent (endpoint 10) — AC 21", () => {
  it("returns NOT_FOUND for an unknown token", async () => {
    dbMock.consentVerificationChallenge.findUnique.mockResolvedValue(null);
    expect(await declineConsent("unknown")).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("returns ALREADY_USED for a token that already granted verified consent — cannot decline after the fact", async () => {
    dbMock.consentVerificationChallenge.findUnique.mockResolvedValue({
      id: "chal_1",
      consumedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      parentalConsent: { verifiedAt: new Date() },
    });
    expect(await declineConsent("token")).toEqual({ ok: false, code: "ALREADY_USED" });
  });

  it("never touches ParentalConsent, and consumes the challenge on success", async () => {
    dbMock.consentVerificationChallenge.findUnique.mockResolvedValue({
      id: "chal_1",
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      parentalConsent: { verifiedAt: null },
    });
    dbMock.consentVerificationChallenge.updateMany.mockResolvedValue({ count: 1 });

    const result = await declineConsent("token");
    expect(result).toEqual({ ok: true });
    expect(dbMock.parentalConsent.create).not.toHaveBeenCalled();
    expect(dbMock.parentalConsent.update).not.toHaveBeenCalled();
    expect(dbMock.parentalConsent.updateMany).not.toHaveBeenCalled();
  });
});

describe("withdrawConsent (endpoint 12) — AC 24, the append-only guarantee", () => {
  it("rejects with NOT_ACTIVE when the profile is not ACTIVE", async () => {
    const result = await withdrawConsent({ student: PENDING_STUDENT as never, userId: "user_1" });
    expect(result).toEqual({ ok: false, code: "NOT_ACTIVE" });
    expect(dbMock.parentalConsent.create).not.toHaveBeenCalled();
  });

  it("APPENDS a new row with withdrawnAt/supersedesConsentId set, and NEVER calls .update()/.updateMany() against the prior row — proving byte-identical-in-place (AC 24)", async () => {
    const priorRow = {
      id: "consent_1",
      studentProfileId: "sp_1",
      directNoticeId: "notice_1",
      noticeVersion: DIRECT_NOTICE_VERSION,
      consentingAdultName: "Pat Parent",
      relationship: "PARENT",
      scopes: ["DATA_PROCESSING"],
      consentTextVersion: CONSENT_TEXT_VERSION,
      method: "EMAIL_PLUS",
      verifiedAt: new Date("2026-01-01T00:00:00.000Z"),
      withdrawnAt: null,
      submittedAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    dbMock.parentalConsent.findFirst.mockResolvedValue(priorRow);
    dbMock.studentProfile.update.mockResolvedValue({ ...ACTIVE_STUDENT, status: "CONSENT_WITHDRAWN" });

    const result = await withdrawConsent({ student: ACTIVE_STUDENT as never, userId: "user_2" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.student.status).toBe("CONSENT_WITHDRAWN");

    expect(dbMock.parentalConsent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        studentProfileId: "sp_1",
        userId: "user_2",
        directNoticeId: "notice_1",
        noticeVersion: DIRECT_NOTICE_VERSION,
        method: "EMAIL_PLUS",
        scopes: ["DATA_PROCESSING"],
        withdrawnAt: expect.any(Date),
        supersedesConsentId: "consent_1",
      }),
    });

    // THE LOAD-BEARING ASSERTION: the prior row's own fields (verifiedAt,
    // withdrawnAt=null, everything else) are never targeted by any mutation.
    // A test that only checked the appended row's shape would pass even if
    // someone later added a second UPDATE against the prior row.
    expect(dbMock.parentalConsent.update).not.toHaveBeenCalled();
    expect(dbMock.parentalConsent.updateMany).not.toHaveBeenCalled();
  });
});
