import { withAuth } from "@/lib/api/handler";
import { apiErr, errorResponse, successResponse } from "@/lib/errors";
import { requireStudentProfile } from "@/lib/auth/dal";
import { dataDeletionInputSchema } from "@/lib/schemas/student";
import { deleteStudentData } from "@/lib/deletion/service";
import { getStoragePort } from "@/lib/storage/get-storage";

/**
 * Endpoint 6 (plan §3.2) — `POST /api/students/[studentId]/data-deletion`.
 *
 * The §312.6 parental deletion request (ADR-0007 §4(b)). This is a
 * SEPARATE route from `DELETE /api/students/[studentId]` (endpoint 5) for
 * exactly one reason beyond confirmation copy: `DeletionAudit.kind` is the
 * only evidence that a §312.6 request was made and honoured promptly.
 * Collapsing the two into one route with a `reason` field would put that
 * evidence in the hands of whatever the client claimed.
 *
 * Immediate, `kind = PARENTAL_DELETION_REQUEST`. No recovery period, no
 * queue, and it is NEVER routed through account closure — this handler
 * never reads or writes `User.closureRequestedAt` (AC 48, AC 49). The
 * request that confirms this deletion IS the deletion.
 */

async function resolveOwnedStudent({ params }: { params: Record<string, string> }) {
  const studentId = params.studentId;
  if (!studentId) return null;
  return requireStudentProfile(studentId);
}

export const POST = withAuth({
  resolveResource: resolveOwnedStudent,
  bodySchema: dataDeletionInputSchema,
  handler: async ({ resource: student }) => {
    const result = await deleteStudentData(student.id, "PARENTAL_DELETION_REQUEST", getStoragePort());
    if (!result.ok) {
      // ADR-0007 §1: rows are retained (Upload rows marked SOURCE_DELETED,
      // nothing else touched) and the request is retryable — this is a
      // dangling reference, not a silent partial success.
      return errorResponse(apiErr("UPSTREAM_ERROR"));
    }

    return successResponse({ deleted: true as const });
  },
});
