import "server-only";

import { createHash, randomBytes } from "node:crypto";

/**
 * Shared by every challenge-based `ConsentMethodProvider`
 * (`lib/consent/methods/email-plus.ts`, ADR-0008 §4) and by
 * `lib/consent/service.ts`'s method-agnostic `declineConsent` — decline has
 * no provider to delegate to (there is no `decline()` on
 * `ConsentMethodProvider`; see `lib/consent/methods/port.ts`), so it hashes
 * and looks up `ConsentVerificationChallenge` directly, generically, across
 * every method. Kept here rather than inside `email-plus.ts` so neither
 * caller depends on a specific provider module.
 *
 * SHA-256 hex digest — the raw token is never stored (mirrors how
 * ADR-0002 handles the sign-in magic-link token; ADR-0008 §4: "this token
 * IS parental consent").
 */
export function hashConsentToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * 256 bits of randomness, base64url-encoded (~43 chars) — comfortably
 * within `verifyConsentInputSchema`/`declineConsentInputSchema`'s
 * `[32, 256]` length bound (`lib/schemas/consent.ts`) with room for a
 * future method to use a differently-shaped token.
 */
const TOKEN_BYTES = 32;

export function generateConsentToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}
