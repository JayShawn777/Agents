/**
 * Mirrors Auth.js's own default email normalization (lowercase, NFKC,
 * trimmed) closely enough that an `AdultAttestation` row written by
 * `signInWithEmail` (lib/auth/actions.ts) is found by the same-address
 * lookup the `signIn` callback performs at redemption
 * (lib/auth/config.ts). Not a full re-implementation of Auth.js's
 * `defaultNormalizer` (no quote/format rejection here — that validation
 * already happened via `z.email()` at the server-action boundary); this
 * exists only to keep casing/whitespace consistent between the two writers.
 */
export function normalizeEmail(email: string): string {
  return email.normalize("NFKC").trim().toLowerCase();
}
