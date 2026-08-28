import "server-only";

import { withAuth } from "@/lib/api/handler";
import { successResponse } from "@/lib/errors";
import { requireLesson } from "@/lib/auth/dal";
import type { LessonScriptVersion } from "@/lib/generated/prisma/client";
import { toLessonVersionDTO } from "@/lib/lessons/dto";

/**
 * Endpoint 44 (plan §3) — `GET /api/lessons/[lessonId]/versions/[versionId]`.
 *
 * AC 19's other half. "The previous version remains playable" needs the
 * previous version to have an address of its own; endpoint 42 only ever serves
 * the current one.
 *
 * **The version is found WITHIN the already-owner-scoped lesson**, never by its
 * own id, and it is resolved at step 3 rather than checked at step 5. That is
 * deliberate: a `versionId` that exists but hangs off a different lesson must
 * be a **404**, indistinguishable from one that does not exist at all (AC 20).
 * Checking it as a flow precondition would have made it a 409, which tells a
 * caller the id is real.
 */
async function resolveOwnedVersion({
  params,
}: {
  params: Record<string, string>;
}): Promise<LessonScriptVersion | null> {
  const { lessonId, versionId } = params;
  if (!lessonId || !versionId) return null;

  const lesson = await requireLesson(lessonId);
  if (!lesson) return null;

  return lesson.versions.find((version) => version.id === versionId) ?? null;
}

export const GET = withAuth({
  resolveResource: resolveOwnedVersion,
  handler: async ({ resource }) => successResponse(toLessonVersionDTO(resource)),
});
