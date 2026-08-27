import { afterAll, describe, expect, it, vi } from "vitest";

import { configureDirectDatabaseUrl } from "./db-test-url";

// MUST run before `@/lib/db` (or anything importing it, including
// `@/lib/consent/service`) is loaded — see `db-test-url.ts`.
configureDirectDatabaseUrl();

// `lib/consent/service.ts` reads the request IP/user-agent via
// `next/headers`, which throws "called outside a request scope" unless it
// is actually invoked from within Next's App Router request lifecycle —
// true for the real route handlers, not for a plain Vitest call. Mocked
// here the same way `tests/unit/lib/consent/service.test.ts` mocks it; this
// suite is about the DATABASE behaviour (append-only, the one stamp), not
// about header propagation.
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9", "user-agent": "integration-test-agent" }),
}));

const { db } = await import("@/lib/db");
const { withdrawConsent, verifyConsent } = await import("@/lib/consent/service");
const { hashConsentToken } = await import("@/lib/consent/token");

/**
 * Complements `tests/unit/lib/consent/service.test.ts` (mocked `db`, proves
 * the CALL SEQUENCE) and `tests/unit/lib/consent/append-only-guard.test.ts`
 * (static grep, proves no OTHER file contains the call) with the one thing
 * neither can: that against a REAL row in REAL Postgres, withdrawing consent
 * truly leaves the prior row's on-disk bytes untouched (AC 24), and that
 * corroborating a challenge truly performs the conditional `verified_at IS
 * NULL` stamp exactly once even when the same token is redeemed twice
 * (AC 19's idempotent-replay case).
 */
describe("ParentalConsent append-only guarantee against the real database", () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    for (const id of createdUserIds) {
      await db.user.delete({ where: { id } }).catch(() => {});
    }
  });

  it("withdrawConsent appends a new row and leaves the prior row byte-identical (AC 24)", async () => {
    const user = await db.user.create({
      data: { email: `integration-withdraw-${Date.now()}@example.com`, adultAttestedAt: new Date() },
    });
    createdUserIds.push(user.id);

    const profile = await db.studentProfile.create({
      data: { userId: user.id, ageBand: "UNDER_13", status: "ACTIVE" },
    });
    const notice = await db.directNotice.create({
      data: { studentProfileId: profile.id, userId: user.id, noticeVersion: "2026-08-26.1" },
    });
    const original = await db.parentalConsent.create({
      data: {
        studentProfileId: profile.id,
        userId: user.id,
        directNoticeId: notice.id,
        noticeVersion: "2026-08-26.1",
        consentingAdultName: "Parent Example",
        relationship: "PARENT",
        scopes: ["DATA_PROCESSING"],
        consentTextVersion: "2026-08-26.1",
        method: "EMAIL_PLUS",
        verifiedAt: new Date("2026-01-01T00:00:00.000Z"),
        ipAddress: "203.0.113.9",
        userAgent: "integration-test-agent",
      },
    });

    // Snapshot every field BEFORE withdrawal — the assertion below is a
    // field-by-field comparison against this snapshot, not a re-derived
    // expectation, so a future change to `withdrawConsent` that mutates
    // ANY field of the prior row (not just `verifiedAt`) fails this test.
    const beforeSnapshot = await db.parentalConsent.findUniqueOrThrow({ where: { id: original.id } });

    const result = await withdrawConsent({
      student: { id: profile.id, status: "ACTIVE" } as never,
      userId: user.id,
    });
    expect(result.ok).toBe(true);

    const afterSnapshot = await db.parentalConsent.findUniqueOrThrow({ where: { id: original.id } });
    expect(afterSnapshot).toEqual(beforeSnapshot);

    // And the new row was genuinely appended, superseding the original.
    const rows = await db.parentalConsent.findMany({
      where: { studentProfileId: profile.id },
      orderBy: { submittedAt: "asc" },
    });
    expect(rows).toHaveLength(2);
    const withdrawal = rows[1];
    expect(withdrawal.supersedesConsentId).toBe(original.id);
    expect(withdrawal.withdrawnAt).not.toBeNull();
    expect(withdrawal.verifiedAt).toBeNull();
    expect(withdrawal.method).toBe(original.method);
    expect(withdrawal.scopes).toEqual(original.scopes);

    const updatedProfile = await db.studentProfile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(updatedProfile.status).toBe("CONSENT_WITHDRAWN");
  });

  it("verifyConsent's stamp is the ONLY mutation ParentalConsent ever receives, is idempotent on replay, and strictly postdates submittedAt (AC 19)", async () => {
    const user = await db.user.create({
      data: { email: `integration-verify-${Date.now()}@example.com`, adultAttestedAt: new Date() },
    });
    createdUserIds.push(user.id);

    const profile = await db.studentProfile.create({
      data: { userId: user.id, ageBand: "UNDER_13", status: "NOTICE_PENDING" },
    });
    const notice = await db.directNotice.create({
      data: { studentProfileId: profile.id, userId: user.id, noticeVersion: "2026-08-26.1" },
    });
    const consent = await db.parentalConsent.create({
      data: {
        studentProfileId: profile.id,
        userId: user.id,
        directNoticeId: notice.id,
        noticeVersion: "2026-08-26.1",
        consentingAdultName: "Parent Example",
        relationship: "PARENT",
        scopes: ["DATA_PROCESSING"],
        consentTextVersion: "2026-08-26.1",
        method: "EMAIL_PLUS",
      },
    });

    const rawToken = "integration-test-token-0123456789";
    await db.consentVerificationChallenge.create({
      data: {
        parentalConsentId: consent.id,
        method: "EMAIL_PLUS",
        tokenHash: hashConsentToken(rawToken),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });

    const first = await verifyConsent(rawToken);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("unreachable");
    expect(first.student.status).toBe("ACTIVE");

    const stamped = await db.parentalConsent.findUniqueOrThrow({ where: { id: consent.id } });
    expect(stamped.verifiedAt).not.toBeNull();
    expect(stamped.verifiedAt!.getTime()).toBeGreaterThan(stamped.submittedAt.getTime());
    expect(stamped.methodEvidence).not.toBeNull();

    // Replay: same token, already consumed. Idempotent — no error, no
    // second stamp (the timestamp must not move).
    const second = await verifyConsent(rawToken);
    expect(second.ok).toBe(true);

    const restamped = await db.parentalConsent.findUniqueOrThrow({ where: { id: consent.id } });
    expect(restamped.verifiedAt!.getTime()).toBe(stamped.verifiedAt!.getTime());
  });
});
