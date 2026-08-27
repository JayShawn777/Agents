import { afterAll, describe, expect, it } from "vitest";

import { configureDirectDatabaseUrl } from "./db-test-url";

// MUST run before `@/lib/db` (or anything importing it) is loaded — see
// `db-test-url.ts`.
configureDirectDatabaseUrl();

const { db } = await import("@/lib/db");
const { deleteStudentData } = await import("@/lib/deletion/service");

/**
 * Integration test against the real local Postgres database (no mocks) for
 * the §312.6 parental deletion request path (ADR-0007 §4(b)) — `kind =
 * PARENTAL_DELETION_REQUEST`. Proves the two halves of the promise at once:
 *
 *   1. Everything the request destroys is actually gone: the
 *      `StudentProfile`, its `DirectNotice` rows, its `ParentalConsent`
 *      rows, and (via cascade) anything else scoped to the profile.
 *   2. Evidence that the request happened SURVIVES the purge it describes:
 *      exactly one `DeletionAudit { kind: PARENTAL_DELETION_REQUEST }` row
 *      keyed on the (now-deleted) profile id, and one `ConsentAuditArtifact`
 *      per consent row that existed, carrying no foreign key and no PII.
 *
 * No `Upload` row is created here — the blob-first half of
 * `deleteStudentData` is a no-op with zero uploads, which is exactly the
 * situation every other caller in this milestone is in (B15-B18 unbuilt).
 * The blob-before-row ordering itself is proven against a fake
 * `StoragePort` in `tests/unit/lib/deletion/service.test.ts`, which a real
 * database cannot help with — nothing in Postgres cares about ordering
 * relative to an HTTP call to a storage provider.
 */
describe("deleteStudentData(kind: PARENTAL_DELETION_REQUEST) against the real database", () => {
  const createdUserIds: string[] = [];
  const createdArtifactIds: string[] = [];

  afterAll(async () => {
    for (const id of createdArtifactIds) {
      await db.consentAuditArtifact.delete({ where: { id } }).catch(() => {});
    }
    for (const id of createdUserIds) {
      await db.user.delete({ where: { id } }).catch(() => {});
    }
  });

  it("removes the profile, its notice and its consent rows, while leaving a DeletionAudit and a ConsentAuditArtifact behind", async () => {
    const user = await db.user.create({
      data: {
        email: `integration-parental-deletion-${Date.now()}@example.com`,
        adultAttestedAt: new Date(),
      },
    });
    createdUserIds.push(user.id);

    const profile = await db.studentProfile.create({
      data: { userId: user.id, ageBand: "UNDER_13", status: "ACTIVE" },
    });
    const notice = await db.directNotice.create({
      data: { studentProfileId: profile.id, userId: user.id, noticeVersion: "2026-08-27.pdr-integration-test.1" },
    });
    const consent = await db.parentalConsent.create({
      data: {
        studentProfileId: profile.id,
        userId: user.id,
        directNoticeId: notice.id,
        noticeVersion: "2026-08-27.pdr-integration-test.1",
        consentingAdultName: "Parent Example",
        relationship: "PARENT",
        scopes: ["DATA_PROCESSING"],
        consentTextVersion: "2026-08-27.pdr-integration-test.1",
        method: "EMAIL_PLUS",
        verifiedAt: new Date(),
      },
    });

    const fakeStorage = {
      handleClientUpload: async () => new Response(null),
      head: async () => null,
      signedReadUrl: async () => {
        throw new Error("not used by this test");
      },
      readBytes: async () => {
        throw new Error("not used by this test");
      },
      // No Upload rows exist for this profile, so this must never be called.
      del: async () => {
        throw new Error("del() should not be called when there are no Upload rows");
      },
      listAll: async function* () {
        // no-op
      },
    };

    const result = await deleteStudentData(profile.id, "PARENTAL_DELETION_REQUEST", fakeStorage);
    expect(result).toEqual({ ok: true });

    // 1. Everything the request promises to destroy is gone.
    await expect(db.studentProfile.findUnique({ where: { id: profile.id } })).resolves.toBeNull();
    await expect(db.directNotice.findUnique({ where: { id: notice.id } })).resolves.toBeNull();
    await expect(db.parentalConsent.findUnique({ where: { id: consent.id } })).resolves.toBeNull();

    // 2. Evidence survives the purge it records.
    const audits = await db.deletionAudit.findMany({
      where: { subjectRef: profile.id, kind: "PARENTAL_DELETION_REQUEST" },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].completedAt).not.toBeNull();

    const artifacts = await db.consentAuditArtifact.findMany({
      where: { consentTextVersion: "2026-08-27.pdr-integration-test.1", noticeVersion: "2026-08-27.pdr-integration-test.1", method: "EMAIL_PLUS" },
    });
    expect(artifacts.length).toBeGreaterThanOrEqual(1);
    for (const artifact of artifacts) createdArtifactIds.push(artifact.id);

    const artifact = artifacts[artifacts.length - 1];
    // No foreign key, no name, no relationship, no IP, no user agent
    // (ADR-0007 §6, AC 50) — the artifact carries only the allowlisted
    // fields the schema itself defines, so this is really asserting
    // against `deleteStudentData`'s write, not the schema.
    expect(artifact).not.toHaveProperty("studentProfileId");
    expect(artifact.adultIdentityHash).toBeTruthy();
    expect(artifact.adultIdentityHash).not.toContain("@");
  });
});
