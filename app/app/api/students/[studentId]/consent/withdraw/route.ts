import { withAuth } from "@/lib/api/handler";
import { apiErr, errorResponse, successResponse } from "@/lib/errors";
import { requireStudentProfile } from "@/lib/auth/dal";
import { withdrawConsentInputSchema } from "@/lib/schemas/consent";
import { withdrawConsent } from "@/lib/consent/service";
import { toStudentProfileDTO } from "@/lib/students/dto";

/**
 * Endpoint 12 (plan §3.2) — `POST /api/students/[studentId]/consent/withdraw`.
 * Owner-only, no `requireState`: "status is not ACTIVE" is a 409 (a flow
 * position, and specifically not the same 403 family as AC 11's "not
 * consented at all" — withdrawing consent you never gave isn't a permission
 * problem, it's the wrong step), decided inside `withdrawConsent` after the
 * body has parsed, matching plan §3 endpoint 12's error column exactly
 * (400 · 401 · 404 · 409 — no 403 listed).
 */

async function resolveOwnedStudent({ params }: { params: Record<string, string> }) {
  const studentId = params.studentId;
  if (!studentId) return null;
  return requireStudentProfile(studentId);
}

export const POST = withAuth({
  resolveResource: resolveOwnedStudent,
  bodySchema: withdrawConsentInputSchema,
  handler: async ({ session, resource: student }) => {
    const result = await withdrawConsent({ student, userId: session!.userId });
    if (!result.ok) {
      return errorResponse(apiErr("CONFLICT"));
    }
    // A CONSENT_WITHDRAWN profile has necessarily already had a DirectNotice
    // (it was ACTIVE, which requires AC 15's precondition).
    return successResponse({ student: toStudentProfileDTO(result.student, { hasNotice: true }) }, { status: 201 });
  },
});
