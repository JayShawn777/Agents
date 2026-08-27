import { withAuth } from "@/lib/api/handler";
import { apiErr, errorResponse, successResponse } from "@/lib/errors";
import { db } from "@/lib/db";
import { requireStudentProfile } from "@/lib/auth/dal";
import { submitNoticeInputSchema } from "@/lib/schemas/notice";
import { submitNotice } from "@/lib/notice/service";
import { toDirectNoticeDTO } from "@/lib/students/dto";

/**
 * Endpoint 7 (plan §3.2) — `POST /api/students/[studentId]/notice`. Owner
 * only (no consent-state gate: a `DirectNotice` may be (re-)presented at any
 * point in `NOTICE_PENDING`, and repeat calls append rather than error —
 * AC 12-14).
 */

async function resolveOwnedStudent({ params }: { params: Record<string, string> }) {
  const studentId = params.studentId;
  if (!studentId) return null;
  return requireStudentProfile(studentId);
}

export const POST = withAuth({
  resolveResource: resolveOwnedStudent,
  bodySchema: submitNoticeInputSchema,
  handler: async ({ session, resource: student, body }) => {
    // `session` is never null here — `mode` defaults to "session".
    const user = await db.user.findUniqueOrThrow({
      where: { id: session!.userId },
      select: { id: true, email: true },
    });

    const result = await submitNotice({
      student,
      user,
      noticeVersion: body.noticeVersion,
    });

    if (!result.ok) {
      // result.code === "STALE_VERSION"
      return errorResponse(apiErr("CONFLICT"));
    }

    if (!result.notice.sentAt) {
      // AC 14 / plan §3 endpoint 7: the record is still written with
      // `sentAt: null` (retried later by `GET /api/cron/retry-notice-emails`,
      // out of this task's scope) — but the mail provider genuinely rejected
      // dispatch, so the contract's 502 is the honest response.
      return errorResponse(apiErr("UPSTREAM_ERROR"));
    }

    return successResponse({ notice: toDirectNoticeDTO(result.notice) }, { status: 201 });
  },
});
