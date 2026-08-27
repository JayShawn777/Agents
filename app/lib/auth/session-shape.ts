/**
 * The exact shape `auth()` may ever return, factored out of
 * `lib/auth/config.ts` so it is unit-testable without triggering
 * `NextAuth(...)`'s own module-load side effects (it reaches into
 * `next/server`, which is not resolvable outside a real Next.js runtime —
 * `tests/unit/lib/auth/config.test.ts` imports THIS module, never
 * `lib/auth/config.ts` itself, for exactly that reason).
 *
 * No `callbacks.session` was previously configured on the Auth.js config,
 * so Auth.js's default database-strategy behaviour ran instead: it spreads
 * the FULL `AdapterUser` row (`getSessionAndUser`,
 * `lib/auth/prisma-adapter.ts`) onto `session.user`, and the raw `Session`
 * row's own fields (notably `sessionToken`, the live session credential)
 * alongside it. `auth()` is called from server code that may pass its
 * return value toward a client (e.g. a server component prop) — the
 * session object must carry only what's safe there. Rebuilt from scratch:
 * exactly `{ user: { id, email }, expires }`, nothing else our own schema
 * adds (`adultAttestedAt`, `closureRequestedAt`, `emailVerified`, `image`,
 * `name`) and never the session token itself.
 */
export function toPublicSession(
  user: { id: string; email: string | null },
  session: { expires: Date },
): { user: { id: string; email: string | null }; expires: string } {
  return {
    user: { id: user.id, email: user.email },
    // `AdapterSession.expires` is a `Date`; `Session.expires` is documented
    // as an ISO string (`ISODateString` in @auth/core's own types) —
    // converted explicitly rather than relying on whatever JSON.stringify()
    // does implicitly downstream.
    expires: session.expires.toISOString(),
  };
}
