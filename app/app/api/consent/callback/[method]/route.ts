import { withAuth } from "@/lib/api/handler";
import { apiErr, errorResponse } from "@/lib/errors";
import { consentCallbackInputSchema } from "@/lib/schemas/consent";
import { checkPublicConsentRateLimit, extractClientIp } from "@/lib/consent/rate-limit";
import { CONSENT_PUBLIC_RATE_LIMIT_MAX_ATTEMPTS, CONSENT_PUBLIC_RATE_LIMIT_WINDOW_MINUTES } from "@/lib/config";

/**
 * Endpoint 11 (plan §3.2) — `POST /api/consent/callback/[method]`. Public,
 * signature-verified (Provider auth). **Specified now, implemented only when
 * a non-`EMAIL_PLUS` method ships** (ADR-0008 §7): `EMAIL_PLUS` never calls
 * back here — its corroborating step is the shared, challenge-token
 * `/api/consent/verify` / `/api/consent/decline` pair (ADR-0008 §5), which
 * is exactly why those two are session-free routes and this one takes a
 * `[method]` segment instead.
 *
 * No provider in this codebase implements a signature-verified callback
 * yet (`lib/consent/methods/registry.ts` only has a live `EMAIL_PLUS`), so
 * there is nothing honest to route `params.method` to today —
 * `resolveResource` resolves to `null` for every value, a genuine 404
 * rather than a stand-in success. Wiring a real method's callback here
 * later is a change to `resolveResource` (validate the signature, resolve
 * the provider) and `handler` (call `provider.corroborate()` and run the
 * same stamp path as `/api/consent/verify`) — nothing about this file's
 * shape changes.
 */
export const POST = withAuth({
  mode: "public",
  publicRateLimit: ({ req }) =>
    checkPublicConsentRateLimit(`callback:${extractClientIp(req) ?? "unknown"}`, {
      windowMs: CONSENT_PUBLIC_RATE_LIMIT_WINDOW_MINUTES * 60_000,
      maxAttempts: CONSENT_PUBLIC_RATE_LIMIT_MAX_ATTEMPTS,
    }),
  resolveResource: async () => null,
  bodySchema: consentCallbackInputSchema,
  handler: async () => {
    // Unreachable while `resolveResource` always returns `null` (withAuth's
    // step 3 already returned 404 before this could run) — kept so this
    // route's exported shape matches every other one, and so a future
    // method's implementation only has to change the two functions above.
    return errorResponse(apiErr("NOT_FOUND"));
  },
});
