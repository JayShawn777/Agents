"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";

import { auth, signIn, signOut } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/auth/normalize-email";
import {
  MAGIC_LINK_TTL_SECONDS,
  SIGN_IN_RATE_LIMIT_WINDOW_MINUTES,
  SIGN_IN_RATE_LIMIT_MAX_PER_EMAIL,
  SIGN_IN_RATE_LIMIT_MAX_PER_IP,
  SIGN_IN_ATTESTATION_COOLDOWN_SECONDS,
} from "@/lib/config";
import { signInWithEmailInputSchema, signOutSessionInputSchema } from "@/lib/schemas/auth";
import { apiOk, apiErrResult, toFieldErrors, type ApiResult } from "@/lib/errors";

/**
 * The two server actions ADR-0006 permits (everything else is a route
 * handler): Auth.js's `signIn()`/`signOut()` must be invoked from server
 * code, so these two exist as the documented exception.
 */

/**
 * AC 2: identical response for a known and an unknown address — this
 * function never branches on whether the account already exists. That
 * includes being rate-limited: a flooded address or IP gets the SAME
 * `{ sent: true }` response as a normal request, with no dispatch and no
 * new `AdultAttestation` row, so a caller flooding this endpoint cannot
 * distinguish "throttled" from "sent" and tune around it.
 *
 * AC 6: the 18+ attestation is enforced HERE, by zod, before anything else
 * runs. The `AdultAttestation` row is written BEFORE `signIn()` is called —
 * without it, `lib/auth/config.ts`'s `signIn` callback refuses the
 * resulting link at redemption, so no `User` row can ever be created for a
 * dispatch that skipped this gate (ADR-0002).
 *
 * This is a PUBLIC, unauthenticated action — the only way to write an
 * `AdultAttestation` row and to trigger a real email dispatch — so it is
 * rate limited by BOTH the normalised email and the request IP (a Postgres
 * `count()` over a rolling window, `lib/config.ts`; no Redis) before
 * anything is written or sent. Without this, anyone can plant
 * `AdultAttestation` rows claiming a victim affirmed 18+ and use this
 * endpoint as an email-bombing primitive against that address from a
 * verified sending domain.
 */
export async function signInWithEmail(input: unknown): Promise<ApiResult<{ sent: true }>> {
  const parsed = signInWithEmailInputSchema.safeParse(input);
  if (!parsed.success) {
    return apiErrResult("VALIDATION_ERROR", toFieldErrors(parsed.error));
  }

  const email = normalizeEmail(parsed.data.email);

  // Read server-side, never from the body (matches the pattern used for
  // ParentalConsent.ipAddress/userAgent elsewhere in the plan).
  const headerList = await headers();
  const ipAddress = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = headerList.get("user-agent");

  const rateLimitWindowStart = new Date(
    Date.now() - SIGN_IN_RATE_LIMIT_WINDOW_MINUTES * 60_000,
  );
  const [emailAttempts, ipAttempts] = await Promise.all([
    db.adultAttestation.count({
      where: { email, attestedAt: { gt: rateLimitWindowStart } },
    }),
    ipAddress
      ? db.adultAttestation.count({
          where: { ipAddress, attestedAt: { gt: rateLimitWindowStart } },
        })
      : Promise.resolve(0),
  ]);

  if (
    emailAttempts >= SIGN_IN_RATE_LIMIT_MAX_PER_EMAIL ||
    ipAttempts >= SIGN_IN_RATE_LIMIT_MAX_PER_IP
  ) {
    // See the AC 2 note above: identical shape, no dispatch, no new row.
    return apiOk({ sent: true });
  }

  // Upsert-with-cooldown, not a blind create: a rapid double-submit
  // (double click, a retried fetch) for the SAME email+IP within the
  // cooldown window reuses the existing live attestation instead of
  // writing another one. `AdultAttestation` has no unique key Prisma's own
  // `upsert()` can target, so this is the manual equivalent.
  const cooldownStart = new Date(Date.now() - SIGN_IN_ATTESTATION_COOLDOWN_SECONDS * 1000);
  const recentAttestation = await db.adultAttestation.findFirst({
    where: { email, ipAddress, attestedAt: { gt: cooldownStart } },
    orderBy: { attestedAt: "desc" },
  });

  if (!recentAttestation) {
    await db.adultAttestation.create({
      data: {
        email,
        expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_SECONDS * 1000),
        ipAddress,
        userAgent,
      },
    });
  }

  try {
    await signIn("email", { email, redirect: false });
  } catch (err) {
    if (err instanceof AuthError) {
      // AC 2: an `AuthError` here (e.g. the provider rejects dispatch) must
      // look identical to success to the caller — never leak provider or
      // account-existence detail.
      return apiOk({ sent: true });
    }
    throw err;
  }

  // The attestation was written and the provider accepted dispatch.
  // `redirect()` never returns; the `ApiResult` return type exists so this
  // action's failure path still fits the one shape every action and route
  // handler uses (ADR-0006).
  redirect("/sign-in/sent");
}

/**
 * AC 5: `signOut()` (database session strategy) deletes the `Session` row
 * via `lib/auth/prisma-adapter.ts`'s `deleteSession` and clears the cookie,
 * so a subsequent request with the old cookie is unauthenticated
 * server-side, not just client-side.
 */
export async function signOutSession(input: unknown = {}): Promise<ApiResult<{ signedOut: true }>> {
  signOutSessionInputSchema.parse(input ?? {});

  const session = await auth();
  if (!session) {
    // Already signed out — treat as success rather than surfacing an error
    // ("never throws to the client", plan §3.1).
    redirect("/");
  }

  try {
    await signOut({ redirect: false });
  } catch (err) {
    // Never throws to the client. Logged for operability; the user still
    // ends up redirected to `/` below.
    console.error("signOutSession failed", err);
  }

  redirect("/");
}
