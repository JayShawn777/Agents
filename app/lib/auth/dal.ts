import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import type { StudentProfile } from "@/lib/generated/prisma/client";

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

/** The session, or `null` if the caller has no valid session. Never redirects. */
export const verifySession = cache(async (): Promise<SessionInfo | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
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
