import "server-only";

import { db } from "@/lib/db";
import type { DeletionKind } from "@/lib/generated/prisma/enums";
import type { StoragePort } from "@/lib/storage/port";
import { hashAdultIdentity } from "@/lib/consent/audit";
import { CONSENT_AUDIT_RETENTION_DAYS } from "@/lib/config";

/**
 * `deleteStudentData(studentProfileId, kind)` — ADR-0007 §4: "There is
 * exactly one function that destroys a student's data." Three callers use
 * it:
 *
 *   (a) `DELETE /api/students/[studentId]`                       kind = PROFILE_DELETED
 *   (b) `POST /api/students/[studentId]/data-deletion`           kind = PARENTAL_DELETION_REQUEST
 *   (c) `GET /api/cron/purge-closed-accounts` (B22/23, not yet built) kind = ACCOUNT_CLOSURE
 *
 * The differences between the three are which rows are in scope, what the
 * confirmation copy promises, and whether anything is queued — NEVER the
 * destruction itself (ADR-0007 §4). This function is the destruction.
 *
 * Order, per ADR-0007 §1, always blobs-then-rows:
 *
 *   1. Read the pathnames to be removed — every `Upload` row for this
 *      profile, REGARDLESS of `status`. `SOURCE_DELETED` records only that a
 *      removal attempt was made, not that the bytes are confirmed gone, so
 *      it must never be the filter that decides which objects this function
 *      asks `storage` to delete. (An earlier version of this function *did*
 *      filter step 1 on `status: { not: "SOURCE_DELETED" }` — the same
 *      clause step 2 writes. That made retrying after a `STORAGE_FAILURE`
 *      actively harmful: the second call's step 1 found zero rows, skipped
 *      steps 2/3 entirely, and fell through to step 4, destroying the
 *      `Upload` rows with their blobs never actually deleted — an orphan,
 *      the exact failure this ordering exists to prevent. See the
 *      regression test in `tests/unit/lib/deletion/service.test.ts`.) While
 *      the `StudentProfile` row still exists, the full pathname set is
 *      always re-derivable from it, so re-reading it unfiltered on every
 *      call is cheap and correct.
 *   2. Mark the not-yet-`SOURCE_DELETED` `Upload` rows `SOURCE_DELETED` and
 *      commit, so the UI is honest the instant deletion starts — a reader
 *      mid-deletion sees "source file removed", never a live upload whose
 *      bytes are already gone. A retry only re-stamps rows a prior attempt
 *      hadn't already marked; already-marked rows are left as they are.
 *   3. `storage.del(pathnames)`, called with the FULL set read in step 1 —
 *      including any pathname already marked `SOURCE_DELETED` by a prior,
 *      failed call, or already removed by `enforce-retention` under its own
 *      retention window. This relies on `StoragePort.del()` being
 *      idempotent for objects that no longer exist (a reasonable
 *      requirement of any implementation, and one `enforce-retention`
 *      already relies on too).
 *   4. Only once (3) has succeeded: pseudonymise every `ParentalConsent`
 *      row into a `ConsentAuditArtifact` (ADR-0007 §6, AC 50), write the
 *      `DeletionAudit` row, then delete the database rows and let cascades
 *      take the descendants (notices, uploads, extractions, problems).
 *
 * If step 3 fails, the function returns `{ ok: false, code:
 * "STORAGE_FAILURE" }` WITHOUT touching any row from step 4 onward — the
 * `Upload` rows marked `SOURCE_DELETED` in step 2 are left in place, and NO
 * row is destroyed. This is genuinely retry-safe: because step 1 never
 * filters on `SOURCE_DELETED`, calling this function again re-reads the same
 * full pathname set and re-attempts `storage.del()` against it — nothing is
 * silently dropped because an earlier attempt already marked it. That is a
 * dangling reference (visible: renders as "source file removed"; harmless;
 * retryable) rather than an orphan (a blob with no row, invisible and
 * undeletable) — ADR-0007 §1's accepted trade-off. Callers MUST map
 * `STORAGE_FAILURE` to `502 UPSTREAM_ERROR` and must NOT retry the
 * destructive half automatically.
 *
 * `storage` is taken as a parameter, never imported concretely — no
 * `StoragePort` implementation exists yet (pending B15,
 * `lib/storage/vercel-blob.ts`). This also makes the ordering above
 * unit-testable against a fake (`tests/unit/lib/deletion/service.test.ts`).
 */

export type DeleteStudentDataResult = { ok: true } | { ok: false; code: "STORAGE_FAILURE" };

export async function deleteStudentData(
  studentProfileId: string,
  kind: DeletionKind,
  storage: StoragePort,
): Promise<DeleteStudentDataResult> {
  // Step 1 — read every pathname for this profile, unfiltered by `status`.
  // See the docstring above: filtering this query the same way step 2 marks
  // rows is the bug this function once had (orphans blobs on retry).
  // `storage.del()` is required to tolerate an already-gone object, so
  // reading the full set on every call — including on a retry — is safe.
  const uploads = await db.upload.findMany({
    where: { studentProfileId },
    select: { pathname: true },
  });
  const pathnames = Array.from(new Set(uploads.map((upload) => upload.pathname)));

  if (pathnames.length > 0) {
    // Step 2 — mark + commit BEFORE the blob deletion call, so a reader in
    // between sees an honest "source file removed" rather than a live
    // upload whose bytes are already gone (ADR-0007 §1).
    await db.upload.updateMany({
      where: { studentProfileId, status: { not: "SOURCE_DELETED" } },
      data: { status: "SOURCE_DELETED", sourceDeletedAt: new Date() },
    });

    // Step 3.
    try {
      await storage.del(pathnames);
    } catch (err) {
      // Never surface the exception message (M1 AC 24) — the caller maps
      // this code to the fixed 502 UPSTREAM_ERROR message. Rows above are
      // already committed as SOURCE_DELETED and nothing below has run:
      // dangling reference, not orphan, and retryable.
      console.error(
        `deleteStudentData: storage.del failed for studentProfileId=${studentProfileId}; ` +
          "Upload rows retained as SOURCE_DELETED for retry, no rows destroyed.",
        err,
      );
      return { ok: false, code: "STORAGE_FAILURE" };
    }
  }

  // Step 4 — rows. Everything from here on is one transaction: the
  // pseudonymised evidence and the `DeletionAudit` row are written BEFORE
  // the rows they describe are destroyed (ADR-0007 §4/§6).
  await db.$transaction(async (tx) => {
    // ADR-0007 §6 / AC 50: `ParentalConsent` cascades from `StudentProfile`,
    // so it must be read and pseudonymised here, before it is gone.
    const consents = await tx.parentalConsent.findMany({
      where: { studentProfileId },
    });

    if (consents.length > 0) {
      // The adult's email — not their opaque `userId` — is what makes the
      // pseudonym meaningful (ADR-0007 §6): the same adult consenting again
      // for a different child hashes to the same value.
      const userIds = Array.from(new Set(consents.map((consent) => consent.userId)));
      const users = await tx.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true },
      });
      const emailByUserId = new Map(users.map((user) => [user.id, user.email]));
      const purgeAfter = new Date(Date.now() + CONSENT_AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

      await tx.consentAuditArtifact.createMany({
        data: consents.map((consent) => ({
          consentTextVersion: consent.consentTextVersion,
          noticeVersion: consent.noticeVersion,
          method: consent.method,
          submittedAt: consent.submittedAt,
          verifiedAt: consent.verifiedAt,
          withdrawnAt: consent.withdrawnAt,
          adultIdentityHash: hashAdultIdentity(emailByUserId.get(consent.userId) ?? consent.userId),
          purgeAfter,
        })),
      });

      // Deleted explicitly, ahead of the `StudentProfile` cascade, rather
      // than left to it — see
      // `tests/integration/student-delete-cascade.test.ts` for why this is
      // safe either way, and why doing it explicitly is still preferred:
      // it keeps "read the evidence, then destroy it" one visible,
      // intentional step rather than an implicit side effect of
      // `studentProfile.delete()`.
      await tx.parentalConsent.deleteMany({ where: { studentProfileId } });
    }

    // `DeletionAudit` has no foreign key (ADR-0007 §4) — written in the same
    // transaction as, but never cascading with, the rows it survives.
    await tx.deletionAudit.create({
      data: {
        kind,
        subjectRef: studentProfileId,
        completedAt: new Date(),
      },
    });

    // Cascades take the descendants: DirectNotice, Upload (and its
    // Extraction/ExtractedProblem rows), UploadTokenGrant.
    await tx.studentProfile.delete({ where: { id: studentProfileId } });
  });

  return { ok: true };
}
