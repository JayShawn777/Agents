/**
 * zod input schemas for the M4 lesson flow (plan §3, endpoints 40-45).
 */

import { z } from "zod";

import { LessonFlagReason } from "@/lib/domain/enums";

// ────────────── POST .../lessons (#40, #41) and .../versions (#43) ──────────────

/**
 * All three take no body. `.strict()` still earns its place: a caller that
 * invents a field — an effort level, a step count, a "make it simpler" hint —
 * fails at the boundary instead of having it silently ignored.
 */
export const requestLessonInputSchema = z.object({}).strict();

export type RequestLessonInput = z.infer<typeof requestLessonInputSchema>;

// ────────────── POST /api/lessons/[lessonId]/flags (#45) ──────────────

/**
 * M4 AC 18.
 *
 * `reason` is an ENUM, not free text, and that is a COPPA decision rather than
 * a UI convenience: a free-text box on a child-facing surface is a new
 * unbounded personal-data channel, with a retention row and a §312.4 notice
 * line behind it. Four fixed reasons carry the signal the criterion asks for.
 *
 * `versionId` is required so a flag names the authoring run that was actually
 * on screen — a regeneration must not inherit the flag that caused it.
 *
 * `stepIndex` is nullable because AC 18 says "with the step index IF ONE WAS
 * SELECTED": a child may flag the whole lesson without choosing a moment, and
 * forcing them to pick one would make the easiest signal the hardest to give.
 */
export const flagLessonInputSchema = z
  .object({
    versionId: z.cuid(),
    stepIndex: z.number().int().min(0).nullable(),
    reason: z.enum(LessonFlagReason),
  })
  .strict();

export type FlagLessonInput = z.infer<typeof flagLessonInputSchema>;
