/**
 * The `ConsentMethodProvider` port (ADR-0008 §2). Types and interfaces only —
 * no implementation, no registry, no provider. Imported by nothing outside
 * `lib/consent/` except `lib/config.ts`, which needs `ConsentMethod` and
 * `CONSENT_METHODS` to validate the `CONSENT_METHOD` environment variable at
 * module load (ADR-0008 §2: "a bad or unimplemented value fails the boot").
 *
 * Exactly two facts about consent may leak outside `lib/consent/`: that a
 * `ParentalConsent` row exists with a non-null `verifiedAt`, and that
 * `StudentProfile.status === 'ACTIVE'`. Nothing else — in particular, no
 * route, DAL function or component may branch on `ConsentMethod` (ADR-0008 §3).
 */

import type { z } from "zod";
import { ConsentMethod as PrismaConsentMethod } from "@/lib/generated/prisma/enums";

// ─────────────────────────── the method enum ───────────────────────────

/**
 * Method shapes enumerated in 16 CFR §312.5(b)(2)(i)-(ix), confirmed verbatim
 * against eCFR and Cornell LII
 * (`docs/research/coppa-312-5-primary-text.md`). All nine values map
 * one-to-one, in order, to the nine current subsections.
 *
 * RECONCILED (S2/S7): `prisma/schema.prisma` now owns this enum —
 * `ConsentMethod` and `CONSENT_METHODS` here are derived from the generated
 * Prisma enum (`lib/generated/prisma/enums`, browser-safe: a plain `as const`
 * object, no client import) rather than hand-duplicated, so there is exactly
 * one place these nine values are spelled out. Values are append-only for
 * the same reason the Prisma enum is: removing one would be a destructive
 * migration against rows that are legal evidence (ADR-0008).
 */
export const CONSENT_METHODS = Object.values(PrismaConsentMethod) as [
  PrismaConsentMethod,
  ...PrismaConsentMethod[],
];

export type ConsentMethod = PrismaConsentMethod;

// ─────────────────────────── begin() / corroborate() shapes ───────────────────────────

/**
 * A pending corroborating step to record. `tokenHash` is a SHA-256 of the
 * token handed to the parent — the raw token is never stored (mirrors how
 * sign-in tokens are handled, ADR-0002; for `EMAIL_PLUS` this token *is*
 * parental consent, ADR-0008 §4).
 */
export type ChallengeSpec = {
  tokenHash: string;
  expiresAt: Date;
};

/**
 * The result of `ConsentMethodProvider.begin()`.
 *
 * - `pending`: the common case for an out-of-band corroborating step
 *   (an email link, a phone call to schedule). `challenge`, if present, is
 *   persisted by the caller (`lib/consent/service.ts`) as a
 *   `ConsentVerificationChallenge` row — the provider itself never writes it.
 * - `verified`: a method whose corroboration is synchronous (e.g. a vendor
 *   that returns an inline decision). Even here the caller still performs
 *   the same conditional `verifiedAt` stamp, so `verifiedAt` is always set
 *   after and distinct from `submittedAt` and the profile is never `ACTIVE`
 *   at insert time (ADR-0008 §3, AC 19).
 */
export type BeginResult =
  | { kind: "pending"; evidenceRef: string | null; challenge?: ChallengeSpec }
  | { kind: "verified"; evidenceRef: string };

/** ADR-0008 §2 names this type `ConsentBeginResult`; kept here as an alias
 * so a reader who came from the ADR can find it under either name. */
export type ConsentBeginResult = BeginResult;

/**
 * The result of `ConsentMethodProvider.corroborate()`. `ok: true` carries a
 * method-specific `evidenceRef` — a processor transaction id, a vendor
 * verification id, a consumed-challenge id — a REFERENCE only, never a live
 * credential (ADR-0008 §4).
 */
export type CorroborationResult =
  | { ok: true; consentId: string; evidenceRef: string }
  | { ok: false; code: "EXPIRED" | "ALREADY_USED" | "NOT_FOUND" | "REJECTED" };

// ─────────────────────────── context passed to begin() ───────────────────────────

/**
 * Everything a provider's `begin()` needs to start a corroborating step, for
 * the `ParentalConsent` row that was just inserted (in the same transaction,
 * `verifiedAt` still null). Deliberately minimal and deliberately free of
 * any other Prisma-generated enum (e.g. `ConsentRelationship`) — those are
 * stored on the row by `lib/consent/service.ts` and are not needed to begin
 * a corroboration.
 */
export type ConsentContext = {
  /** id of the just-inserted `ParentalConsent` row. */
  parentalConsentId: string;
  studentProfileId: string;
  /** the signed-in adult performing the action (`User.id`). */
  userId: string;
  /**
   * The account holder's email address — the only delivery channel
   * `EMAIL_PLUS` has. Methods that don't need it (e.g. `PAYMENT_CARD`) may
   * ignore it.
   */
  userEmail: string;
  consentingAdultName: string;
  /**
   * The method-specific fields already validated against this provider's
   * `extraInputSchema` at the API boundary. The provider re-narrows this
   * itself (e.g. with `extraInputSchema.parse(methodInput)`) rather than
   * trusting an upstream cast.
   */
  methodInput: unknown;
  /** Read server-side from headers, never from the request body. */
  ipAddress: string | null;
  userAgent: string | null;
};

// ─────────────────────────── the provider interface ───────────────────────────

export interface ConsentMethodProvider {
  readonly method: ConsentMethod;
  /**
   * Identifier of the versioned copy block describing this method's steps
   * to the parent. Rendered server-side from a copy module; never a
   * hard-coded string in a component.
   */
  readonly stepCopyId: string;
  /**
   * Extra fields this method needs on the consent form, as a zod schema.
   * `EMAIL_PLUS` contributes nothing (`z.object({})` or similar);
   * `TEXT_PLUS` would contribute a phone number.
   */
  readonly extraInputSchema: z.ZodType;
  /**
   * Runs immediately after the `ParentalConsent` row is inserted, inside the
   * same transaction. Must not perform network I/O that cannot be retried
   * safely — a transaction may still roll back after this returns.
   */
  begin(ctx: ConsentContext): Promise<BeginResult>;
  /**
   * Runs from this method's callback route (or the shared
   * `/api/consent/verify` route for challenge-based methods). Verification
   * only: it does not write the consent row, does not touch
   * `StudentProfile`, and does not know what `ACTIVE` means — that stamp is
   * applied by `lib/consent/service.ts`.
   */
  corroborate(input: unknown): Promise<CorroborationResult>;
}
