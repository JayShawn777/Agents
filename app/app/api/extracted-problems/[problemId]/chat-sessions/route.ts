import "server-only";

import { withAuth } from "@/lib/api/handler";
import { requireExtractedProblem, type ExtractedProblemWithContext } from "@/lib/auth/dal";
import { openChatSessionInputSchema } from "@/lib/schemas/chat";
import { openChatSession, openedSessionResponse, withinSessionOpenCap } from "@/lib/chat/open";

/**
 * Endpoint 35 (plan §3.3) — `POST /api/extracted-problems/[problemId]/chat-sessions`.
 *
 * Opens a session bound to one confirmed problem from the student's own work
 * (AC 1). No model is called: the bounds are stamped from config, the learner
 * context is rendered once and snapshotted (ADR-0012 §2), and the opening
 * message is templated.
 */
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
  // Step 5, two preconditions with different reasons.
  //
  //   a) The extraction must be CONFIRMED. Chat is bound to a problem the
  //      student has actually reviewed and corrected (M1 AC 30) — tutoring a
  //      child on a misread line they never saw is worse than not tutoring
  //      them, and the confirm step is the only thing standing between the two.
  //
  //   b) The profile must have a grade level. `renderLearnerContext` needs one,
  //      and the alternative — defaulting to GRADE_4, as the attempts route
  //      does and as this codebase already flags as a smell — means guessing
  //      the reading level of a child's entire session and stamping the guess
  //      onto a row that is then cached for an hour. Refusing cleanly is
  //      ADR-0009 §4's rule applied here: better refused than done badly.
  requireFlow: ({ resource }) =>
    resource.extraction.status === "CONFIRMED" &&
    resource.extraction.upload.studentProfile.gradeLevel !== null,
  requireFlowMessage: (problem) =>
    problem.extraction.status !== "CONFIRMED"
      ? "Check this worksheet over first — then you can ask about any question on it."
      : "Add a grade level to this profile first, so the tutor can pitch things right.",
  bodySchema: openChatSessionInputSchema,
  rateLimit: ({ resource }) => withinSessionOpenCap(resource.extraction.upload.studentProfileId),
  handler: async ({ resource: problem }) => {
    const profile = problem.extraction.upload.studentProfile;
    const gradeLevel = profile.gradeLevel;
    // Narrowed rather than asserted with `!`: step 5 already rejected a null,
    // and this keeps the guarantee visible to the compiler instead of asking a
    // reader to trust a bang. If the gate is ever removed, this throws — which
    // is a 500 — rather than silently tutoring every child as a fourth-grader.
    if (gradeLevel === null) {
      throw new Error(`extracted problem ${problem.id}: reached the handler with no gradeLevel, which step 5 forbids.`);
    }

    const opened = await openChatSession({
      studentProfileId: profile.id,
      gradeLevel,
      binding: { kind: "EXTRACTED_PROBLEM", extractedProblemId: problem.id },
      problemText: problem.text,
    });
    return openedSessionResponse(opened);
  },
});
