import { withAuth } from "@/lib/api/handler";
import { apiErr, errorResponse, successResponse } from "@/lib/errors";
import { db } from "@/lib/db";
import { requireStudentProfile } from "@/lib/auth/dal";
import { submitConsentInputSchema } from "@/lib/schemas/consent";
import { submitConsent } from "@/lib/consent/service";
import { toConsentDTO, toStudentProfileDTO } from "@/lib/students/dto";

/**
 * Endpoint 8 (plan §3.2) — `POST /api/students/[studentId]/consent`.
 */

async function resolveOwnedStudent({ params }: { params: Record<string, string> }) {
  const studentId = params.studentId;
  if (!studentId) return null;
  return requireStudentProfile(studentId);
}

export const POST = withAuth({
  resolveResource: resolveOwnedStudent,
  // AC 15: at least one DirectNotice must exist for this profile before the
  // consent endpoint accepts anything, and the profile must not already be
  // ACTIVE — both checked BEFORE the body is parsed (step 5, before step 6),
  // so a direct POST with a garbage body still gets the flow-order 409,
  // never a 400 that would suggest the body shape was the only problem.
  requireFlow: async ({ resource }) => {
    if (resource.status === "ACTIVE") return false;
    const notice = await db.directNotice.findFirst({ where: { studentProfileId: resource.id } });
    return notice !== null;
  },
  requireFlowMessage: "A direct notice must be shown, and consent has not already been given, before this can proceed.",
  bodySchema: submitConsentInputSchema,
  handler: async ({ session, resource: student, body }) => {
    // `session` is never null here — `mode` defaults to "session".
    const user = await db.user.findUniqueOrThrow({
      where: { id: session!.userId },
      select: { id: true, email: true },
    });

    const result = await submitConsent({
      student,
      userId: user.id,
      userEmail: user.email,
      input: body,
    });

    if (!result.ok) {
      // ALREADY_ACTIVE / NOTICE_MISMATCH / STALE_CONSENT_TEXT_VERSION — all
      // the "wrong step of a flow, or a stale version, and another request
      // is the fix" family (ADR-0006).
      return errorResponse(apiErr("CONFLICT"));
    }

    // AC 15 guarantees a DirectNotice row exists by the time submitConsent
    // can succeed (requireFlow above, and submitConsent's own check) — no
    // extra read needed to know `hasNotice: true`.
    return successResponse(
      {
        student: toStudentProfileDTO(result.student, { hasNotice: true }),
        consent: toConsentDTO(result.consent),
      },
      { status: 202 },
    );
  },
});
