import "server-only";

import { headers } from "next/headers";

import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import type { ParentalConsent, StudentProfile } from "@/lib/generated/prisma/client";
import { CONSENT_TEXT_VERSION } from "@/lib/config";
import { DIRECT_NOTICE_VERSION } from "@/lib/notice/copy";
import { getConsentMethodProvider } from "@/lib/consent/methods/registry";
import { hashConsentToken } from "@/lib/consent/token";
import type { SubmitConsentInput } from "@/lib/schemas/consent";

/**
 * Endpoints 8-12 (plan §3.2): `submitConsent`, `verifyConsent`,
 * `declineConsent`, `withdrawConsent`. Per this milestone's brief:
 * **this is the only module in the codebase permitted to `UPDATE
 * parental_consent`, and the only mutation it ever performs is the
 * conditional `verified_at IS NULL` stamp** (ADR-0007 §3). That single
 * statement lives in ONE place — `stampVerifiedAndActivate` below — called
 * from both `submitConsent` (for a hypothetical synchronous method,
 * ADR-0008 §3) and `verifyConsent` (the `EMAIL_PLUS` path), so there is
 * exactly one line of code in the entire app that can ever run it.
 * `tests/unit/lib/consent/append-only-guard.test.ts` greps the source tree
 * for any OTHER `parentalConsent.update`/`updateMany` call and fails the
 * suite if one is ever added.
 *
 * `declineConsent` never touches `ParentalConsent` at all — it only reads
 * and consumes `ConsentVerificationChallenge` (AC 21: a decline persists no
 * consent field, no display name, no grade level, no subject, no avatar).
 * `withdrawConsent` never mutates an existing row — it only appends
 * (AC 24).
 */

async function readRequestContext(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  const headerList = await headers();
  return {
    ipAddress: headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: headerList.get("user-agent"),
  };
}

// ─────────────────────────── submitConsent (#8) ───────────────────────────

export type SubmitConsentResult =
  | { ok: true; student: StudentProfile; consent: ParentalConsent }
  | {
      ok: false;
      /**
       * `ALREADY_ACTIVE` / `NOTICE_MISMATCH` / `STALE_CONSENT_TEXT_VERSION`
       * all map to the contract's 409 `CONFLICT` — a version the client
       * holds is stale, or the profile is already past this step, and the
       * fix is another request, never a schema-shaped 400 (AC 15, AC 17,
       * plan §3 endpoint 8).
       */
      code: "ALREADY_ACTIVE" | "NOTICE_MISMATCH" | "STALE_CONSENT_TEXT_VERSION";
    };

export async function submitConsent(args: {
  student: StudentProfile;
  userId: string;
  userEmail: string;
  input: SubmitConsentInput;
}): Promise<SubmitConsentResult> {
  const { student, userId, userEmail, input } = args;

  // Defence in depth: the route's own `requireFlow` already refuses an
  // ACTIVE profile before the body is even parsed (AC 11-style ordering),
  // but `submitConsent` must be safe to call directly (e.g. from a test)
  // without depending on that.
  if (student.status === "ACTIVE") {
    return { ok: false, code: "ALREADY_ACTIVE" };
  }

  // AC 15/17: the referenced notice must exist for THIS profile, and its
  // version — both what the client claims (`input.noticeVersion`) and what
  // is actually on the row — must match the currently-deployed copy. A
  // mismatch here means the parent read stale notice content and must be
  // sent back to re-render it.
  const notice = await db.directNotice.findFirst({
    where: { id: input.directNoticeId, studentProfileId: student.id },
  });
  if (
    !notice ||
    notice.noticeVersion !== input.noticeVersion ||
    notice.noticeVersion !== DIRECT_NOTICE_VERSION
  ) {
    return { ok: false, code: "NOTICE_MISMATCH" };
  }

  if (input.consentTextVersion !== CONSENT_TEXT_VERSION) {
    return { ok: false, code: "STALE_CONSENT_TEXT_VERSION" };
  }

  const { ipAddress, userAgent } = await readRequestContext();

  // `input.method` is already `.refine()`d === the configured `CONSENT_METHOD`
  // at the zod boundary (`lib/schemas/consent.ts`) — looked up from the body,
  // never re-read from configuration here, so the SUBMITTED method (which
  // will be permanently recorded on the row) is what dispatches, not a
  // second, possibly-stale read of `CONSENT_METHOD`.
  const provider = getConsentMethodProvider(input.method);

  const { consent, student: updatedStudent } = await db.$transaction(async (tx) => {
    // APPEND (AC 17): `verifiedAt` defaults to null, `methodEvidence`
    // defaults to null — never set here.
    const created = await tx.parentalConsent.create({
      data: {
        studentProfileId: student.id,
        userId,
        directNoticeId: notice.id,
        noticeVersion: notice.noticeVersion,
        consentingAdultName: input.consentingAdultName,
        relationship: input.relationship,
        scopes: input.scopes,
        consentTextVersion: input.consentTextVersion,
        method: input.method,
        ipAddress,
        userAgent,
      },
    });

    // ADR-0008 §3: runs inside the SAME transaction as the insert above.
    const beginResult = await provider.begin({
      parentalConsentId: created.id,
      studentProfileId: student.id,
      userId,
      userEmail,
      consentingAdultName: input.consentingAdultName,
      methodInput: input.methodInput,
      ipAddress,
      userAgent,
    });

    if (beginResult.kind === "pending") {
      if (beginResult.challenge) {
        await tx.consentVerificationChallenge.create({
          data: {
            parentalConsentId: created.id,
            method: input.method,
            tokenHash: beginResult.challenge.tokenHash,
            expiresAt: beginResult.challenge.expiresAt,
          },
        });
      }
      // AC 18: leaves `verifiedAt` null; the profile moves to
      // `CONSENT_PENDING`, never `ACTIVE`, regardless of `evidenceRef` — see
      // `stampVerifiedAndActivate`'s docstring for why a "pending" result's
      // `evidenceRef` is deliberately never written here.
      const pendingStudent = await tx.studentProfile.update({
        where: { id: student.id },
        data: { status: "CONSENT_PENDING" },
      });
      return { consent: created, student: pendingStudent };
    }

    // `kind === "verified"` — a method whose corroboration is synchronous
    // (ADR-0008 §3). EMAIL_PLUS never takes this branch (it always returns
    // "pending"); kept generic because the interface — not the one shipped
    // method — is what AC 16 asks this codebase to be built against.
    await stampVerifiedAndActivate(tx, {
      consentId: created.id,
      studentProfileId: student.id,
      submittedAt: created.submittedAt,
      evidenceRef: beginResult.evidenceRef,
    });
    const [finalConsent, activatedStudent] = await Promise.all([
      tx.parentalConsent.findUniqueOrThrow({ where: { id: created.id } }),
      tx.studentProfile.findUniqueOrThrow({ where: { id: student.id } }),
    ]);
    return { consent: finalConsent, student: activatedStudent };
  });

  return { ok: true, student: updatedStudent, consent };
}

// ─────────────────────────── the ONE permitted mutation ───────────────────────────

/**
 * ADR-0007 §3's single permitted `UPDATE parental_consent` statement:
 *
 *   UPDATE parental_consent
 *   SET verified_at = $1, method_evidence = $2
 *   WHERE id = $3 AND verified_at IS NULL
 *
 * expressed as Prisma's `updateMany` (the only way to express a `WHERE`
 * predicate beyond the primary key on an `update`). The `verified_at IS
 * NULL` guard makes this idempotent: a replayed provider callback or a
 * double-clicked confirmation link is a harmless no-op the second time
 * (`count === 0`), never a second stamp and never a visible error.
 *
 * `verifiedAt` is computed as `max(now, submittedAt + 1ms)` so AC 19's
 * "distinct from and no earlier than `submittedAt`" holds even for a method
 * whose corroboration completes inside the same millisecond it was
 * submitted.
 *
 * Every caller passes an `evidenceRef` — a REFERENCE only (a consumed
 * challenge id here; ADR-0008 §4), never a live credential — and it is
 * written ONLY together with `verifiedAt`, in this one statement. This is
 * also why `submitConsent`'s "pending" branch above never writes
 * `methodEvidence` on its own: recording evidence before verification would
 * be a second write path to the same column outside this guarded stamp.
 */
async function stampVerifiedAndActivate(
  tx: Prisma.TransactionClient,
  args: { consentId: string; studentProfileId: string; submittedAt: Date; evidenceRef: string },
): Promise<{ stamped: boolean }> {
  const verifiedAt = new Date(Math.max(Date.now(), args.submittedAt.getTime() + 1));

  const result = await tx.parentalConsent.updateMany({
    where: { id: args.consentId, verifiedAt: null },
    data: { verifiedAt, methodEvidence: args.evidenceRef },
  });

  if (result.count > 0) {
    await tx.studentProfile.update({
      where: { id: args.studentProfileId },
      data: { status: "ACTIVE", activatedAt: new Date() },
    });
    return { stamped: true };
  }
  return { stamped: false };
}

// ─────────────────────────── verifyConsent (#9) ───────────────────────────

export type VerifyConsentResult =
  | { ok: true; student: StudentProfile }
  | { ok: false; code: "NOT_FOUND" | "EXPIRED" | "ALREADY_USED" };

export async function verifyConsent(rawToken: string): Promise<VerifyConsentResult> {
  const tokenHash = hashConsentToken(rawToken);

  // A generic, method-agnostic pre-lookup ONLY to learn which provider's
  // `corroborate()` to dispatch to (ADR-0008 §6: a historical row may not
  // match the currently-configured `CONSENT_METHOD`). The provider redoes
  // its own hash+lookup+consume — see `email-plus.ts` — so this file never
  // touches `ConsentVerificationChallenge`'s mutable state itself.
  const challenge = await db.consentVerificationChallenge.findUnique({ where: { tokenHash } });
  if (!challenge) return { ok: false, code: "NOT_FOUND" };

  const provider = getConsentMethodProvider(challenge.method);
  const result = await provider.corroborate(rawToken);
  if (!result.ok) {
    if (result.code === "EXPIRED") return { ok: false, code: "EXPIRED" };
    if (result.code === "NOT_FOUND") return { ok: false, code: "NOT_FOUND" };
    // ALREADY_USED / REJECTED both mean "this token no longer grants anything".
    return { ok: false, code: "ALREADY_USED" };
  }

  const consent = await db.parentalConsent.findUniqueOrThrow({ where: { id: result.consentId } });

  const student = await db.$transaction(async (tx) => {
    await stampVerifiedAndActivate(tx, {
      consentId: consent.id,
      studentProfileId: consent.studentProfileId,
      submittedAt: consent.submittedAt,
      evidenceRef: result.evidenceRef,
    });
    return tx.studentProfile.findUniqueOrThrow({ where: { id: consent.studentProfileId } });
  });

  return { ok: true, student };
}

// ─────────────────────────── declineConsent (#10) ───────────────────────────

export type DeclineConsentResult = { ok: true } | { ok: false; code: "NOT_FOUND" | "EXPIRED" | "ALREADY_USED" };

/**
 * AC 21: declining (or abandoning) the flow must leave no verified record
 * and persist nothing about the child. This function therefore NEVER reads
 * or writes `ParentalConsent` — only `ConsentVerificationChallenge`, which
 * has no `StudentProfile` fields to leak. It is method-agnostic by
 * construction: there is no `decline()` on `ConsentMethodProvider`
 * (`lib/consent/methods/port.ts`) — declining is the same generic action
 * for every challenge-based method.
 */
export async function declineConsent(rawToken: string): Promise<DeclineConsentResult> {
  const tokenHash = hashConsentToken(rawToken);

  const challenge = await db.consentVerificationChallenge.findUnique({
    where: { tokenHash },
    include: { parentalConsent: { select: { verifiedAt: true } } },
  });
  if (!challenge) return { ok: false, code: "NOT_FOUND" };

  // Already verified — the profile is ACTIVE; a token cannot be declined
  // after the fact.
  if (challenge.parentalConsent.verifiedAt !== null) {
    return { ok: false, code: "ALREADY_USED" };
  }

  // Idempotent: declining an already-declined token is not an error.
  if (challenge.consumedAt !== null) {
    return { ok: true };
  }

  if (challenge.expiresAt.getTime() < Date.now()) {
    await db.consentVerificationChallenge.update({
      where: { id: challenge.id },
      data: { attemptCount: { increment: 1 } },
    });
    return { ok: false, code: "EXPIRED" };
  }

  // Atomic, guarded by `consumedAt IS NULL` to avoid a race with a
  // concurrent verify/decline.
  const consumed = await db.consentVerificationChallenge.updateMany({
    where: { id: challenge.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (consumed.count === 1) return { ok: true };

  // Lost the race — re-read to report the correct outcome.
  const latest = await db.consentVerificationChallenge.findUniqueOrThrow({
    where: { id: challenge.id },
    include: { parentalConsent: { select: { verifiedAt: true } } },
  });
  if (latest.parentalConsent.verifiedAt !== null) return { ok: false, code: "ALREADY_USED" };
  return { ok: true }; // concurrently declined too — idempotent.
}

// ─────────────────────────── withdrawConsent (#12) ───────────────────────────

export type WithdrawConsentResult = { ok: true; student: StudentProfile } | { ok: false; code: "NOT_ACTIVE" };

/**
 * AC 24: appends a new `ParentalConsent` row copying `method`, both version
 * fields and `scopes` from the row it supersedes, with `withdrawnAt` set and
 * `supersedesConsentId` pointing at it. The prior row is never written to —
 * only read. `StudentProfile.status` becomes `CONSENT_WITHDRAWN`.
 */
export async function withdrawConsent(args: {
  student: StudentProfile;
  userId: string;
}): Promise<WithdrawConsentResult> {
  const { student, userId } = args;
  if (student.status !== "ACTIVE") {
    return { ok: false, code: "NOT_ACTIVE" };
  }

  const { ipAddress, userAgent } = await readRequestContext();

  const updatedStudent = await db.$transaction(async (tx) => {
    const current = await tx.parentalConsent.findFirst({
      where: { studentProfileId: student.id },
      orderBy: { submittedAt: "desc" },
    });
    if (!current) {
      // An ACTIVE profile implies a verified consent row exists
      // (`stampVerifiedAndActivate` only activates alongside a successful
      // stamp) — this should be unreachable. Guard rather than silently
      // withdraw nothing.
      throw new Error(`ACTIVE student profile ${student.id} has no ParentalConsent row to withdraw.`);
    }

    // APPEND ONLY — `current` is never the target of a `.update()`/`.updateMany()`.
    await tx.parentalConsent.create({
      data: {
        studentProfileId: current.studentProfileId,
        userId,
        directNoticeId: current.directNoticeId,
        noticeVersion: current.noticeVersion,
        consentingAdultName: current.consentingAdultName,
        relationship: current.relationship,
        scopes: current.scopes,
        consentTextVersion: current.consentTextVersion,
        method: current.method,
        withdrawnAt: new Date(),
        supersedesConsentId: current.id,
        ipAddress,
        userAgent,
      },
    });

    return tx.studentProfile.update({
      where: { id: student.id },
      data: { status: "CONSENT_WITHDRAWN" },
    });
  });

  return { ok: true, student: updatedStudent };
}
