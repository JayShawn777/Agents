import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/config";
import { isInClosureRecoveryWindow } from "@/lib/auth/closure";
import { db } from "@/lib/db";
import type { Extraction, ExtractedProblem, StudentProfile, Upload } from "@/lib/generated/prisma/client";

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
export const requireExtraction = cache(async (extractionId: string): Promise<ExtractionWithProblems | null> => {
  const session = await verifySession();
  if (!session) return null;
  return db.extraction.findFirst({
    where: { id: extractionId, upload: { studentProfile: { userId: session.userId } } },
    include: { upload: true, problems: { orderBy: { ordinal: "asc" } } },
  });
});
