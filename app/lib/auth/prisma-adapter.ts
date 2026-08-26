import "server-only";

import type { Adapter, AdapterAccount, AdapterSession, AdapterUser, VerificationToken } from "next-auth/adapters";
import type { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Hand-written Auth.js adapter against our own Prisma models — the
 * contingency named in ADR-0002.
 *
 * `@auth/prisma-adapter`'s `PrismaAdapter()` types its argument as
 * `PrismaClient` imported from `@prisma/client`. This project never
 * generates that package's types: Prisma 7's `prisma-client` generator
 * writes the client to `lib/generated/prisma` (see `prisma/schema.prisma`,
 * `lib/db.ts`), so `@prisma/client`'s own type export
 * (`export * from '.prisma/client/default'`) resolves to nothing —
 * `import type { PrismaClient } from "@prisma/client"` fails with
 * "Cannot find module" the moment it's used. Rather than paper over that
 * with a cast to `any` (forbidden by the project constitution), we
 * implement the ~15-function `Adapter` interface directly against our own
 * generated client.
 *
 * Every method here is a thin, faithful mapping to a Prisma call. No method
 * performs authorization or business logic — the AC 6 / AC 47 sign-in gates
 * live in `lib/auth/config.ts`'s `signIn` callback, and every student-data
 * read still goes exclusively through `lib/auth/dal.ts`.
 *
 * Methods needed by webauthn/OAuth flows (`getAccount`, `getAuthenticator`,
 * `createAuthenticator`, `listAuthenticatorsByUserId`,
 * `updateAuthenticatorCounter`) are intentionally not implemented: M0
 * configures only the custom email provider, so Auth.js never calls them.
 * Per the `Adapter` interface's own contract, calling an unimplemented
 * method is a loud error, not a silent failure.
 */
export function buildPrismaAdapter(db: PrismaClient): Adapter {
  return {
    async createUser(user: Omit<AdapterUser, "id">) {
      return db.user.create({
        data: {
          email: user.email,
          name: user.name ?? null,
          image: user.image ?? null,
          emailVerified: user.emailVerified ?? null,
          // AC 6: stamped only here. `createUser` is reached only once the
          // `signIn` callback (lib/auth/config.ts) has already confirmed a
          // live `AdultAttestation` exists for this email — an account
          // holder's age gate, not parental consent (ADR-0002, ADR-0008).
          adultAttestedAt: new Date(),
        },
      });
    },

    async getUser(id: string) {
      return db.user.findUnique({ where: { id } });
    },

    async getUserByEmail(email: string) {
      return db.user.findUnique({ where: { email } });
    },

    async getUserByAccount({
      provider,
      providerAccountId,
    }: Pick<AdapterAccount, "provider" | "providerAccountId">) {
      const account = await db.account.findUnique({
        where: { provider_providerAccountId: { provider, providerAccountId } },
        include: { user: true },
      });
      return account?.user ?? null;
    },

    async updateUser(user: Partial<AdapterUser> & Pick<AdapterUser, "id">) {
      return db.user.update({
        where: { id: user.id },
        data: {
          ...(user.email !== undefined ? { email: user.email } : {}),
          ...(user.name !== undefined ? { name: user.name } : {}),
          ...(user.image !== undefined ? { image: user.image } : {}),
          ...(user.emailVerified !== undefined ? { emailVerified: user.emailVerified } : {}),
        },
      });
    },

    async deleteUser(userId: string) {
      await db.user.delete({ where: { id: userId } });
    },

    async linkAccount(account: AdapterAccount) {
      await db.account.create({
        data: {
          userId: account.userId,
          type: account.type,
          provider: account.provider,
          providerAccountId: account.providerAccountId,
          refresh_token: toNullableString(account.refresh_token),
          access_token: toNullableString(account.access_token),
          expires_at: typeof account.expires_at === "number" ? account.expires_at : null,
          token_type: toNullableString(account.token_type),
          scope: toNullableString(account.scope),
          id_token: toNullableString(account.id_token),
          session_state: toNullableString(account.session_state),
        },
      });
    },

    async unlinkAccount({
      provider,
      providerAccountId,
    }: Pick<AdapterAccount, "provider" | "providerAccountId">) {
      await db.account.delete({
        where: { provider_providerAccountId: { provider, providerAccountId } },
      });
    },

    async createSession(session: { sessionToken: string; userId: string; expires: Date }) {
      return db.session.create({ data: session });
    },

    async getSessionAndUser(sessionToken: string) {
      const found = await db.session.findUnique({
        where: { sessionToken },
        include: { user: true },
      });
      if (!found) return null;
      const { user, ...session } = found;
      return { session, user };
    },

    async updateSession(session: Partial<AdapterSession> & Pick<AdapterSession, "sessionToken">) {
      return db.session.update({
        where: { sessionToken: session.sessionToken },
        data: {
          ...(session.expires !== undefined ? { expires: session.expires } : {}),
          ...(session.userId !== undefined ? { userId: session.userId } : {}),
        },
      });
    },

    async deleteSession(sessionToken: string) {
      try {
        return await db.session.delete({ where: { sessionToken } });
      } catch {
        // Already gone (e.g. a concurrent sign-out) — treated as a no-op,
        // matching the Adapter interface's documented return shape.
        return null;
      }
    },

    async createVerificationToken(token: VerificationToken) {
      return db.verificationToken.create({ data: token });
    },

    async useVerificationToken({ identifier, token }: { identifier: string; token: string }) {
      try {
        // Deletes on read: this IS the "single use" half of AC 4.
        return await db.verificationToken.delete({
          where: { identifier_token: { identifier, token } },
        });
      } catch {
        // Already used, or never existed — Auth.js treats this as an
        // invalid/expired token.
        return null;
      }
    },
  };
}

/** Narrows the loosely-typed OAuth token fields to `string | null` for Prisma's `String?` columns. */
function toNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
