import "server-only";

import { z } from "zod";

import { CONSENT_METHOD } from "@/lib/config";
import { CONSENT_METHODS, type ConsentMethod, type ConsentMethodProvider } from "@/lib/consent/methods/port";
import { emailPlusProvider } from "@/lib/consent/methods/email-plus";

/**
 * Maps every `ConsentMethod` value to either a live provider or a
 * `NotImplementedProvider` (ADR-0008 §2). All nine values are always
 * present — a historical `ParentalConsent`/`ConsentVerificationChallenge`
 * row written under a since-retired method must still resolve to
 * SOMETHING when read (ADR-0008 §6: "the registry keeps entries for retired
 * methods in a read-only capacity so a historical row still resolves to a
 * display label and a copy version"). Only `begin()`/`corroborate()` become
 * unreachable for a method with no live implementation.
 *
 * Only `EMAIL_PLUS` ships a live implementation in M0/M1 (ADR-0008 §7).
 */
function notImplementedProvider(method: ConsentMethod): ConsentMethodProvider {
  return {
    method,
    stepCopyId: `${method.toLowerCase()}.not-implemented`,
    // Accepts anything at the type level; `begin()`/`corroborate()` below
    // throw before ever inspecting it, so there is nothing meaningful to
    // validate here.
    extraInputSchema: z.unknown(),
    begin: async () => {
      throw new Error(
        `ConsentMethodProvider for ${method} is not implemented. See lib/consent/methods/registry.ts.`,
      );
    },
    corroborate: async () => {
      throw new Error(
        `ConsentMethodProvider for ${method} is not implemented. See lib/consent/methods/registry.ts.`,
      );
    },
  };
}

const IMPLEMENTED_METHODS: ReadonlySet<ConsentMethod> = new Set<ConsentMethod>(["EMAIL_PLUS"]);

const registry: Record<ConsentMethod, ConsentMethodProvider> = Object.fromEntries(
  CONSENT_METHODS.map((method) => [method, notImplementedProvider(method)]),
) as Record<ConsentMethod, ConsentMethodProvider>;

registry.EMAIL_PLUS = emailPlusProvider;

/**
 * Resolves the provider for ANY `ConsentMethod` value, live or retired —
 * used by `lib/consent/service.ts`'s `verifyConsent` to dispatch based on a
 * `ConsentVerificationChallenge` row's own `method` field (which may not be
 * the currently-configured `CONSENT_METHOD`, ADR-0008 §6), never by
 * re-deriving the method from configuration.
 */
export function getConsentMethodProvider(method: ConsentMethod): ConsentMethodProvider {
  return registry[method];
}

/**
 * ADR-0008 §2: "a bad or unimplemented value fails the boot, not the
 * parent's request." `lib/config.ts` already validates `CONSENT_METHOD`
 * against the enum; this additionally validates that the CONFIGURED value
 * has a LIVE provider — a syntactically valid but unimplemented method
 * (e.g. `PAYMENT_CARD` today) must never be reachable from a real consent
 * submission.
 */
if (!IMPLEMENTED_METHODS.has(CONSENT_METHOD)) {
  throw new Error(
    `CONSENT_METHOD=${CONSENT_METHOD} has no implemented ConsentMethodProvider. ` +
      `Implemented methods: ${Array.from(IMPLEMENTED_METHODS).join(", ")}. ` +
      "See lib/consent/methods/registry.ts.",
  );
}

/** The provider for the currently-configured `CONSENT_METHOD` — always live, by the check above. */
export const activeConsentMethodProvider: ConsentMethodProvider = registry[CONSENT_METHOD];
