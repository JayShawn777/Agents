import "server-only";

import { withAuth } from "@/lib/api/handler";
import { apiErr, errorResponse, successResponse } from "@/lib/errors";
import { requireLesson, type LessonWithVersions } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { flagLessonInputSchema } from "@/lib/schemas/lesson";
import { toLessonFlagDTO } from "@/lib/lessons/dto";
import { withinFlagCap } from "@/lib/lessons/request";

/**
 * Endpoint 45 (plan §3) — `POST /api/lessons/[lessonId]/flags`.
 *
 * AC 18: a student marks a lesson as confusing or wrong, optionally naming the
 * step. **This is the only mechanism by which a lesson that teaches the wrong
 * thing is ever caught**, outside the fixture set — the spec says so plainly
 * and accepts it. There is no review queue.
 *
 * `reason` is a four-value enum rather than free text, which is a COPPA
 * decision: a free-text box on a child-facing surface is a new unbounded
 * personal-data channel with a retention row and a §312.4 notice line behind
 * it.
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

export const POST = withAuth({
  resolveResource: resolveOwnedLesson,
  requireState: (lesson) => lesson.studentProfile.status === "ACTIVE",
  bodySchema: flagLessonInputSchema,
  // Step 7. This route had no rate limit at all — the only M4 mutation without
  // one — and `LessonFlag` has no unique constraint, so a loop could insert
  // unbounded rows on a child's account.
  rateLimit: ({ resource }) => withinFlagCap(resource.studentProfileId),
  handler: async ({ resource: lesson, body }) => {
    // `versionId` arrives in the BODY, so unlike a path param nothing upstream
    // has scoped it. Resolving it against the already-owned lesson is what stops
    // a caller attaching a flag to a version of somebody else's lesson.
    const version = lesson.versions.find((candidate) => candidate.id === body.versionId);
    if (!version) {
      return errorResponse(apiErr("NOT_FOUND"));
    }

    // A flag pointing at step 99 of a six-step lesson is not actionable, and the
    // step count is only knowable here — zod cannot see the version the body
    // names. Bounded against the version that was actually on screen.
    if (body.stepIndex !== null && (version.stepCount === null || body.stepIndex >= version.stepCount)) {
      return errorResponse(apiErr("VALIDATION_ERROR", { fieldErrors: { stepIndex: ["That step isn't part of this lesson."] } }));
    }

    const flag = await db.lessonFlag.create({
      data: {
        lessonId: lesson.id,
        versionId: version.id,
        stepIndex: body.stepIndex,
        reason: body.reason,
      },
    });

    return successResponse({ flag: toLessonFlagDTO(flag) }, { status: 201 });
  },
});
