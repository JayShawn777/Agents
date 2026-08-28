import "server-only";

import { after } from "next/server";

import { withAuth } from "@/lib/api/handler";
import { apiErr, errorResponse, successResponse } from "@/lib/errors";
import { requireExtractedProblem, type ExtractedProblemWithContext } from "@/lib/auth/dal";
import { requestLessonInputSchema } from "@/lib/schemas/lesson";
import { hasEngagedWithProblem, isAuthoringCapRejection, openLesson, withinAuthoringCap } from "@/lib/lessons/request";
import { authorLesson } from "@/lib/lessons/author";
import { toLessonDTO } from "@/lib/lessons/dto";

/**
 * Endpoint 40 (plan §3) — `POST /api/extracted-problems/[problemId]/lessons`.
 *
 * Returns `202 PENDING` and schedules the authoring with `after()`. That shape
 * is not a hedge: authoring was measured at 12-59 seconds
 * (`docs/research/m4-authoring-measurement.md`), so a child cannot be made to
 * hold the request open, and at 59s it would be racing a platform timeout.
 *
 * `maxDuration` covers the BACKGROUND work, not the response — `after()` runs
 * for the route's configured budget, which is what makes a queue unnecessary.
 */
export const maxDuration = 300;

async function resolveOwnedProblem({
  params,
}: {
  params: Record<string, string>;
}): Promise<ExtractedProblemWithContext | null> {
  const problemId = params.problemId;
  if (!problemId) return null;
  return requireExtractedProblem(problemId);
}

export const POST = withAuth({
  resolveResource: resolveOwnedProblem,
  requireState: (problem) => problem.extraction.upload.studentProfile.status === "ACTIVE",
  // Step 5, three preconditions in priority order. They share a gate, so the
  // message function below must stay in the same order or a student is told the
  // wrong reason.
  //
  //   a) CONFIRMED — a lesson explains a problem the student has reviewed.
  //   b) AC 5 — they must have actually engaged with it. Without this, "explain
  //      this to me" sits on every problem the moment a worksheet is uploaded,
  //      which is a do-my-homework machine with extra steps.
  //   c) A grade level, because `authorLesson` refuses to guess one rather than
  //      pitch a lesson at the wrong reading level.
  requireFlow: async ({ resource }) => {
    if (resource.extraction.status !== "CONFIRMED") return false;
    if (resource.extraction.upload.studentProfile.gradeLevel === null) return false;
    return hasEngagedWithProblem({ kind: "EXTRACTED_PROBLEM", extractedProblemId: resource.id });
  },
  requireFlowMessage: (problem) => {
    if (problem.extraction.status !== "CONFIRMED") {
      return "Check this worksheet over first — then you can ask for a lesson on any question.";
    }
    if (problem.extraction.upload.studentProfile.gradeLevel === null) {
      return "Add a grade level to this profile first, so the lesson can be pitched right.";
    }
    return "Have a go at this one first — then I can walk you through it.";
  },
  bodySchema: requestLessonInputSchema,
  // AC 22, last. Counted over authoring RUNS rather than lessons, so a
  // regeneration cannot slip past it — see `withinAuthoringCap`.
  rateLimit: ({ resource }) => withinAuthoringCap(resource.extraction.upload.studentProfileId),
  handler: async ({ resource: problem }) => {
    // The `rateLimit` hook above is the cheap rejection; `openLesson` re-counts
    // inside its own serializable transaction, which is the authoritative one.
    // A hit there means concurrent requests raced past the step-7 count, and
    // the honest answer is the same 429 step 7 would have given.
    let lesson, version;
    try {
      ({ lesson, version } = await openLesson({
        studentProfileId: problem.extraction.upload.studentProfileId,
        binding: { kind: "EXTRACTED_PROBLEM", extractedProblemId: problem.id },
      }));
    } catch (err) {
      if (isAuthoringCapRejection(err)) return errorResponse(apiErr("RATE_LIMITED"));
      throw err;
    }

    // Scheduled AFTER the rows exist, so a poll started immediately always
    // finds something to poll.
    after(() => authorLesson(version.id));

    return successResponse({ lesson: toLessonDTO({ ...lesson, versions: [version] }) }, { status: 202 });
  },
});
