import { withAuth } from "@/lib/api/handler";
import { apiErr, errorResponse, successResponse } from "@/lib/errors";
import { db } from "@/lib/db";
import { requireStudentProfile } from "@/lib/auth/dal";
import { updateStudentInputSchema } from "@/lib/schemas/student";
import { toConsentDTO, toDirectNoticeDTO, toStudentProfileDTO } from "@/lib/students/dto";
import { deleteStudentData } from "@/lib/deletion/service";
import { getStoragePort } from "@/lib/storage/get-storage";

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
    // M5 AC 3/4 (plan §3 row 4†). `personaId` must resolve to an existing,
    // NON-RETIRED persona before anything is written — a retired persona is
    // no longer offered by the picker, so choosing one now is a stale
    // request. This is deliberately NOT the same rule the DISPLAY side
    // follows (`findPersonaById`, `lib/personas/dal.ts`): a profile that
    // chose a persona BEFORE it was retired keeps narrating in that voice
    // and keeps showing its label (AC 3's own fallback is a
    // generation-time concern, not a write-time one) — only a NEW selection
    // of an already-retired persona is refused here.
    //
    // This check cannot live in `requireFlow` (ADR-0006 step 5): it needs
    // `body`, which step 5 runs before parsing (step 6). It runs here,
    // after the body has been validated, and is why this 409 is returned
    // from the handler rather than from a `withAuth` gate.
    if (body.personaId !== undefined) {
      const chosen = await db.persona.findFirst({ where: { id: body.personaId, retiredAt: null } });
      if (!chosen) {
        return errorResponse(
          apiErr("CONFLICT", { message: "That voice isn't available anymore. Please choose another." }),
        );
      }
    }

    // `ageBand` is deliberately absent from `updateStudentInputSchema` —
    // it is not patchable (plan §3, endpoint 4).
    const updated = await db.studentProfile.update({
      where: { id: student.id },
      data: {
        ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
        ...(body.gradeLevel !== undefined ? { gradeLevel: body.gradeLevel } : {}),
        ...(body.subjects !== undefined ? { subjects: { set: body.subjects } } : {}),
        ...(body.avatarId !== undefined ? { avatarId: body.avatarId } : {}),
        ...(body.personaId !== undefined ? { personaId: body.personaId } : {}),
        ...(body.captionsEnabled !== undefined ? { captionsEnabled: body.captionsEnabled } : {}),
      },
    });

    // M5 AC 19's "spoken by" label, resolved regardless of whether THIS
    // PATCH touched `personaId` — a caller that only changed `displayName`
    // still gets an accurate `persona` on the response. Retired-or-not,
    // matching `findPersonaById`'s display rule above.
    const persona = updated.personaId
      ? await db.persona.findUnique({
          where: { id: updated.personaId },
          select: { id: true, slug: true, label: true },
        })
      : null;

    // `hasNotice` only changes `nextStep`'s NOTICE_PENDING branch
    // (`lib/students/dto.ts`); this handler's `requireState` gate above
    // already guarantees `updated.status === "ACTIVE"`, which cannot be
    // reached without a DirectNotice row existing (AC 15), so `true` is
    // correct here regardless.
    return successResponse({ student: toStudentProfileDTO(updated, { hasNotice: true, persona }) });
  },
});

export const DELETE = withAuth({
  resolveResource: resolveOwnedStudent,
  handler: async ({ resource: student }) => {
    // ADR-0007 §4(a): identical destruction to endpoint 6, `kind =
    // PROFILE_DELETED` — blobs first, then rows (§1), pseudonymising
    // consent into a `ConsentAuditArtifact` before the rows it describes
    // are destroyed (§6). `deleteStudentData` is the one function that
    // performs this for every deletion path (B13).
    const result = await deleteStudentData(student.id, "PROFILE_DELETED", getStoragePort());
    if (!result.ok) {
      // Rows are retained (Upload rows marked SOURCE_DELETED, nothing else
      // touched) and the operation is retryable — ADR-0007 §1.
      return errorResponse(apiErr("UPSTREAM_ERROR"));
    }

    return successResponse({ deleted: true as const });
  },
});
