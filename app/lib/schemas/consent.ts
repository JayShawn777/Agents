/**
 * zod input schemas for the consent flow (plan §3, endpoints 8-12):
 * `POST /api/students/[studentId]/consent`, `POST /api/consent/verify`,
 * `POST /api/consent/decline`, `POST /api/consent/callback/[method]`,
 * `POST /api/students/[studentId]/consent/withdraw`.
 */

import { z } from "zod";
import { ConsentMethod, ConsentRelationship, ConsentScope } from "@/lib/domain/enums";
import { CONSENT_METHOD } from "@/lib/config";

// ─────────────────────────── POST .../consent (#8) ───────────────────────────

function includesDataProcessing(scopes: readonly ConsentScope[]): boolean {
  return scopes.includes("DATA_PROCESSING");
}

/**
 * `methodInput` is intentionally untyped here: it is re-validated inside the
 * active `ConsentMethodProvider`'s own `extraInputSchema`
 * (`lib/consent/methods/port.ts` — "the provider re-narrows this itself").
 * This shared schema only pins down the fields every method needs in
 * common, plus the AC 16 guardrail that a submission can only target the
 * currently-deployed method.
 */
export const submitConsentInputSchema = z
  .object({
    directNoticeId: z.cuid(),
    noticeVersion: z.string().max(32),
    consentTextVersion: z.string().max(32),
    consentingAdultName: z.string().trim().min(1).max(80),
    relationship: z.enum(ConsentRelationship),
    scopes: z
      .array(z.enum(ConsentScope))
      .min(1)
      .refine(includesDataProcessing, {
        message: "Consent must include data processing.",
      }),
    method: z.enum(ConsentMethod).refine((value) => value === CONSENT_METHOD, {
      message: "Unsupported consent method.",
    }),
    methodInput: z.unknown(),
    affirmed: z.literal(true),
  })
  .strict();

export type SubmitConsentInput = z.infer<typeof submitConsentInputSchema>;

// ─────────────────────────── POST /api/consent/verify (#9) ───────────────────────────

export const verifyConsentInputSchema = z
  .object({
    token: z.string().min(32).max(256),
  })
  .strict();

export type VerifyConsentInput = z.infer<typeof verifyConsentInputSchema>;

// ─────────────────────────── POST /api/consent/decline (#10) ───────────────────────────

export const declineConsentInputSchema = z
  .object({
    token: z.string(),
  })
  .strict();

export type DeclineConsentInput = z.infer<typeof declineConsentInputSchema>;

// ─────────────────────────── POST /api/consent/callback/[method] (#11) ───────────────────────────

/**
 * The body here is genuinely method-specific and validated by that method's
 * own `ConsentMethodProvider.corroborate()` (plan §3, #11) — there is no
 * fixed shape to pin down at the shared boundary. This schema only asserts
 * "an object", so the route can hand it to `corroborate()` unchanged;
 * per-field validation happens inside the provider, same pattern as
 * `methodInput` above. Specified now; only exercised once a non-`EMAIL_PLUS`
 * method ships.
 */
export const consentCallbackInputSchema = z.record(z.string(), z.unknown());

export type ConsentCallbackInput = z.infer<typeof consentCallbackInputSchema>;

// ─────────────────────────── POST .../consent/withdraw (#12) ───────────────────────────

export const withdrawConsentInputSchema = z
  .object({
    confirm: z.literal(true),
  })
  .strict();

export type WithdrawConsentInput = z.infer<typeof withdrawConsentInputSchema>;
