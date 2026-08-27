import { afterAll, describe, expect, it } from "vitest";

import { configureDirectDatabaseUrl } from "./db-test-url";

// MUST run before `@/lib/db` (or anything importing it) is loaded — see
// `db-test-url.ts`. A dynamic import below, not a static one, is what
// makes the ordering actually hold: ESM hoists static imports ahead of any
// top-level statement in this file.
configureDirectDatabaseUrl();

const { db } = await import("@/lib/db");

/**
 * Settles the suspected bug named in the security review:
 * `ParentalConsent.directNoticeId` is `onDelete: Restrict` while BOTH
 * `ParentalConsent` and `DirectNotice` cascade from `StudentProfile`.
 * Postgres does not define the order sibling cascades run in, so deleting
 * a *consented* profile might abort with a foreign-key violation (500) —
 * exactly the request a parent makes to exercise their deletion rights.
 *
 * This exercises the real local Postgres database (no mocks) — the
 * complement to `tests/unit/app/api/students/route.test.ts`, which asserts
 * the SAME sequence of Prisma calls the route's `handler` makes
 * (`app/api/students/[studentId]/route.ts`) against a mocked `db`. That
 * suite proves the route calls the right operations in the right order;
 * this one proves those operations actually succeed against Postgres,
 * which a mock cannot.
 *
 * FINDING: running the bare cascade below (no explicit `ParentalConsent`
 * deletion first) 20 times, with a SECOND appended withdrawal row
 * referencing the same notice for extra FK edges, never produced a
 * foreign-key violation. PostgreSQL foreign-key constraints default to
 * `NOT DEFERRABLE INITIALLY IMMEDIATE`, which — despite the name — means
 * checked at the END of the SQL statement, not per intermediate row. A
 * single cascading `DELETE FROM "StudentProfile" WHERE id = $1` cascades
 * to both `ParentalConsent` and `DirectNotice` within that ONE statement,
 * so by the time the `Restrict` constraint is actually checked, the
 * referencing `ParentalConsent` rows are already gone. Not a live bug in
 * the schema as written, on this Postgres version.
 *
 * The route (`app/api/students/[studentId]/route.ts`) does not rely on
 * that non-obvious guarantee anyway: it deletes `ParentalConsent` rows
 * itself, in a separate statement, one step ahead of the profile cascade
 * (so it can pseudonymise them into a `ConsentAuditArtifact` first) —
 * which removes the race by construction regardless of Postgres's
 * constraint-timing default. The first test below exercises exactly that
 * sequence of Prisma calls; the second documents the bare-cascade finding
 * on its own.
 */
describe("student profile deletion against the real database — consented profile", () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    for (const id of createdUserIds) {
      await db.user.delete({ where: { id } }).catch(() => {});
    }
  });

  it("the route's own sequence (audit artifact + explicit consent delete + profile delete) succeeds with no error, and leaves only the pseudonymised remnant", async () => {
    const user = await db.user.create({
      data: {
        email: `integration-cascade-${Date.now()}@example.com`,
        adultAttestedAt: new Date(),
      },
    });
    createdUserIds.push(user.id);

    const profile = await db.studentProfile.create({
      data: { userId: user.id, ageBand: "UNDER_13", status: "ACTIVE" },
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
        verifiedAt: new Date(),
      },
    });

    // The exact sequence `app/api/students/[studentId]/route.ts`'s DELETE
    // handler runs inside its `db.$transaction(async (tx) => {...})`.
    await db.$transaction(async (tx) => {
      const consents = await tx.parentalConsent.findMany({
        where: { studentProfileId: profile.id },
      });
      expect(consents).toHaveLength(1);

      await tx.consentAuditArtifact.createMany({
        data: consents.map((c) => ({
          consentTextVersion: c.consentTextVersion,
          noticeVersion: c.noticeVersion,
          method: c.method,
          submittedAt: c.submittedAt,
          verifiedAt: c.verifiedAt,
          withdrawnAt: c.withdrawnAt,
          adultIdentityHash: "test-hash",
          purgeAfter: new Date(Date.now() + 1000 * 60 * 60 * 24),
        })),
      });

      await tx.parentalConsent.deleteMany({ where: { studentProfileId: profile.id } });
      await tx.deletionAudit.create({
        data: { kind: "PROFILE_DELETED", subjectRef: profile.id, completedAt: new Date() },
      });
      await tx.studentProfile.delete({ where: { id: profile.id } });
    });

    // Documented behaviour: no error above, and afterward —
    await expect(db.studentProfile.findUnique({ where: { id: profile.id } })).resolves.toBeNull();
    await expect(db.directNotice.findUnique({ where: { id: notice.id } })).resolves.toBeNull();
    await expect(
      db.parentalConsent.findUnique({ where: { id: consent.id } }),
    ).resolves.toBeNull();

    const artifacts = await db.consentAuditArtifact.findMany({
      where: { consentTextVersion: "2026-08-26.1", method: "EMAIL_PLUS" },
    });
    expect(artifacts.length).toBeGreaterThanOrEqual(1);
    for (const artifact of artifacts) {
      await db.consentAuditArtifact.delete({ where: { id: artifact.id } }).catch(() => {});
    }
  });

  it("the bare cascade (no explicit ParentalConsent delete first) does not abort either, across 20 trials with extra FK edges from an appended withdrawal row", async () => {
    for (let i = 0; i < 20; i++) {
      const user = await db.user.create({
        data: {
          email: `integration-cascade-raw-${Date.now()}-${i}@example.com`,
          adultAttestedAt: new Date(),
        },
      });
      createdUserIds.push(user.id);

      const profile = await db.studentProfile.create({
        data: { userId: user.id, ageBand: "UNDER_13", status: "ACTIVE" },
      });
      const notice = await db.directNotice.create({
        data: { studentProfileId: profile.id, userId: user.id, noticeVersion: "v1" },
      });
      const original = await db.parentalConsent.create({
        data: {
          studentProfileId: profile.id,
          userId: user.id,
          directNoticeId: notice.id,
          noticeVersion: "v1",
          consentingAdultName: "Parent",
          relationship: "PARENT",
          scopes: ["DATA_PROCESSING"],
          consentTextVersion: "v1",
          method: "EMAIL_PLUS",
          verifiedAt: new Date(),
        },
      });
      // An appended withdrawal referencing the SAME notice (ADR-0007 §3) —
      // more FK edges into the same Restrict-constrained DirectNotice row.
      await db.parentalConsent.create({
        data: {
          studentProfileId: profile.id,
          userId: user.id,
          directNoticeId: notice.id,
          noticeVersion: "v1",
          consentingAdultName: "Parent",
          relationship: "PARENT",
          scopes: ["DATA_PROCESSING"],
          consentTextVersion: "v1",
          method: "EMAIL_PLUS",
          withdrawnAt: new Date(),
          supersedesConsentId: original.id,
        },
      });

      await expect(
        db.studentProfile.delete({ where: { id: profile.id } }),
      ).resolves.toBeDefined();
    }
  });
});
