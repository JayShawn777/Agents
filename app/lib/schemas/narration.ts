/**
 * zod input schemas for the M5 narration flow (plan §3, endpoints 46-47).
 */

import { z } from "zod";

// ────────────── POST /api/lessons/[lessonId]/narration (#46) ──────────────

/**
 * No body. `.strict()` still earns its place, matching `requestLessonInputSchema`
 * (`lib/schemas/lesson.ts`) — a caller that invents a field (a persona
 * override, an effort hint) fails at the boundary instead of having it
 * silently ignored. Also serves AC 17's retry: the same route, the same empty
 * body, re-claims a `FAILED` run.
 */
export const requestNarrationInputSchema = z.object({}).strict();

export type RequestNarrationInput = z.infer<typeof requestNarrationInputSchema>;
