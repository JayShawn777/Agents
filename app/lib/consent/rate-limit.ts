import "server-only";

/**
 * Rate limiting for the session-free, token-authenticated consent routes
 * (`/api/consent/verify`, `/api/consent/decline`,
 * `/api/consent/callback/[method]`) — the only unauthenticated mutations in
 * the app (ADR-0006). For `EMAIL_PLUS` the challenge token IS parental
 * consent, so an attacker who could make unlimited guesses against the
 * token space would have an unlimited number of tries at forging consent.
 *
 * `lib/api/handler.ts`'s `publicRateLimit` hook runs this check BEFORE the
 * token is ever looked up (step 2b, ahead of resource resolution at step 3)
 * — see that file's docstring for the reachability bug this closes: a
 * wrong-but-well-formed token used to resolve to nothing and exit as a free,
 * unthrottled 404 that never reached the ordinary post-resolution
 * `rateLimit` hook.
 *
 * ASSUMPTION / accepted limitation, spelled out rather than left implicit:
 * this is an in-memory, per-process sliding window. No new dependency (no
 * Redis) and no schema change — this task's brief explicitly forbids
 * touching `prisma/schema.prisma`, and the project constitution forbids
 * adding a major dependency without the owner's approval. On Vercel's
 * serverless model this resets on a cold start and is not shared across
 * concurrently warm instances, so it is a best-effort throttle rather than a
 * hard cap. It still closes the gap that matters: every attempt, valid or
 * not, now consumes a slot before any database lookup runs, which a
 * wrong-token 404 previously bypassed entirely. A durable, shared limiter
 * (e.g. a dedicated rate-limit store) is the natural upgrade if this proves
 * insufficient in practice — see the backend-engineer report for this
 * milestone.
 */

const attemptsByKey = new Map<string, number[]>();

export type PublicConsentRateLimitConfig = {
  windowMs: number;
  maxAttempts: number;
};

/**
 * Returns `true` if the caller may proceed. Records this attempt regardless
 * of the outcome — a caller already over the limit still "spends" a slot,
 * which is standard sliding-window behaviour and keeps a sustained flood
 * from ever draining back below the threshold.
 */
export function checkPublicConsentRateLimit(
  key: string,
  config: PublicConsentRateLimitConfig,
): boolean {
  const now = Date.now();
  const windowStart = now - config.windowMs;
  const kept = (attemptsByKey.get(key) ?? []).filter((ts) => ts > windowStart);
  const allowed = kept.length < config.maxAttempts;
  kept.push(now);
  attemptsByKey.set(key, kept);
  return allowed;
}

/** Test-only: clears all recorded attempts so suites don't leak state into each other. */
export function resetPublicConsentRateLimitForTests(): void {
  attemptsByKey.clear();
}

/**
 * Best-effort client IP extraction — the same header preference used
 * elsewhere for server-side-only IP reads (`lib/auth/actions.ts`). Never
 * trust this for anything beyond rate-limiting/audit purposes; it is
 * client-suppliable when no reverse proxy normalises it.
 */
export function extractClientIp(req: Request): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}
