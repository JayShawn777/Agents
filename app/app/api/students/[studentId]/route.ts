import { withAuth } from "@/lib/api/handler";
import { successResponse } from "@/lib/errors";
import { db } from "@/lib/db";
import { requireStudentProfile } from "@/lib/auth/dal";
import { updateStudentInputSchema } from "@/lib/schemas/student";
import { toConsentDTO, toDirectNoticeDTO, toStudentProfileDTO } from "@/lib/students/dto";
import { hashAdultIdentity } from "@/lib/consent/audit";
import { CONSENT_AUDIT_RETENTION_DAYS } from "@/lib/config";

/**
 * Endpoints 3-5 (plan §3.2): `GET`, `PATCH`, `DELETE
 * /api/students/[studentId]`. All three resolve their resource through
 * `requireStudentProfile` (`lib/auth/dal.ts`) — the ONLY function that may
 * load a `StudentProfile` by id — so a cross-account id and a nonexistent
 * one are indistinguishable (AC 32): both are a 404 from `withAuth()`'s
 * step 3, before any of this file's code runs.
 */

async function resolveOwnedStudent({ params }: { params: Record<string, string> }) {
  const studentId = params.studentId;
  if (!studentId) return null;
  return requireStudentProfile(studentId);
}

export const GET = withAuth({
  resolveResource: resolveOwnedStudent,
  handler: async ({ resource: student }) => {
    // AC 15 / ADR-0007 §3: current consent state is derived from the MOST
    // RECENT `ParentalConsent` row for this profile, never from an
    // aggregate — a withdrawal appends rather than mutates.
    const [notice, consent] = await Promise.all([
      db.directNotice.findFirst({
        where: { studentProfileId: student.id },
        orderBy: { presentedAt: "desc" },
      }),
      db.parentalConsent.findFirst({
        where: { studentProfileId: student.id },
        orderBy: { submittedAt: "desc" },
      }),
    ]);

    return successResponse({
      student: toStudentProfileDTO(student, { hasNotice: notice !== null }),
      consent: consent ? toConsentDTO(consent) : null,
      notice: notice ? toDirectNoticeDTO(notice) : null,
    });
  },
});

export const PATCH = withAuth({
  resolveResource: resolveOwnedStudent,
  // AC 11: this consent-state gate runs BEFORE the body is parsed
  // (ADR-0006 step 4, above step 6) — an invalid body against a
  // non-ACTIVE profile is still 403, and nothing is ever persisted for it.
  requireState: (student) => student.status === "ACTIVE",
  bodySchema: updateStudentInputSchema,
  handler: async ({ resource: student, body }) => {
    // `ageBand` is deliberately absent from `updateStudentInputSchema` —
    // it is not patchable (plan §3, endpoint 4).
    const updated = await db.studentProfile.update({
      where: { id: student.id },
      data: {
        ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
        ...(body.gradeLevel !== undefined ? { gradeLevel: body.gradeLevel } : {}),
        ...(body.subjects !== undefined ? { subjects: { set: body.subjects } } : {}),
        ...(body.avatarId !== undefined ? { avatarId: body.avatarId } : {}),
      },
    });

    // `hasNotice` only changes `nextStep`'s NOTICE_PENDING branch
    // (`lib/students/dto.ts`); this handler's `requireState` gate above
    // already guarantees `updated.status === "ACTIVE"`, which cannot be
    // reached without a DirectNotice row existing (AC 15), so `true` is
    // correct here regardless.
    return successResponse({ student: toStudentProfileDTO(updated, { hasNotice: true }) });
  },
});

export const DELETE = withAuth({
  resolveResource: resolveOwnedStudent,
  handler: async ({ resource: student }) => {
    // NOTE (deviation, see report): the full `deleteStudentData()`
    // destructor — blob-first deletion (ADR-0007 §1) — is B13, out of this
    // task's scope. No `Upload` rows can exist yet within that scope
    // (uploads are M1/B15-B18), so there are no blobs to delete ahead of
    // the row cascade here. This IS NOT a full substitute for B13: once
    // uploads exist, this handler must be replaced by a call to
    // `deleteStudentData(student.id, "PROFILE_DELETED")` so blob-first
    // ordering also applies to a profile that has stored objects.
    //
    // What THIS handler already must not skip (ADR-0007 §6, AC 50):
    // `ParentalConsent` cascades from `StudentProfile`, so a bare
    // `studentProfile.delete()` would permanently destroy the only
    // evidence that verifiable parental consent was ever obtained for this
    // child. Every `ParentalConsent` row is read and pseudonymised into a
    // `ConsentAuditArtifact` — no name, no relationship, no IP, no user
    // agent, no foreign key — BEFORE it is destroyed.
    await db.$transaction(async (tx) => {
      const consents = await tx.parentalConsent.findMany({
        where: { studentProfileId: student.id },
      });

      if (consents.length > 0) {
        // The adult's email, not their opaque userId, is what makes the
        // pseudonym meaningful (ADR-0007 §6: "an HMAC-SHA256 of the
        // account owner's identifier") — the same adult consenting again
        // for a different child, or having consented under a different
        // method previously, hashes to the same value. `userId` on each
        // consent row is "the signed-in adult who performed the action"
        // (`prisma/schema.prisma`), which in M0 is always the account
        // owner but is looked up per-row rather than assumed.
        const userIds = Array.from(new Set(consents.map((consent) => consent.userId)));
        const users = await tx.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true },
        });
        const emailByUserId = new Map(users.map((user) => [user.id, user.email]));
        const purgeAfter = new Date(
          Date.now() + CONSENT_AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
        );

        await tx.consentAuditArtifact.createMany({
          data: consents.map((consent) => ({
            consentTextVersion: consent.consentTextVersion,
            noticeVersion: consent.noticeVersion,
            method: consent.method,
            submittedAt: consent.submittedAt,
            verifiedAt: consent.verifiedAt,
            withdrawnAt: consent.withdrawnAt,
            adultIdentityHash: hashAdultIdentity(
              emailByUserId.get(consent.userId) ?? consent.userId,
            ),
            purgeAfter,
          })),
        });

        // Deleted explicitly, ahead of the cascade below, rather than left
        // to `StudentProfile`'s own cascade: `ParentalConsent.directNoticeId`
        // is `onDelete: Restrict` while BOTH `ParentalConsent` and
        // `DirectNotice` cascade from `StudentProfile` — two rows racing to
        // delete from the same parent delete, one of which is a Restrict
        // target of the other. An integration test against the real
        // database (`tests/integration/student-delete-cascade.test.ts`)
        // confirmed Postgres's default IMMEDIATE constraint timing (checked
        // at end-of-statement, not per intermediate row) already makes the
        // bare cascade safe — but deleting the evidence ourselves, in the
        // same statement we just finished reading it for the audit
        // artifact, doesn't depend on that non-obvious guarantee holding
        // forever, and keeps "read the evidence, then destroy it" visible
        // as one intentional step rather than an implicit side effect of
        // `studentProfile.delete()`.
        await tx.parentalConsent.deleteMany({ where: { studentProfileId: student.id } });
      }

      await tx.deletionAudit.create({
        data: {
          kind: "PROFILE_DELETED",
          subjectRef: student.id,
          completedAt: new Date(),
        },
      });

      await tx.studentProfile.delete({ where: { id: student.id } });
    });

    return successResponse({ deleted: true as const });
  },
});
