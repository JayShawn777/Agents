/**
 * zod input schemas for `/api/students` and `/api/students/[studentId]`
 * (plan §3, endpoints 2, 4, 5, 6). One file per resource (S7) — no route
 * defines its own schema.
 *
 * This module imports only `zod`, `lib/domain/enums` and `lib/config`. It
 * MUST NOT import `@/lib/db` (Prisma access is server-only, plan §"Yours").
 */

import { z } from "zod";
import { AgeBand, AVATAR_IDS, GradeLevel, Subject } from "@/lib/domain/enums";

// ─────────────────────────── POST /api/students (#2) ───────────────────────────

/**
 * `.strict()` is load-bearing (AC 8, AC 9): a body carrying `displayName`,
 * `gradeLevel`, `subjects` or `avatarId` alongside `ageBand` must be a 400,
 * not a silently-stripped success. Nothing about a child may be collected
 * before consent is verified.
 */
export const createStudentInputSchema = z
  .object({
    ageBand: z.enum(AgeBand),
  })
  .strict();

export type CreateStudentInput = z.infer<typeof createStudentInputSchema>;

// ─────────────────────────── PATCH /api/students/[studentId] (#4) ───────────────────────────

function isUniqueArray<T>(values: readonly T[]): boolean {
  return new Set(values).size === values.length;
}

/**
 * All keys optional, `.strict()`, at least one key present. `ageBand` is
 * deliberately absent from this shape — it is not patchable (plan §3, #4).
 * Route-level authorization (Owner+ACTIVE) and the "403 before parsing"
 * ordering live in `withAuth()` (ADR-0006), not here.
 */
export const updateStudentInputSchema = z
  .object({
    displayName: z.string().trim().min(1).max(40).optional(),
    gradeLevel: z.enum(GradeLevel).optional(),
    subjects: z
      .array(z.enum(Subject))
      .min(1)
      .max(8)
      .refine(isUniqueArray, { message: "Subjects must not contain duplicates." })
      .optional(),
    avatarId: z.enum(AVATAR_IDS).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided.",
  });

export type UpdateStudentInput = z.infer<typeof updateStudentInputSchema>;

// ─────────────────────────── DELETE /api/students/[studentId] (#5) ───────────────────────────
// No request body.

// ─────────────────────────── POST /api/students/[studentId]/data-deletion (#6) ───────────────────────────

/** §312.6 parental deletion request — immediate, no recovery window (AC 48, AC 49). */
export const dataDeletionInputSchema = z
  .object({
    confirm: z.literal(true),
    acknowledgeIrreversible: z.literal(true),
  })
  .strict();

export type DataDeletionInput = z.infer<typeof dataDeletionInputSchema>;
