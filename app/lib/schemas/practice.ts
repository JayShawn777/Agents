/**
 * zod input schemas for the M2 practice flow (plan §3.2, endpoints 29-34):
 * `POST .../practice-sets`, `GET`/`.../retry`/`.../complete
 * /api/practice-sets/[practiceSetId]`, `.../attempts`/`.../reveal
 * /api/practice-problems/[problemId]`.
 */

import { z } from "zod";

import { ATTEMPT_MAX_ELAPSED_MS, PRACTICE_ANSWER_MAX_LENGTH } from "@/lib/config";

// ─────────────────────────── POST .../practice-sets (#29) ───────────────────────────

export const createPracticeSetInputSchema = z.object({}).strict();

export type CreatePracticeSetInput = z.infer<typeof createPracticeSetInputSchema>;

// ─────────────────────────── GET /api/practice-sets/[practiceSetId] (#30) ───────────────────────────
// No request body.

// ─────────────────────────── POST .../retry (#31) ───────────────────────────

export const practiceSetRetryInputSchema = z.object({}).strict();

export type PracticeSetRetryInput = z.infer<typeof practiceSetRetryInputSchema>;

// ─────────────────────────── POST .../complete (#34) ───────────────────────────

export const completePracticeSetInputSchema = z.object({}).strict();

export type CompletePracticeSetInput = z.infer<typeof completePracticeSetInputSchema>;

// ─────────────────────────── POST /api/practice-problems/[problemId]/attempts (#32) ───────────────────────────

/**
 * M2 AC 15: `.trim().min(1)` means an empty or whitespace-only submission
 * fails validation before a handler ever runs, so `withAuth()`'s step 6
 * (body parse, ADR-0006) itself is what guarantees "no attempt row is
 * created" for that case — the route never gets far enough to write one.
 * M2 AC 16: `.max(PRACTICE_ANSWER_MAX_LENGTH)` bounds an over-length body to
 * a 400, also before any row is written.
 */
export const submitAttemptInputSchema = z
  .object({
    answer: z.string().trim().min(1).max(PRACTICE_ANSWER_MAX_LENGTH),
    elapsedMs: z.number().int().min(0).max(ATTEMPT_MAX_ELAPSED_MS).optional(),
  })
  .strict();

export type SubmitAttemptInput = z.infer<typeof submitAttemptInputSchema>;

// ─────────────────────────── POST .../reveal (#33) ───────────────────────────

export const revealPracticeProblemInputSchema = z.object({}).strict();

export type RevealPracticeProblemInput = z.infer<typeof revealPracticeProblemInputSchema>;

// ─────────────────────────── M2.5: checkpoints ───────────────────────────

/**
 * `POST /api/students/[studentId]/checkpoints`. No body — which skills a
 * checkpoint asks about is composed server-side from the student's own mastery
 * history (`lib/checkpoints/compose.ts`), never chosen by the client. `.strict()`
 * so a client that starts sending one finds out immediately.
 */
export const createCheckpointInputSchema = z.object({}).strict();

export type CreateCheckpointInput = z.infer<typeof createCheckpointInputSchema>;
