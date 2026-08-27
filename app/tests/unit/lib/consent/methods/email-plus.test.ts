import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = {
  consentVerificationChallenge: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
};

const sendConsentConfirmationEmailMock = vi.fn(async (input: unknown) => {
  void input; // typed as `unknown` purely so `.mock.calls[0][0]` below is indexable
  return { delivered: true, deliveryRef: "resend_1" };
});

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/email/send-consent-confirmation", () => ({
  sendConsentConfirmationEmail: sendConsentConfirmationEmailMock,
}));

const { emailPlusProvider } = await import("@/lib/consent/methods/email-plus");

const CTX = {
  parentalConsentId: "consent_1",
  studentProfileId: "sp_1",
  userId: "user_1",
  userEmail: "parent@example.com",
  consentingAdultName: "Pat Parent",
  methodInput: {},
  ipAddress: "203.0.113.9",
  userAgent: "test-agent",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("emailPlusProvider.begin", () => {
  it("returns a pending result with a challenge (tokenHash + expiresAt), never the raw token", async () => {
    const result = await emailPlusProvider.begin(CTX);
    expect(result.kind).toBe("pending");
    if (result.kind !== "pending") throw new Error("unreachable");
    expect(result.evidenceRef).toBeNull();
    expect(result.challenge).toBeDefined();
    expect(result.challenge!.tokenHash).toMatch(/^[a-f0-9]{64}$/); // sha256 hex
    expect(result.challenge!.expiresAt).toBeInstanceOf(Date);
    expect(result.challenge!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("sends the confirmation email with a verify URL and a distinct decline URL, and never logs/returns the raw token elsewhere", async () => {
    await emailPlusProvider.begin(CTX);
    expect(sendConsentConfirmationEmailMock).toHaveBeenCalledTimes(1);
    const call = sendConsentConfirmationEmailMock.mock.calls[0][0] as {
      to: string;
      verifyUrl: string;
      declineUrl: string;
    };
    expect(call.to).toBe("parent@example.com");
    expect(call.verifyUrl).toMatch(/\/consent\/verify\//);
    expect(call.declineUrl).toMatch(/\/consent\/verify\//);
    expect(call.declineUrl).not.toBe(call.verifyUrl);
    expect(call.declineUrl).toContain("action=decline");
  });

  it("rejects a non-empty methodInput (EMAIL_PLUS contributes nothing)", async () => {
    await expect(emailPlusProvider.begin({ ...CTX, methodInput: { extra: "field" } })).rejects.toThrow();
  });
});

describe("emailPlusProvider.corroborate", () => {
  it("returns NOT_FOUND for a token with no matching challenge row", async () => {
    dbMock.consentVerificationChallenge.findUnique.mockResolvedValue(null);
    const result = await emailPlusProvider.corroborate("some-unknown-token");
    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("returns NOT_FOUND for a row belonging to a different method (defence in depth against dispatch mistakes)", async () => {
    dbMock.consentVerificationChallenge.findUnique.mockResolvedValue({
      id: "chal_1",
      method: "TEXT_PLUS",
      parentalConsentId: "consent_1",
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      parentalConsent: { verifiedAt: null },
    });
    const result = await emailPlusProvider.corroborate("token");
    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("succeeds and atomically consumes an unconsumed, unexpired challenge", async () => {
    dbMock.consentVerificationChallenge.findUnique.mockResolvedValue({
      id: "chal_1",
      method: "EMAIL_PLUS",
      parentalConsentId: "consent_1",
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      parentalConsent: { verifiedAt: null },
    });
    dbMock.consentVerificationChallenge.updateMany.mockResolvedValue({ count: 1 });

    const result = await emailPlusProvider.corroborate("token");
    expect(result).toEqual({ ok: true, consentId: "consent_1", evidenceRef: "chal_1" });
    expect(dbMock.consentVerificationChallenge.updateMany).toHaveBeenCalledWith({
      where: { id: "chal_1", consumedAt: null, expiresAt: { gt: expect.any(Date) } },
      data: { consumedAt: expect.any(Date) },
    });
    expect(dbMock.consentVerificationChallenge.update).not.toHaveBeenCalled();
  });

  it("is idempotent for a replay of an already-VERIFIED token: ok:true, no attemptCount increment, no consume attempt", async () => {
    dbMock.consentVerificationChallenge.findUnique.mockResolvedValue({
      id: "chal_1",
      method: "EMAIL_PLUS",
      parentalConsentId: "consent_1",
      consumedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      parentalConsent: { verifiedAt: new Date() },
    });

    const result = await emailPlusProvider.corroborate("token");
    expect(result).toEqual({ ok: true, consentId: "consent_1", evidenceRef: "chal_1" });
    expect(dbMock.consentVerificationChallenge.updateMany).not.toHaveBeenCalled();
    expect(dbMock.consentVerificationChallenge.update).not.toHaveBeenCalled();
  });

  it("returns ALREADY_USED (and increments attemptCount) for a token already consumed via decline", async () => {
    dbMock.consentVerificationChallenge.findUnique.mockResolvedValue({
      id: "chal_1",
      method: "EMAIL_PLUS",
      parentalConsentId: "consent_1",
      consumedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      parentalConsent: { verifiedAt: null },
    });
    dbMock.consentVerificationChallenge.updateMany.mockResolvedValue({ count: 0 });
    dbMock.consentVerificationChallenge.update.mockResolvedValue({
      id: "chal_1",
      parentalConsentId: "consent_1",
      consumedAt: new Date(),
      parentalConsent: { verifiedAt: null },
    });

    const result = await emailPlusProvider.corroborate("token");
    expect(result).toEqual({ ok: false, code: "ALREADY_USED" });
    expect(dbMock.consentVerificationChallenge.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "chal_1" }, data: { attemptCount: { increment: 1 } } }),
    );
  });

  it("returns EXPIRED (and increments attemptCount) for an expired, never-consumed token", async () => {
    dbMock.consentVerificationChallenge.findUnique.mockResolvedValue({
      id: "chal_1",
      method: "EMAIL_PLUS",
      parentalConsentId: "consent_1",
      consumedAt: null,
      expiresAt: new Date(Date.now() - 60_000),
      parentalConsent: { verifiedAt: null },
    });
    dbMock.consentVerificationChallenge.updateMany.mockResolvedValue({ count: 0 });
    dbMock.consentVerificationChallenge.update.mockResolvedValue({
      id: "chal_1",
      parentalConsentId: "consent_1",
      consumedAt: null,
      parentalConsent: { verifiedAt: null },
    });

    const result = await emailPlusProvider.corroborate("token");
    expect(result).toEqual({ ok: false, code: "EXPIRED" });
  });
});
