import "server-only";

import { createHmac } from "node:crypto";

/**
 * ADR-0007 §6 / AC 50: `ConsentAuditArtifact.adultIdentityHash` — an
 * HMAC-SHA256 of the account owner's identifier under a server-held key
 * (`AUDIT_PSEUDONYM_KEY`, `.env.example`), never the identifier itself and
 * not reversible without the key. Deterministic, so the same adult produces
 * the same hash across separate deletions — the whole point of keeping a
 * PSEUDONYMISED, not anonymised, remnant (a regulator asking "did this same
 * person consent for other children we've since deleted?" is answerable).
 *
 * Resolved lazily (not at module load, unlike `lib/config.ts`'s
 * `CONSENT_METHOD`) because this module is reached only from the deletion
 * path, and a missing key should fail that one request loudly rather than
 * fail every route's boot in an environment that never deletes anything
 * (e.g. a fresh contributor's first `pnpm dev` with an incomplete `.env`).
 */
function requireAuditPseudonymKey(): string {
  const key = process.env.AUDIT_PSEUDONYM_KEY;
  if (!key) {
    throw new Error(
      "AUDIT_PSEUDONYM_KEY is not set. Required before any consent-bearing profile can be " +
        "deleted (ADR-0007 §6, AC 50) — see .env.example.",
    );
  }
  return key;
}

/** HMAC-SHA256(identifier, AUDIT_PSEUDONYM_KEY), hex-encoded. */
export function hashAdultIdentity(identifier: string): string {
  return createHmac("sha256", requireAuditPseudonymKey())
    .update(identifier.trim().toLowerCase())
    .digest("hex");
}
