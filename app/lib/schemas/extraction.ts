/**
 * zod input schemas for the extraction flow (plan §3, endpoints 19-23):
 * `GET /api/extractions/[extractionId]`, `.../retry`, `.../confirm`,
 * `.../problems/[problemId]` (PATCH, DELETE).
 */

import { z } from "zod";

// ─────────────────────────── GET /api/extractions/[extractionId] (#19) ───────────────────────────
// No request body.

// ─────────────────────────── POST .../retry (#20) ───────────────────────────

export const extractionRetryInputSchema = z.object({}).strict();

export type ExtractionRetryInput = z.infer<typeof extractionRetryInputSchema>;

// ─────────────────────────── POST .../confirm (#21) ───────────────────────────

export const extractionConfirmInputSchema = z
  .object({
    confirm: z.literal(true),
  })
  .strict();

export type ExtractionConfirmInput = z.infer<typeof extractionConfirmInputSchema>;

// ─────────────────────────── PATCH .../problems/[problemId] (#22) ───────────────────────────

export const patchExtractedProblemInputSchema = z
  .object({
    text: z.string().trim().min(1).max(2000),
  })
  .strict();

export type PatchExtractedProblemInput = z.infer<typeof patchExtractedProblemInputSchema>;

// ─────────────────────────── DELETE .../problems/[problemId] (#23) ───────────────────────────
// No request body.
