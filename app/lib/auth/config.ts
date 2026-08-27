import NextAuth from "next-auth";
import type { EmailConfig } from "next-auth/providers/email";

import { db } from "@/lib/db";
import { buildPrismaAdapter } from "@/lib/auth/prisma-adapter";
import { normalizeEmail } from "@/lib/auth/normalize-email";
import { sendMagicLinkEmail } from "@/lib/email/send-magic-link";
import { MAGIC_LINK_TTL_SECONDS } from "@/lib/config";
import { toPublicSession } from "@/lib/auth/session-shape";
import { isInClosureRecoveryWindow } from "@/lib/auth/closure";

/**
 * Auth.js v5, database session strategy, a single custom passwordless email
 * provider (ADR-0002). JWT sessions cannot satisfy AC 5 (server-side
 * sign-out) or AC 47 (closure refusal against an already-issued token), so
 * `strategy: "database"` is not a preference — it's the only strategy that
 * can be correct here.
 */

/**
 * A custom `type: "email"` provider with our own `sendVerificationRequest`
 * (ADR-0002) — no mail SDK, no SMTP client, no `Nodemailer()` factory.
 * `maxAge` sets AC 4's expiry half; Auth.js deletes the `VerificationToken`
 * row on redemption (`useVerificationToken`,
 * `lib/auth/prisma-adapter.ts`), which is the single-use half.
 */
const emailProvider: EmailConfig = {
  id: "email",
  type: "email",
  name: "Email",
  maxAge: MAGIC_LINK_TTL_SECONDS,
  async sendVerificationRequest({ identifier, url, expires }) {
    await sendMagicLinkEmail({ to: identifier, url, expiresAt: expires });
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: buildPrismaAdapter(db),
  session: { strategy: "database" },
  providers: [emailProvider],
  pages: {
    signIn: "/sign-in",
    verifyRequest: "/sign-in/sent",
    error: "/sign-in/error",
  },
  callbacks: {
    /**
     * Runs twice per sign-in attempt (see @auth/core's email callback flow):
     * once when the link is dispatched (`email.verificationRequest: true`)
     * and once when the link is opened ("redemption"). Only the redemption
     * call can safely gate anything — refusing at dispatch time would leak
     * account existence and violate AC 2.
     */
    async signIn({ user, email }) {
      if (email?.verificationRequest) {
        // AC 6's 18+ attestation gate and the `AdultAttestation` row are
        // already enforced/written by `signInWithEmail`
        // (lib/auth/actions.ts) BEFORE this provider's `signIn()` is ever
        // invoked. Nothing further to check at dispatch time, and nothing
        // here may reveal whether `user` already existed (AC 2).
        return true;
      }

      if (!user.email) return false;
      const identifier = normalizeEmail(user.email);

      // Defence in depth against a replayed or forged link: every
      // redemption requires a LIVE (unexpired) attestation for this exact
      // address, not just the token's own expiry. This is what makes it
      // impossible to reach `createUser` (lib/auth/prisma-adapter.ts) via
      // any path that bypassed `signInWithEmail` — e.g. Auth.js's own
      // built-in `/api/auth/signin` form, if it were ever reachable
      // (ADR-0002 revision note).
      const liveAttestation = await db.adultAttestation.findFirst({
        where: { email: identifier, expiresAt: { gt: new Date() } },
        orderBy: { attestedAt: "desc" },
        select: { id: true },
      });
      if (!liveAttestation) return false;

      // AC 47: refuse redemption while the account is inside its closure
      // recovery window. A brand-new address has no row yet — the
      // synthetic user Auth.js constructs for a first-time sign-in has no
      // `closureRequestedAt`, so this is a no-op for new accounts.
      // Auth.js's `User` type does not carry our custom Prisma columns.
      // This narrow, non-`any` cast reads a field our own adapter
      // (lib/auth/prisma-adapter.ts) puts on the object at runtime.
      const closureRequestedAt = (user as { closureRequestedAt?: Date | string | null })
        .closureRequestedAt;
      if (isInClosureRecoveryWindow(closureRequestedAt)) return false;

      return true;
    },

    /**
     * Delegates to `toPublicSession()` (`lib/auth/session-shape.ts`), which
     * carries the full explanation of why this exists — extracted to its
     * own module so it's unit-testable without importing `NextAuth(...)`'s
     * own module-load side effects.
     */
    async session({ session, user }) {
      return toPublicSession(user, session);
    },
  },
});
