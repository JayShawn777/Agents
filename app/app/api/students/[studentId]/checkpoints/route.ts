import "server-only";

import { after } from "next/server";

import { withAuth } from "@/lib/api/handler";
import { errorResponse, apiErr, successResponse } from "@/lib/errors";
import { requireStudentProfile } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { createCheckpointInputSchema } from "@/lib/schemas/practice";
import { toPracticeSetDTO } from "@/lib/practice/dto";
import { composeCheckpoint } from "@/lib/checkpoints/compose";
import { runCheckpointGeneration } from "@/lib/checkpoints/generate";
import { CHECKPOINT_PROMPT_VERSION } from "@/lib/checkpoints/prompt";
import { TAXONOMY_VERSION } from "@/lib/taxonomy";
import { CHECKPOINTS_PER_DAY, PRACTICE_EFFORT, PRACTICE_MODEL } from "@/lib/config";
import type { StudentProfile } from "@/lib/generated/prisma/client";

/** Generation runs past this response via `after()`, same as practice generation. */
export const maxDuration = 300;

async function resolveOwnedProfile({ params }: { params: Record<string, string> }): Promise<StudentProfile | null> {
  const studentId = params.studentId;
  if (!studentId) return null;
  return requireStudentProfile(studentId);
}

/**
 * `POST /api/students/[studentId]/checkpoints` — spec AC 1, AC 5, AC 6.
 *
 * The `PracticeSet` row is written BEFORE the AI call, so that row IS the rate
 * limit grant: a failed generation still counts, exactly as it does for
 * practice (M2 AC 26) and for `UploadTokenGrant` before that.
 *
 * `kind: "CHECKPOINT"` with no `extractionId` — the pairing the migration's
 * CHECK constraint enforces (ADR-0017). If either half of that were ever wrong,
 * this insert fails loudly at the database rather than storing a set that lies
 * about where it came from.
 *
 * AC 5's concurrency requirement is met by the same window count that enforces
 * AC 6: two simultaneous requests both see the count, and the second is
 * refused by `CHECKPOINTS_PER_DAY` as soon as the first row exists. A daily cap
 * of 2 makes a genuine double-create harmless rather than impossible, which is
 * the right trade for a student-initiated action.
 */
export const POST = withAuth({
  resolveResource: resolveOwnedProfile,
  // Step 4: this one spends money and processes a child's data, so it carries
  // the consent gate the readiness GET does not.
  requireState: (profile) => profile.status === "ACTIVE",
  bodySchema: createCheckpointInputSchema,
  // Step 7: AC 6 — a checkpoint is an event, not a drill, so this is per DAY.
  rateLimit: async ({ resource: profile }) => {
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const count = await db.practiceSet.count({
      where: { studentProfileId: profile.id, kind: "CHECKPOINT", createdAt: { gte: windowStart } },
    });
    return count < CHECKPOINTS_PER_DAY;
  },
  handler: async ({ resource: profile }) => {
    // AC 1. Refused BEFORE a row is written and before any AI call — a
    // student with too little history has nothing to be checked across, and
    // that is a normal answer rather than a failed set.
    const candidates = await db.skillMastery.findMany({
      where: { studentProfileId: profile.id },
      select: { skillCode: true, attemptCount: true, lastPracticedAt: true },
    });
    const composition = composeCheckpoint(candidates);
    if (!composition.ok) {
      return errorResponse(
        apiErr("CONFLICT", {
          message: "There isn't enough practice yet to check. Do a bit more first and come back.",
        }),
      );
    }

    const set = await db.practiceSet.create({
      data: {
        studentProfileId: profile.id,
        kind: "CHECKPOINT",
        extractionId: null,
        status: "GENERATING",
        model: PRACTICE_MODEL,
        effort: PRACTICE_EFFORT,
        promptVersion: CHECKPOINT_PROMPT_VERSION,
        taxonomyVersion: TAXONOMY_VERSION,
      },
    });

    after(() => {
      runCheckpointGeneration(set.id).catch((err: unknown) => {
        console.error(`Scheduled runCheckpointGeneration(${set.id}) failed`, err);
      });
    });

    return successResponse({ set: toPracticeSetDTO({ ...set, problems: [] }) }, { status: 202 });
  },
});
