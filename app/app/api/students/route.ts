import { withAuth } from "@/lib/api/handler";
import { successResponse } from "@/lib/errors";
import { db } from "@/lib/db";
import { createStudentInputSchema } from "@/lib/schemas/student";
import { toStudentProfileDTO } from "@/lib/students/dto";
import { MAX_STUDENT_PROFILES_PER_USER, STUDENT_PROFILE_CREATES_PER_HOUR } from "@/lib/config";

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
 *
 * **The cap (2026-09-02 security review).** This route had none. Profile
 * creation is the multiplier under every other cap in the app — narration runs
 * and the daily character budget, the lesson authoring cap, the flag cap are all
 * scoped per `studentProfileId` — so "unlimited profiles" meant "unlimited" of
 * each of those, paid vendor calls included. Two bounds, both per account: a
 * standing ceiling (`MAX_STUDENT_PROFILES_PER_USER`) and a rolling hourly rate
 * (`STUDENT_PROFILE_CREATES_PER_HOUR`) so the ceiling cannot be reached in a
 * burst. Deleted profiles free the ceiling but not the hour, which is the
 * conservative direction.
 */
export const POST = withAuth({
  bodySchema: createStudentInputSchema,
  rateLimit: async ({ session }) => {
    const userId = session!.userId;
    const total = await db.studentProfile.count({ where: { userId } });
    if (total >= MAX_STUDENT_PROFILES_PER_USER) return false;

    const recent = await db.studentProfile.count({
      where: { userId, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
    });
    return recent < STUDENT_PROFILE_CREATES_PER_HOUR;
  },
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

    // A freshly created profile can never already have a DirectNotice row —
    // `hasNotice: false` is correct by construction here, not a default.
    return successResponse(
      { student: toStudentProfileDTO(profile, { hasNotice: false }) },
      { status: 201 },
    );
  },
});
