import "server-only";

import { z } from "zod";

import { db } from "@/lib/db";
import { CONSENT_CHALLENGE_TTL_HOURS } from "@/lib/config";
import { sendConsentConfirmationEmail } from "@/lib/email/send-consent-confirmation";
import { generateConsentToken, hashConsentToken } from "@/lib/consent/token";
import type {
  BeginResult,
  ConsentContext,
  ConsentMethodProvider,
  CorroborationResult,
} from "@/lib/consent/methods/port";

/**
 * The first `ConsentMethodProvider` (ADR-0008 §7): "email plus" —
 * 16 CFR §312.5(b)(2)(viii), confirmed verbatim against eCFR/Cornell LII
 * (`docs/research/coppa-312-5-primary-text.md`). Sends a confirmatory email
 * following receipt of consent; the confirming step is the parent opening a
 * link and taking an explicit action on a page, never a mutating GET
 * (ADR-0008 §5) — a corporate mail scanner following every link in an inbound
 * message must not be able to grant consent on the parent's behalf.
 *
 * Token handling mirrors ADR-0002's sign-in token: generated with
 * `node:crypto`, hashed (SHA-256) before it ever touches the database, short
 * TTL (`CONSENT_CHALLENGE_TTL_HOURS`), single use. The raw token exists only
 * in the dispatched email and the parent's browser — never logged, never
 * returned in an API response, never stored.
 *
 * **May NOT touch `ParentalConsent`.** `begin()`/`corroborate()` only ever
 * read/write `ConsentVerificationChallenge` — the one-time `verifiedAt` stamp
 * on `ParentalConsent` is applied exclusively by `lib/consent/service.ts`
 * (ADR-0007 §3).
 */
export const emailPlusProvider: ConsentMethodProvider = {
  method: "EMAIL_PLUS",
  stepCopyId: "email-plus.v1",

  /** Contributes nothing beyond the fields every method shares (ADR-0008 §2). */
  extraInputSchema: z.object({}).strict(),

  async begin(ctx: ConsentContext): Promise<BeginResult> {
    // Re-narrowed here rather than trusted from the caller (port.ts: "the
    // provider re-narrows this itself rather than trusting an upstream
    // cast"). Throws (mapped to a 500 by `withAuth()`) if this method's own
    // contract was violated — should be unreachable, since the shared
    // `submitConsentInputSchema` already validates `methodInput` isn't
    // present for `EMAIL_PLUS` at the API boundary.
    emailPlusProvider.extraInputSchema.parse(ctx.methodInput ?? {});

    const token = generateConsentToken();
    const tokenHash = hashConsentToken(token);
    const expiresAt = new Date(Date.now() + CONSENT_CHALLENGE_TTL_HOURS * 60 * 60 * 1000);

    // Network I/O inside `begin()` — which runs inside the same transaction
    // as the `ParentalConsent` insert — is accepted by ADR-0008 §2 ("must
    // not perform network I/O that cannot be retried safely"): the worst
    // case of a subsequent rollback is a dispatched confirmation email whose
    // token never resolves to a row, which `corroborate()` below reports as
    // `NOT_FOUND` — never a forged or duplicated consent.
    await sendConsentConfirmationEmail({
      to: ctx.userEmail,
      consentingAdultName: ctx.consentingAdultName,
      verifyUrl: buildConsentPageUrl(token),
      declineUrl: buildConsentPageUrl(token, { decline: true }),
      expiresAt,
    });

    // `evidenceRef: null` — EMAIL_PLUS has no evidence until the
    // corroborating step completes; `methodEvidence` is only ever set
    // together with the `verifiedAt` stamp (ADR-0007 §3's single UPDATE
    // statement), never at `begin()` time.
    return { kind: "pending", evidenceRef: null, challenge: { tokenHash, expiresAt } };
  },

  async corroborate(input: unknown): Promise<CorroborationResult> {
    const parsed = z.string().min(1).safeParse(input);
    if (!parsed.success) return { ok: false, code: "NOT_FOUND" };

    const tokenHash = hashConsentToken(parsed.data);
    const challenge = await db.consentVerificationChallenge.findUnique({
      where: { tokenHash },
      include: { parentalConsent: { select: { verifiedAt: true } } },
    });
    if (!challenge || challenge.method !== "EMAIL_PLUS") {
      return { ok: false, code: "NOT_FOUND" };
    }

    // Idempotent replay of an ALREADY-VERIFIED token (AC 19: "a replay of an
    // already-consumed token by the same holder returns 200 { verified: true }
    // without a second stamp") — not a failure, no `attemptCount` increment,
    // no further write.
    if (challenge.parentalConsent.verifiedAt !== null) {
      return { ok: true, consentId: challenge.parentalConsentId, evidenceRef: challenge.id };
    }

    // Atomic consume, guarded by `consumedAt IS NULL` — avoids a race with a
    // concurrent verify/decline double-consuming the same row.
    const consumed = await db.consentVerificationChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });

    if (consumed.count === 1) {
      return { ok: true, consentId: challenge.parentalConsentId, evidenceRef: challenge.id };
    }

    // Lost the race, or the guarded update's predicate failed outright —
    // re-read to report the correct reason. `attemptCount` is incremented
    // here (a FOUND row that failed to corroborate), which is the per-token
    // defence-in-depth layer alongside the pre-resolution IP rate limit in
    // `lib/api/handler.ts`/`lib/consent/rate-limit.ts`.
    const latest = await db.consentVerificationChallenge.update({
      where: { id: challenge.id },
      data: { attemptCount: { increment: 1 } },
      include: { parentalConsent: { select: { verifiedAt: true } } },
    });

    if (latest.parentalConsent.verifiedAt !== null) {
      // A concurrent verify won the race.
      return { ok: true, consentId: latest.parentalConsentId, evidenceRef: latest.id };
    }
    if (latest.consumedAt !== null) {
      // Consumed without ever being verified — it was declined.
      return { ok: false, code: "ALREADY_USED" };
    }
    return { ok: false, code: "EXPIRED" };
  },
};

/**
 * The public, session-free confirmation page (ADR-0008 §5): renders two
 * explicit controls, "Yes, I consent" (POSTs to `/api/consent/verify`) and
 * "This was not me" (POSTs to `/api/consent/decline`) — never a mutating
 * GET. Both controls live on the SAME page
 * (`app/(public)/consent/verify/[token]/page.tsx`, frontend track, out of
 * this task's scope); `decline: true` only changes which control the page
 * highlights by default when opened from the decline link in the email.
 * This query-parameter convention is the interface point the frontend page
 * needs to match — see the backend-engineer report for this milestone.
 */
function buildConsentPageUrl(token: string, opts?: { decline?: boolean }): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const url = new URL(`/consent/verify/${encodeURIComponent(token)}`, base);
  if (opts?.decline) url.searchParams.set("action", "decline");
  return url.toString();
}
