import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/config";
import { isInClosureRecoveryWindow } from "@/lib/auth/closure";
import { db } from "@/lib/db";
import type {
  Attempt,
  Extraction,
  ExtractedProblem,
  PracticeAnswerKey,
  PracticeProblem,
  PracticeSet,
  StudentProfile,
  Upload,
} from "@/lib/generated/prisma/client";

/**
 * The Data Access Layer (Next.js's own recommended pattern — see
 * `node_modules/next/dist/docs/01-app/02-guides/authentication.md`,
 * "Creating a Data Access Layer"). This file is the ONLY place session
 * state is read and the ONLY way to load a student profile in server code
 * (plan §0: "a student profile id in a URL is not authorization"). Every
 * lookup below is scoped by `userId` — there is no other path to a
 * profile.
 *
 * `verifySession`, `requireStudentProfile` and `requireActiveStudentProfile`
 * return `null` on failure rather than redirecting or throwing, so the SAME
 * functions serve both callers: `lib/api/handler.ts` turns a `null` into a
 * typed 401/404/403 JSON response, and a page (frontend track) can turn it
 * into whatever redirect fits that page's place in the flow. Only
 * `requireUser` redirects, matching AC 1 ("a signed-out visitor requesting
 * /dashboard is redirected to /sign-in") and the Next.js DAL example this
 * mirrors — it exists for pages, not for route handlers.
 *
 * All four functions are wrapped in React's `cache()` so repeated calls
 * within one render pass (or one route-handler invocation) hit the
 * database at most once per distinct argument.
 */

export type SessionInfo = { userId: string };

/**
 * The session, or `null` if the caller has no valid session. Never
 * redirects.
 *
 * Also refuses a session belonging to an account inside its closure
 * recovery window (AC 47 / ADR-0007 §4). `lib/auth/config.ts`'s `signIn`
 * callback already refuses REDEMPTION of a new magic link for a closed
 * account, but the database session strategy means a `Session` row (and
 * its cookie) issued before closure was requested keeps resolving to a
 * valid session on every subsequent request — closure must also be
 * checked HERE, on every read, not just at the moment a new link is
 * opened. `toPublicSession()` deliberately strips `closureRequestedAt`
 * from `auth()`'s return value (it must never reach the client), so this
 * function queries it directly rather than reading it off `session.user`.
 */
export const verifySession = cache(async (): Promise<SessionInfo | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { closureRequestedAt: true },
  });
  if (!user || isInClosureRecoveryWindow(user.closureRequestedAt)) return null;

  return { userId };
});

/**
 * For server components / pages ONLY. Redirects to `/sign-in` if there is
 * no session (AC 1). Route handlers must use `verifySession()` directly and
 * build their own typed 401 (`lib/api/handler.ts`) — a route handler must
 * never call `redirect()` in place of a JSON error response.
 */
export async function requireUser(): Promise<SessionInfo> {
  const session = await verifySession();
  if (!session) redirect("/sign-in");
  return session;
}

/**
 * Resolves a student profile scoped to the CALLING user. Cross-account
 * access and a nonexistent id are indistinguishable — both return `null` —
 * which is exactly the 404 that AC 32 and M1 AC 33 demand
 * (`db.studentProfile.findFirst({ where: { id, userId } })`, ADR-0002,
 * ADR-0006). This is the only function anywhere in the app that may load a
 * `StudentProfile` row by id.
 */
export const requireStudentProfile = cache(
  async (studentProfileId: string): Promise<StudentProfile | null> => {
    const session = await verifySession();
    if (!session) return null;
    return db.studentProfile.findFirst({
      where: { id: studentProfileId, userId: session.userId },
    });
  },
);

/**
 * `requireStudentProfile` plus the consent-state gate (`status === "ACTIVE"`).
 * Returns `null` for both "not found/not owned" and "found but not active" —
 * callers that must distinguish 404 from 403 (route handlers, via
 * `lib/api/handler.ts`) call `requireStudentProfile` directly instead and
 * check `.status` themselves. This helper exists for the common case (a
 * page or handler that only cares "may I act on this profile right now?").
 */
export const requireActiveStudentProfile = cache(
  async (studentProfileId: string): Promise<StudentProfile | null> => {
    const profile = await requireStudentProfile(studentProfileId);
    if (!profile || profile.status !== "ACTIVE") return null;
    return profile;
  },
);

/** An `Upload` row plus its `Extraction` sibling's status and problem count — the shape M1's routes need without a second query. */
export type UploadWithExtraction = Upload & {
  extraction: (Extraction & { _count: { problems: number } }) | null;
};

/**
 * Resolves an upload scoped to the CALLING user via the
 * `Upload -> StudentProfile.userId` join — the same "id in a URL is not
 * authorization" rule (plan §0) applied to uploads. Cross-account and
 * nonexistent ids are indistinguishable (both `null`), which is exactly the
 * 404 M1 AC 33 demands. Used by endpoints 16-18
 * (`app/api/uploads/[uploadId]/**`).
 */
export const requireUpload = cache(async (uploadId: string): Promise<UploadWithExtraction | null> => {
  const session = await verifySession();
  if (!session) return null;
  return db.upload.findFirst({
    where: { id: uploadId, studentProfile: { userId: session.userId } },
    include: { extraction: { include: { _count: { select: { problems: true } } } } },
  });
});

/** An `Extraction` row plus its parent `Upload` and its `ExtractedProblem` rows, ordered by `ordinal` (never renumbered, ADR-0005). */
export type ExtractionWithProblems = Extraction & { upload: Upload; problems: ExtractedProblem[] };

/**
 * Resolves an extraction scoped to the CALLING user via the
 * `Extraction -> Upload -> StudentProfile.userId` join. Used by endpoints
 * 19-23 (`app/api/extractions/**`); a cross-account or nonexistent
 * `extractionId` is a 404 (M1 AC 33), never a 403 that would confirm the id
 * exists.
 */
export type ExtractionWithStudentProfile = Extraction & { upload: Upload & { studentProfile: StudentProfile } };

/**
 * `requireExtraction`, extended (S19 / plan §5.0): `upload` now carries its
 * `studentProfile` too, so M2 endpoint 29 (`POST
 * .../extractions/[extractionId]/practice-sets`) can run its Owner+ACTIVE
 * gate (`requireState`, ADR-0006 step 4) off the SAME resolved resource,
 * without a second query. Every existing caller (M1's confirm/retry/problem
 * routes) already loads `upload` and is unaffected by the extra nested field.
 */
export const requireExtraction = cache(
  async (extractionId: string): Promise<(ExtractionWithProblems & ExtractionWithStudentProfile) | null> => {
    const session = await verifySession();
    if (!session) return null;
    return db.extraction.findFirst({
      where: { id: extractionId, upload: { studentProfile: { userId: session.userId } } },
      include: { upload: { include: { studentProfile: true } }, problems: { orderBy: { ordinal: "asc" } } },
    });
  },
);

// ─────────────────────── M2: practice and mastery ───────────────────────

/**
 * A `PracticeSet` plus its ordered `PracticeProblem` rows, each with its
 * `Attempt` history and — the ONE place outside `lib/grading/**` this DAL
 * selects anything off `PracticeAnswerKey` — its `workedSolution` ONLY
 * (`select`, never `include`). `canonicalAnswer` and `acceptedForms` are
 * structurally impossible to obtain through this function: Prisma never
 * fetches a column that isn't named in a `select`, so the secret half of the
 * answer key cannot reach this row's memory at all, let alone a DTO
 * (ADR-0011 §5, M2 AC 17). `workedSolution` itself is still gated on
 * `revealed` by `lib/practice/dto.ts`'s `toPracticeProblemDTO` — see that
 * function's docstring for why this DAL can't withhold it structurally the
 * same way and what closes the gap instead.
 */
export type PracticeSetWithProblems = PracticeSet & {
  /** Just enough of the owning profile for the Owner+ACTIVE gate (endpoint 34's `requireState`) without a second query. */
  studentProfile: Pick<StudentProfile, "status">;
  problems: (PracticeProblem & {
    attempts: Attempt[];
    answerKey: Pick<PracticeAnswerKey, "workedSolution"> | null;
  })[];
};

/**
 * Resolves a practice set scoped to the CALLING user via the
 * `PracticeSet -> StudentProfile.userId` join — the same "id in a URL is not
 * authorization" rule (plan §0) applied to practice. Cross-account and
 * nonexistent ids are indistinguishable (both `null`), which is exactly the
 * 404 M2 AC 24 demands. Used by endpoint 30 and the practice-set page
 * (`app/(app)/practice/[practiceSetId]/page.tsx`).
 */
export const requirePracticeSet = cache(
  async (practiceSetId: string): Promise<PracticeSetWithProblems | null> => {
    const session = await verifySession();
    if (!session) return null;
    return db.practiceSet.findFirst({
      where: { id: practiceSetId, studentProfile: { userId: session.userId } },
      include: {
        studentProfile: { select: { status: true } },
        problems: {
          orderBy: { ordinal: "asc" },
          include: {
            attempts: { orderBy: { attemptNumber: "asc" } },
            answerKey: { select: { workedSolution: true } },
          },
        },
      },
    });
  },
);

/** A `PracticeProblem` plus its parent `PracticeSet` (with just enough of the owning profile for the Owner+ACTIVE gate) and its own `Attempt` history, ordered by `attemptNumber`. Deliberately WITHOUT `answerKey` — see `lib/grading/grade.ts`'s docstring for the one place that may load it (ADR-0011 §5, M2 AC 17). */
export type PracticeProblemWithContext = PracticeProblem & {
  practiceSet: PracticeSet & { studentProfile: Pick<StudentProfile, "status" | "gradeLevel"> };
  attempts: Attempt[];
};

/**
 * Resolves a practice problem scoped to the CALLING user via the
 * `PracticeProblem -> PracticeSet -> StudentProfile.userId` join. Used by
 * endpoints 32/33 (`app/api/practice-problems/[problemId]/**`). Cross-account
 * and nonexistent ids are both a 404 (M2 AC 24).
 */
export const requirePracticeProblem = cache(
  async (practiceProblemId: string): Promise<PracticeProblemWithContext | null> => {
    const session = await verifySession();
    if (!session) return null;
    return db.practiceProblem.findFirst({
      where: { id: practiceProblemId, practiceSet: { studentProfile: { userId: session.userId } } },
      include: {
        practiceSet: { include: { studentProfile: { select: { status: true, gradeLevel: true } } } },
        attempts: { orderBy: { attemptNumber: "asc" } },
      },
    });
  },
);

/**
 * The ONE function that may load a `PracticeAnswerKey` row (ADR-0011 §5,
 * M2 AC 17) — a reviewer grep for `practiceAnswerKey.findUnique` /
 * `include: { answerKey`, same control as ADR-0007's `parentalConsent.update`
 * convention. By convention only two call sites use it, both AFTER
 * independently re-verifying ownership via `requirePracticeProblem` above:
 * `lib/grading/grade.ts` and the reveal handler
 * (`app/api/practice-problems/[problemId]/reveal/route.ts`). This helper
 * takes an already-owned `practiceProblemId` rather than a session — it is a
 * second, narrower query on a resource ownership has already established,
 * not a second authorization path.
 */
export async function requirePracticeAnswerKey(practiceProblemId: string): Promise<PracticeAnswerKey | null> {
  return db.practiceAnswerKey.findUnique({ where: { practiceProblemId } });
}
