import "server-only";

import { db } from "@/lib/db";
import { deleteStudentData } from "@/lib/deletion/service";
import { deleteAllCustomVoicesForUser } from "@/lib/voice/delete";
import type { StoragePort } from "@/lib/storage/port";
import type { Clock } from "@/lib/jobs/clock";
import { ACCOUNT_CLOSURE_RECOVERY_DAYS } from "@/lib/config";

/**
 * `GET /api/cron/purge-closed-accounts` (endpoint 26, ADR-0007 §4(c),
 * M0 AC 47) — the third caller of `deleteStudentData`, alongside `DELETE
 * /api/students/[studentId]` (`PROFILE_DELETED`) and `POST
 * /api/students/[studentId]/data-deletion` (`PARENTAL_DELETION_REQUEST`).
 *
 * `POST /api/account/closure` only ever sets `User.closureRequestedAt`,
 * kills sessions, and writes a `DeletionAudit { kind: ACCOUNT_CLOSURE }`
 * row with `completedAt: null` — it never destroys anything itself. This
 * job finds every `User` whose `closureRequestedAt` is at least
 * `ACCOUNT_CLOSURE_RECOVERY_DAYS` old and, for each one:
 *
 *   1. Calls `deleteStudentData(profileId, "ACCOUNT_CLOSURE", storage)` for
 *      EVERY `StudentProfile` the user owns. This is what actually runs the
 *      blob-first destruction (ADR-0007 §1) — a plain cascading
 *      `db.user.delete()` would drop the rows without ever touching
 *      storage, creating exactly the orphans ADR-0007 exists to prevent.
 *   2. Only if every profile's destruction reports `{ ok: true }`: stamps
 *      `completedAt` on the EXISTING account-level `DeletionAudit` row
 *      (`subjectRef: userId, kind: ACCOUNT_CLOSURE, completedAt: null`) —
 *      this job never creates that row, only finishes it — and deletes the
 *      `User` row itself (cascading `Account`/`Session`, both already empty
 *      or irrelevant by this point).
 *   3. If ANY profile reports `STORAGE_FAILURE`, the user is left exactly
 *      as-is — no audit stamp, no `User` deletion — and is picked up again
 *      on the next run. Profiles already destroyed in a prior partial run
 *      are simply absent from `studentProfile.findMany` the next time, so
 *      re-running this function for the same user is safe.
 *
 * **Inherited reading, not re-derived here:** `deleteStudentData` writes its
 * OWN per-profile `DeletionAudit` (`subjectRef: studentProfileId`) and any
 * `ConsentAuditArtifact` rows inside the same transaction as the row
 * deletes — after the blob phase, not before it. That ordering was fixed by
 * B13 (`lib/deletion/service.ts`) and is unchanged here; this job's own
 * account-level audit stamp (step 2) is a SEPARATE row at a different
 * granularity (per-user vs. per-profile) and does not change that reading.
 * Nothing about applying it to the closure path looked wrong on inspection
 * — flagged per this task's brief rather than silently assumed correct.
 */

export type PurgeClosedAccountsResult = {
  purged: number;
};

export async function purgeClosedAccounts(storage: StoragePort, clock: Clock): Promise<PurgeClosedAccountsResult> {
  const now = clock();
  const cutoff = new Date(now.getTime() - ACCOUNT_CLOSURE_RECOVERY_DAYS * 24 * 60 * 60 * 1000);

  const users = await db.user.findMany({
    where: { closureRequestedAt: { not: null, lte: cutoff } },
    // `email` is read here, in the query that already runs, rather than by a
    // second lookup per user: it is needed for M6 AC 20's audit pseudonym below.
    select: { id: true, email: true },
  });

  let purged = 0;

  for (const user of users) {
    const profiles = await db.studentProfile.findMany({
      where: { userId: user.id },
      select: { id: true },
    });

    let allProfilesDestroyed = true;
    for (const profile of profiles) {
      const result = await deleteStudentData(profile.id, "ACCOUNT_CLOSURE", storage);
      if (!result.ok) {
        allProfilesDestroyed = false;
        console.error(
          `purgeClosedAccounts: deleteStudentData failed for studentProfileId=${profile.id} ` +
            `(userId=${user.id}); user retained for retry.`,
        );
        break;
      }
    }

    if (!allProfilesDestroyed) continue;

    // M6 AC 20 — BEFORE `user.delete` below, which cascades the Persona and
    // CustomVoice rows and would take the `providerVoiceId` with them, leaving a
    // model of a real adult's voice at the vendor that nothing in our system can
    // name. A vendor failure does not hold up the purge: it writes a
    // VENDOR_DELETE_FAILED audit row, which survives this deletion because
    // VoiceCreationAudit has no foreign keys.
    await deleteAllCustomVoicesForUser(storage, { userId: user.id, userEmail: user.email });

    await db.$transaction(async (tx) => {
      // This row was written by POST /api/account/closure at request time
      // with `completedAt: null` — this job only ever finishes it, never
      // creates it (see docstring above).
      await tx.deletionAudit.updateMany({
        where: { subjectRef: user.id, kind: "ACCOUNT_CLOSURE", completedAt: null },
        data: { completedAt: now },
      });
      // Every StudentProfile this user owned is already gone (via
      // deleteStudentData above); Account/Session cascade harmlessly.
      await tx.user.delete({ where: { id: user.id } });
    });
    purged += 1;
  }

  return { purged };
}
