import { withAuth } from "@/lib/api/handler";
import { apiErr, errorResponse, successResponse } from "@/lib/errors";
import { verifyConsentInputSchema } from "@/lib/schemas/consent";
import { verifyConsent } from "@/lib/consent/service";
import { checkPublicConsentRateLimit, extractClientIp } from "@/lib/consent/rate-limit";
import { CONSENT_PUBLIC_RATE_LIMIT_MAX_ATTEMPTS, CONSENT_PUBLIC_RATE_LIMIT_WINDOW_MINUTES } from "@/lib/config";

/**
 * Endpoint 9 (plan §3.2) — `POST /api/consent/verify`. **Public, session-free
 * (Token auth)** — the parent may open the confirmation message on a device
 * with no session (ADR-0006). The credential IS the request: `body.token`,
 * a single-use `EMAIL_PLUS`/`TEXT_PLUS` challenge that, once corroborated,
 * IS parental consent (ADR-0008 §4). `publicRateLimit` runs BEFORE any
 * lookup keyed on that token — see `lib/api/handler.ts`'s docstring for the
 * reachability bug this closes (a wrong token used to 404 before ever
 * reaching a rate limit).
 */
export const POST = withAuth({
  mode: "public",
  publicRateLimit: ({ req }) =>
    checkPublicConsentRateLimit(`verify:${extractClientIp(req) ?? "unknown"}`, {
      windowMs: CONSENT_PUBLIC_RATE_LIMIT_WINDOW_MINUTES * 60_000,
      maxAttempts: CONSENT_PUBLIC_RATE_LIMIT_MAX_ATTEMPTS,
    }),
  bodySchema: verifyConsentInputSchema,
  handler: async ({ body }) => {
    const result = await verifyConsent(body.token);
    if (!result.ok) {
      if (result.code === "NOT_FOUND") return errorResponse(apiErr("NOT_FOUND"));
      // EXPIRED / ALREADY_USED: the wrong step of a flow — a fresh consent
      // submission is the fix, not a retry of this same token.
      return errorResponse(apiErr("CONFLICT"));
    }
    return successResponse({ verified: true as const });
  },
});
