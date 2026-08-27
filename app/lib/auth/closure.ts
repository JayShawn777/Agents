import "server-only";

import { ACCOUNT_CLOSURE_RECOVERY_DAYS } from "@/lib/config";

/**
 * AC 47 / ADR-0007 §4: refusal is keyed on `closureRequestedAt` ONLY, and
 * only while the recovery window is still live. A §312.6 parental deletion
 * request never sets this field, so it can never trigger this refusal
 * (ADR-0002 revision note).
 *
 * Shared by `lib/auth/config.ts` (refuses sign-in redemption for an
 * already-closed account) and `lib/auth/dal.ts` (refuses an ALREADY-LIVE
 * session the moment closure is requested, since the database session
 * strategy means an existing `Session` row and cookie keep working across
 * requests unless checked here too, not just at redemption).
 */
export function isInClosureRecoveryWindow(closureRequestedAt: unknown): boolean {
  if (!(closureRequestedAt instanceof Date) && typeof closureRequestedAt !== "string") {
    return false;
  }
  const requestedAt = new Date(closureRequestedAt);
  if (Number.isNaN(requestedAt.getTime())) return false;
  const recoveryEndsAt =
    requestedAt.getTime() + ACCOUNT_CLOSURE_RECOVERY_DAYS * 24 * 60 * 60 * 1000;
  return recoveryEndsAt > Date.now();
}
