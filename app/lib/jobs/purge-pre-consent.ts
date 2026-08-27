import "server-only";

import { db } from "@/lib/db";
import type { StoragePort } from "@/lib/storage/port";
import type { Clock } from "@/lib/jobs/clock";
import { PRE_CONSENT_PURGE_DAYS } from "@/lib/config";

/**
 * `GET /api/cron/purge-pre-consent` (endpoint 25, ADR-0007 §5, M0 AC 22/23).
 *
 * Holding a child's age band indefinitely because a parent abandoned the
 * notice-and-consent flow is itself the violation this job exists to close
 * (M0 AC 22): a `StudentProfile` that never reaches `ACTIVE` — and has not
 * been `CONSENT_WITHDRAWN`, which is a post-consent state governed by the
 * deletion paths, not this window — is purged once it is older than
 * `PRE_CONSENT_PURGE_DAYS`. Shortening that window in config widens the
 * sweep on the very next run (AC 23), because the query filters on
 * `status`/`createdAt` directly rather than caching an expiry date anywhere.
 *
 * Per ADR-0007 §5, what gets deleted for each such profile is "the profile,
 * its age band, its `DirectNotice` rows, its unverified `ParentalConsent`
 * rows, its `ConsentVerificationChallenge` rows, and any blob under its
 * pathname prefix":
 *
 *   - The blob half is enumerated by STORE PREFIX
 *     (`students/<id>/uploads/`), not by joining `Upload` rows — a
 *     pre-consent profile cannot legitimately have a confirmed upload (the
 *     upload-token route requires `ACTIVE`), so relying on `Upload` rows
 *     here would miss exactly the stray-bytes-no-row case ADR-0007 as a
 *     whole is about. `storage.listAll(prefix)` is the only call that can
 *     see it.
 *   - The row half is a plain `studentProfile.delete()`: every child table
 *     in the schema (`DirectNotice`, `ParentalConsent` — which itself
 *     cascades `ConsentVerificationChallenge` — `Upload`, `UploadTokenGrant`)
 *     is `onDelete: Cascade` from `StudentProfile`, so one delete removes
 *     everything ADR-0007 §5 names.
 *
 * DELIBERATE DEVIATION from `deleteStudentData` (`lib/deletion/service.ts`):
 * this job does NOT write a `ConsentAuditArtifact` for any unverified
 * `ParentalConsent` row it finds. `deleteStudentData`'s pseudonymisation
 * exists to preserve evidence that *valid* consent was obtained (ADR-0007
 * §6) — an unverified row is exactly the opposite of that, and AC 22
 * requires "any other data collected for the purpose of obtaining consent"
 * to be gone, not preserved in pseudonymised form. See this task's report
 * for why `deleteStudentData` was not reused here.
 *
 * Blob-before-row ordering (ADR-0007 §1) still applies per profile: if
 * `storage.del()` fails for a profile's objects, that profile's rows are
 * left untouched entirely and retried on the next run — never partially
 * purged.
 */

export type PurgePreConsentResult = {
  profilesPurged: number;
  blobsDeleted: number;
};

export async function purgePreConsent(storage: StoragePort, clock: Clock): Promise<PurgePreConsentResult> {
  const now = clock();
  const cutoff = new Date(now.getTime() - PRE_CONSENT_PURGE_DAYS * 24 * 60 * 60 * 1000);

  // AC 22, second half: a profile that reached ACTIVE is never touched by
  // this job, whatever its age. CONSENT_WITHDRAWN is excluded too — it is a
  // POST-consent state (ADR-0007 §5): the data was lawfully collected, and
  // its deletion is governed by the closure/§312.6/profile-delete paths,
  // not by the pre-consent window.
  const profiles = await db.studentProfile.findMany({
    where: {
      status: { notIn: ["ACTIVE", "CONSENT_WITHDRAWN"] },
      createdAt: { lte: cutoff },
    },
    select: { id: true },
  });

  let profilesPurged = 0;
  let blobsDeleted = 0;

  for (const profile of profiles) {
    const prefix = `students/${profile.id}/uploads/`;
    const pathnames: string[] = [];
    for await (const obj of storage.listAll(prefix)) {
      pathnames.push(obj.pathname);
    }

    if (pathnames.length > 0) {
      try {
        await storage.del(pathnames);
      } catch (err) {
        // ADR-0007 §1: never delete rows unless the blobs are confirmed
        // gone. This profile is skipped entirely and retried next run.
        console.error(
          `purgePreConsent: storage.del failed for studentProfileId=${profile.id}; profile retained for retry.`,
          err,
        );
        continue;
      }
      blobsDeleted += pathnames.length;
    }

    await db.$transaction(async (tx) => {
      // No foreign key (ADR-0007 §4) — survives the purge it records.
      await tx.deletionAudit.create({
        data: { kind: "PRE_CONSENT_PURGE", subjectRef: profile.id, completedAt: now },
      });
      await tx.studentProfile.delete({ where: { id: profile.id } });
    });
    profilesPurged += 1;
  }

  return { profilesPurged, blobsDeleted };
}
