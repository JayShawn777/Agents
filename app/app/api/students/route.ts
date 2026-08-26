import { withAuth } from "@/lib/api/handler";
import { successResponse } from "@/lib/errors";
import { db } from "@/lib/db";
import { createStudentInputSchema } from "@/lib/schemas/student";
import { toStudentProfileDTO } from "@/lib/students/dto";

/**
 * Endpoint 2 (plan §3.2) — `POST /api/students`. Session-only: there is no
 * path resource to resolve (steps 3-5 of ADR-0006 don't apply here), so
 * this is the simplest shape `withAuth()` supports: session -> origin ->
 * body.
 *
 * `createStudentInputSchema` is `.strict()` with exactly one key,
 * `ageBand` — a body carrying a child's name, grade, subjects or avatar at
 * the age gate is a 400, not a silently-stripped success (AC 8, AC 9). That
 * is the legal rule ("nothing about a child is collected before consent is
 * verified") expressed as validation, not as application logic here.
 */
export const POST = withAuth({
  bodySchema: createStudentInputSchema,
  handler: async ({ session, body }) => {
    // `session` is never null here — `mode` defaults to "session", so
    // withAuth() already returned 401 before this handler could run.
    const userId = session!.userId;

    const isAdult = body.ageBand === "ADULT";

    // AC 10: the adult-learner band activates immediately, with no notice
    // and no consent row. AC 9: every other band starts `NOTICE_PENDING`
    // with every other profile field left at its schema default (null /
    // empty) — nothing here sets them.
    const profile = await db.studentProfile.create({
      data: {
        userId,
        ageBand: body.ageBand,
        ...(isAdult ? { status: "ACTIVE", activatedAt: new Date() } : {}),
      },
    });

    return successResponse({ student: toStudentProfileDTO(profile) }, { status: 201 });
  },
});
