import "server-only";

import { after } from "next/server";

import { withAuth } from "@/lib/api/handler";
import { successResponse } from "@/lib/errors";
import { requireLesson, type LessonWithVersions } from "@/lib/auth/dal";
import { requestLessonInputSchema } from "@/lib/schemas/lesson";
import { atVersionCap, openNextVersion, withinAuthoringCap } from "@/lib/lessons/request";
import { authorLesson } from "@/lib/lessons/author";
import { toLessonDTO } from "@/lib/lessons/dto";

/**
 * Endpoint 43 (plan §3) — `POST /api/lessons/[lessonId]/versions`.
 *
 * AC 19: "the student asks for a different explanation". A NEW version row at
 * `version + 1`, and **the previous version stays playable throughout** —
 * `currentVersionId` is only repointed by `authorLesson` once the new run
 * succeeds, so a regeneration that fails leaves the child with the lesson they
 * already had rather than with nothing.
 */
export const maxDuration = 300;

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
  // Step 5, two preconditions.
  //
  //   a) Nothing may already be in flight. Two concurrent authoring runs on one
  //      lesson would race to repoint `currentVersionId`, and the child would
  //      get whichever finished last rather than whichever they asked for.
  //   b) `MAX_LESSON_VERSIONS`. AC 19 has no ceiling as written, and this is the
  //      most expensive loop a child can drive with one button.
  requireFlow: ({ resource }) => {
    const inFlight = resource.versions.some(
      (version) => version.status === "PENDING" || version.status === "AUTHORING",
    );
    return !inFlight && !atVersionCap(resource.versions.length);
  },
  requireFlowMessage: (lesson) => {
    const inFlight = lesson.versions.some(
      (version) => version.status === "PENDING" || version.status === "AUTHORING",
    );
    return inFlight
      ? "A new explanation is already on its way — give it a moment."
      : "We've tried a few different explanations for this one. Ask the tutor about it instead.";
  },
  bodySchema: requestLessonInputSchema,
  rateLimit: ({ resource }) => withinAuthoringCap(resource.studentProfileId),
  handler: async ({ resource: lesson }) => {
    const version = await openNextVersion(lesson.id);

    after(() => authorLesson(version.id));

    return successResponse(
      {
        lesson: toLessonDTO({
          ...lesson,
          status: "PENDING",
          versions: [...lesson.versions, version],
        }),
      },
      { status: 202 },
    );
  },
});
