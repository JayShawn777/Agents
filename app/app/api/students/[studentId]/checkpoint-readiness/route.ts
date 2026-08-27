import "server-only";

import { withAuth } from "@/lib/api/handler";
import { successResponse } from "@/lib/errors";
import { requireStudentProfile } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { composeCheckpoint } from "@/lib/checkpoints/compose";
import type { StudentProfile } from "@/lib/generated/prisma/client";

async function resolveOwnedProfile({ params }: { params: Record<string, string> }): Promise<StudentProfile | null> {
  const studentId = params.studentId;
  if (!studentId) return null;
  return requireStudentProfile(studentId);
}

/**
 * `GET /api/students/[studentId]/checkpoint-readiness` — spec AC 4, and the
 * ONLY scheduling signal M2.5 ships. Deciding *when* a checkpoint should
 * happen is M7's spaced repetition; this answers only "could one happen now".
 *
 * A GET, so no `requireState`: reads of your own data are not consent-gated,
 * which is the convention four of the five other GET routes already follow.
 * The create route (`../checkpoints`) carries the ACTIVE gate, because that is
 * the one that spends money and processes a child's data.
 *
 * `reason` is a stable machine-readable code, never prose — the client owns
 * the wording, the same rule `GENERATION_FAILURE_CODES` follows (M2 AC 6).
 */
export const GET = withAuth({
  resolveResource: resolveOwnedProfile,
  handler: async ({ resource: profile }) => {
    const candidates = await db.skillMastery.findMany({
      where: { studentProfileId: profile.id },
      select: { skillCode: true, attemptCount: true, lastPracticedAt: true },
    });

    const composition = composeCheckpoint(candidates);
    if (composition.ok) {
      return successResponse({ available: true, reason: null });
    }
    return successResponse({
      available: false,
      reason: composition.reason,
      distinctSkills: composition.distinctSkills,
      required: composition.required,
    });
  },
});
