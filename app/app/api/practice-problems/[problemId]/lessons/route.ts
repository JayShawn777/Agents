import "server-only";

import { after } from "next/server";

import { withAuth } from "@/lib/api/handler";
import { successResponse } from "@/lib/errors";
import { requirePracticeProblem, type PracticeProblemWithContext } from "@/lib/auth/dal";
import { requestLessonInputSchema } from "@/lib/schemas/lesson";
import { hasEngagedWithProblem, openLesson, withinLessonCap } from "@/lib/lessons/request";
import { authorLesson } from "@/lib/lessons/author";
import { toLessonDTO } from "@/lib/lessons/dto";

/**
 * Endpoint 41 (plan §3) — `POST /api/practice-problems/[problemId]/lessons`.
 *
 * The twin of endpoint 40, bound to a practice problem. Everything past
 * resolution is identical, which is why both call one `openLesson`.
 *
 * AC 5 is easier to satisfy here and means the same thing: the student has
 * attempted THIS problem, or has already talked to the tutor about it.
 */
export const maxDuration = 300;

async function resolveOwnedProblem({
  params,
}: {
  params: Record<string, string>;
}): Promise<PracticeProblemWithContext | null> {
  const problemId = params.problemId;
  if (!problemId) return null;
  return requirePracticeProblem(problemId);
}

export const POST = withAuth({
  resolveResource: resolveOwnedProblem,
  requireState: (problem) => problem.practiceSet.studentProfile.status === "ACTIVE",
  requireFlow: async ({ resource }) => {
    if (resource.practiceSet.status === "GENERATING" || resource.practiceSet.status === "FAILED") return false;
    if (resource.practiceSet.studentProfile.gradeLevel === null) return false;
    return hasEngagedWithProblem({ kind: "PRACTICE_PROBLEM", practiceProblemId: resource.id });
  },
  requireFlowMessage: (problem) => {
    if (problem.practiceSet.status === "GENERATING" || problem.practiceSet.status === "FAILED") {
      return "This isn't ready yet — give it a moment and refresh.";
    }
    if (problem.practiceSet.studentProfile.gradeLevel === null) {
      return "Add a grade level to this profile first, so the lesson can be pitched right.";
    }
    return "Have a go at this one first — then I can walk you through it.";
  },
  bodySchema: requestLessonInputSchema,
  rateLimit: ({ resource }) => withinLessonCap(resource.practiceSet.studentProfileId),
  handler: async ({ resource: problem }) => {
    const { lesson, version } = await openLesson({
      studentProfileId: problem.practiceSet.studentProfileId,
      binding: { kind: "PRACTICE_PROBLEM", practiceProblemId: problem.id },
    });

    after(() => authorLesson(version.id));

    return successResponse({ lesson: toLessonDTO({ ...lesson, versions: [version] }) }, { status: 202 });
  },
});
