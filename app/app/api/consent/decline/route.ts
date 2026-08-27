import { withAuth } from "@/lib/api/handler";
import { apiErr, errorResponse, successResponse } from "@/lib/errors";
import { declineConsentInputSchema } from "@/lib/schemas/consent";
import { declineConsent } from "@/lib/consent/service";
import { checkPublicConsentRateLimit, extractClientIp } from "@/lib/consent/rate-limit";
import { CONSENT_PUBLIC_RATE_LIMIT_MAX_ATTEMPTS, CONSENT_PUBLIC_RATE_LIMIT_WINDOW_MINUTES } from "@/lib/config";

/**
 * Endpoint 10 (plan §3.2) — `POST /api/consent/decline`. Public, session-free
 * (Token auth), same rate-limit treatment as `/api/consent/verify` — the
 * token is exactly as sensitive here (it identifies which pending consent
 * flow to kill), even though a successful decline never activates anything.
 * The "this was not me" action on the public confirmation page
 * (ADR-0008 §5).
 */
export const POST = withAuth({
  mode: "public",
  publicRateLimit: ({ req }) =>
    checkPublicConsentRateLimit(`decline:${extractClientIp(req) ?? "unknown"}`, {
      windowMs: CONSENT_PUBLIC_RATE_LIMIT_WINDOW_MINUTES * 60_000,
      maxAttempts: CONSENT_PUBLIC_RATE_LIMIT_MAX_ATTEMPTS,
    }),
  bodySchema: declineConsentInputSchema,
  handler: async ({ body }) => {
    const result = await declineConsent(body.token);
    if (!result.ok) {
      if (result.code === "NOT_FOUND") return errorResponse(apiErr("NOT_FOUND"));
      return errorResponse(apiErr("CONFLICT"));
    }
    return successResponse({ declined: true as const });
  },
});
