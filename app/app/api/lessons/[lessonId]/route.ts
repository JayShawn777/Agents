import "server-only";

import { withAuth } from "@/lib/api/handler";
import { successResponse } from "@/lib/errors";
import { requireLesson, type LessonWithVersions } from "@/lib/auth/dal";
import { reapIfStale } from "@/lib/lessons/author";
import { toLessonDetail } from "@/lib/lessons/dto";

/**
 * Endpoint 42 (plan §3) — `GET /api/lessons/[lessonId]`.
 *
 * The poll target for AC 6's `PENDING → AUTHORING → READY | FAILED`, and the
 * read the player loads from.
 *
 * **Auth is Owner, not Owner+ACTIVE**, matching endpoint 38's chat transcript
 * read and for the same reason: an account owner who has withdrawn consent must
 * still be able to see what was made for their child. Withdrawal stops new data
 * being created — and it does, because every route that WRITES here carries the
 * ACTIVE gate.
 *
 * The lazy reap is what makes AC 6's "the client is never left holding an open
 * request" true without a cron job: an `AUTHORING` row whose function was
 * killed before its own `catch` would otherwise be polled forever.
 */
async function resolveOwnedLesson({
  params,
}: {
  params: Record<string, string>;
}): Promise<LessonWithVersions | null> {
  const lessonId = params.lessonId;
  if (!lessonId) return null;
  return requireLesson(lessonId);
}

export const GET = withAuth({
  resolveResource: resolveOwnedLesson,
  handler: async ({ resource }) => {
    // Only for an ACTIVE profile. `reapIfStale` WRITES, and this is a read path
    // a parent reaches after withdrawing consent — the same rule endpoint 38
    // follows. The retention job is already coming for those rows.
    const lesson =
      resource.studentProfile.status === "ACTIVE" ? await reapIfStale(resource) : resource;

    // The reap changes the LESSON's status; the version rows it also updated are
    // not in the snapshot, so the current version is re-read only when the reap
    // actually fired. A poller that never sees a reap pays nothing.
    const current = resource.versions.find((version) => version.id === resource.currentVersionId) ?? null;
    const reaped = lesson.status !== resource.status;

    return successResponse(
      toLessonDetail(
        { ...resource, status: lesson.status },
        reaped && current ? { ...current, status: "FAILED" } : current,
      ),
    );
  },
});
