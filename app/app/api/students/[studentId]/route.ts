import { withAuth } from "@/lib/api/handler";
import { successResponse } from "@/lib/errors";
import { db } from "@/lib/db";
import { requireStudentProfile } from "@/lib/auth/dal";
import { updateStudentInputSchema } from "@/lib/schemas/student";
import { toConsentDTO, toDirectNoticeDTO, toStudentProfileDTO } from "@/lib/students/dto";

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

    return successResponse({ student: toStudentProfileDTO(updated) });
  },
});

export const DELETE = withAuth({
  resolveResource: resolveOwnedStudent,
  handler: async ({ resource: student }) => {
    // NOTE (deviation, see report): the full `deleteStudentData()`
    // destructor — blob-first deletion, `DeletionAudit`, pseudonymised
    // `ConsentAuditArtifact` writes (ADR-0007 §1/§4/§6) — is B13, out of
    // this task's scope (B1-B8 explicitly excludes "deletion"). No Upload
    // rows can exist yet within that scope (uploads are M1/B15-B18), so
    // there are no blobs to delete ahead of the row cascade here. This IS
    // NOT a substitute for B13: it must be replaced by a call to
    // `deleteStudentData(student.id, "PROFILE_DELETED")` once that service
    // exists, so that AC 46/AC 50 (blob cleanup, pseudonymised consent
    // audit) are actually satisfied for a profile that DOES have uploads
    // and/or verified consent records.
    await db.$transaction([
      db.deletionAudit.create({
        data: {
          kind: "PROFILE_DELETED",
          subjectRef: student.id,
          completedAt: new Date(),
        },
      }),
      db.studentProfile.delete({ where: { id: student.id } }),
    ]);

    return successResponse({ deleted: true as const });
  },
});
