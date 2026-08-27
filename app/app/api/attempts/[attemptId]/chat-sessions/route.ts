import "server-only";

import { withAuth } from "@/lib/api/handler";
import { requireAttempt, type AttemptWithContext } from "@/lib/auth/dal";
import { openChatSessionInputSchema } from "@/lib/schemas/chat";
import { openChatSession, openedSessionResponse, withinSessionOpenCap } from "@/lib/chat/open";

/**
 * Endpoint 36 (plan §3.3) — `POST /api/attempts/[attemptId]/chat-sessions`.
 *
 * The twin of endpoint 35, bound to an attempt instead of an extracted problem
 * — M2 AC 10's join point, and the user story this milestone exists for: the
 * student got it wrong and wants to ask why, instead of just seeing a red
 * cross. Everything past resolution is identical, which is why both routes call
 * the same `openChatSession`.
 */
async function resolveOwnedAttempt({
  params,
}: {
  params: Record<string, string>;
}): Promise<AttemptWithContext | null> {
  const attemptId = params.attemptId;
  if (!attemptId) return null;
  return requireAttempt(attemptId);
}

export const POST = withAuth({
  resolveResource: resolveOwnedAttempt,
  requireState: (attempt) => attempt.studentProfile.status === "ACTIVE",
  // Step 5, the same two preconditions as endpoint 35 with the first one
  // translated: an attempt's equivalent of "the extraction is CONFIRMED" is
  // that its set actually finished generating. A set still GENERATING or FAILED
  // has problems that may not exist or may be about to be deleted, and binding
  // a session to one is binding it to something that can vanish underneath it.
  requireFlow: ({ resource }) =>
    resource.practiceProblem.practiceSet.status !== "GENERATING" &&
    resource.practiceProblem.practiceSet.status !== "FAILED" &&
    resource.studentProfile.gradeLevel !== null,
  requireFlowMessage: (attempt) =>
    attempt.practiceProblem.practiceSet.status === "GENERATING" ||
    attempt.practiceProblem.practiceSet.status === "FAILED"
      ? "This isn't ready yet — give it a moment and refresh."
      : "Add a grade level to this profile first, so the tutor can pitch things right.",
  bodySchema: openChatSessionInputSchema,
  rateLimit: ({ resource }) => withinSessionOpenCap(resource.studentProfileId),
  handler: async ({ resource: attempt }) => {
    const gradeLevel = attempt.studentProfile.gradeLevel;
    // Narrowed rather than asserted: step 5 already rejected a null, and this
    // keeps the guarantee visible to the compiler instead of asking a reader to
    // trust a `!`.
    if (gradeLevel === null) {
      throw new Error(`attempt ${attempt.id}: reached the handler with no gradeLevel, which step 5 forbids.`);
    }

    const opened = await openChatSession({
      studentProfileId: attempt.studentProfileId,
      gradeLevel,
      binding: { kind: "ATTEMPT", attemptId: attempt.id },
      // The PRACTICE problem's text, not the attempt's answer. The session is
      // about the question the child got wrong, and their wrong answer is
      // already in the transcript of their own head.
      problemText: attempt.practiceProblem.text,
    });
    return openedSessionResponse(opened);
  },
});
