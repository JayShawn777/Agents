import "server-only";

import { after } from "next/server";

import { withAuth } from "@/lib/api/handler";
import { successResponse } from "@/lib/errors";
import { requireExtraction, type ExtractionWithStudentProfile } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { createPracticeSetInputSchema } from "@/lib/schemas/practice";
import { toPracticeSetDTO } from "@/lib/practice/dto";
import { runPracticeGeneration } from "@/lib/practice/generate";
import { PRACTICE_PROMPT_VERSION } from "@/lib/practice/prompt";
import { TAXONOMY_VERSION } from "@/lib/taxonomy";
import { PRACTICE_EFFORT, PRACTICE_MODEL, PRACTICE_SETS_PER_HOUR } from "@/lib/config";

/** Generation runs past this response via `after()`, same reason as M1's confirm/retry routes. */
export const maxDuration = 300;

async function resolveOwnedExtraction({
  params,
}: {
  params: Record<string, string>;
}): Promise<ExtractionWithStudentProfile | null> {
  const extractionId = params.extractionId;
  if (!extractionId) return null;
  return requireExtraction(extractionId);
}

/**
 * Endpoint 29 (plan §3.2) — `POST /api/extractions/[extractionId]/practice-sets`.
 *
 * `extractionId` is a PATH segment, not a body field, deliberately: step 4
 * (the Owner+ACTIVE gate) and step 5 (the CONFIRMED flow check) both need
 * the resource resolved BEFORE the body is parsed (ADR-0006's ordering), and
 * a body-carried id could not be resolved in time to make AC 3's 409 a
 * `requireFlow` rather than a check that has to move into the handler.
 *
 * The `PracticeSet` row is written BEFORE the AI call — that write IS the
 * AC 26 rate-limit grant (a failed generation still counts, the same reason
 * `UploadTokenGrant` exists, M1 AC 17), and generation itself is scheduled
 * with `after()` so this response returns immediately with `202`.
 */
export const POST = withAuth({
  resolveResource: resolveOwnedExtraction,
  // Step 4: Owner+ACTIVE, evaluated BEFORE the body is parsed (ADR-0006).
  requireState: (extraction) => extraction.upload.studentProfile.status === "ACTIVE",
  // Step 5: AC 3 — practice is generated only from a CONFIRMED extraction.
  requireFlow: ({ resource }) => resource.status === "CONFIRMED",
  requireFlowMessage: "This worksheet hasn't been confirmed yet.",
  bodySchema: createPracticeSetInputSchema,
  // Step 7: AC 26 — the hourly cap, counting EVERY PracticeSet row created
  // in the window, including FAILED ones (the row is the grant).
  rateLimit: async ({ resource }) => {
    const windowStart = new Date(Date.now() - 60 * 60 * 1000);
    const count = await db.practiceSet.count({
      where: { studentProfileId: resource.upload.studentProfileId, createdAt: { gte: windowStart } },
    });
    return count < PRACTICE_SETS_PER_HOUR;
  },
  handler: async ({ resource: extraction }) => {
    const set = await db.practiceSet.create({
      data: {
        studentProfileId: extraction.upload.studentProfileId,
        extractionId: extraction.id,
        status: "GENERATING",
        model: PRACTICE_MODEL,
        effort: PRACTICE_EFFORT,
        promptVersion: PRACTICE_PROMPT_VERSION,
        taxonomyVersion: TAXONOMY_VERSION,
      },
    });

    after(() => {
      runPracticeGeneration(set.id).catch((err: unknown) => {
        console.error(`Scheduled runPracticeGeneration(${set.id}) failed`, err);
      });
    });

    return successResponse({ set: toPracticeSetDTO({ ...set, problems: [] }) }, { status: 202 });
  },
});
