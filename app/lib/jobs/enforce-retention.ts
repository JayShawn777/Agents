import "server-only";

import { db } from "@/lib/db";
import type { StoragePort } from "@/lib/storage/port";
import type { Clock } from "@/lib/jobs/clock";
import {
  CHAT_TRANSCRIPT_RETENTION_DAYS,
  VOICE_SAMPLE_RETENTION_DAYS,
  VOICE_CONSENT_RECORDING_RETENTION_DAYS,
  SOURCE_FILE_RETENTION_DAYS_AFTER_EXTRACTION,
  DELETION_AUDIT_RETENTION_DAYS,
  RETENTION_POLICY,
} from "@/lib/config";

/**
 * `GET /api/cron/enforce-retention` (endpoint 27, ADR-0007 §5, M0 AC 45 /
 * M1 AC 36) — walks `RETENTION_POLICY`, the one table that also renders the
 * public `/retention` page (AC 44), so the published policy can never
 * describe a window this job doesn't enforce.
 *
 * `byCategory` keys, and which `RETENTION_POLICY.key` each corresponds to:
 *
 *   - `SOURCE_FILE`   — two independent triggers delete the BLOB only (the
 *     `Upload` row, `Extraction` and `ExtractedProblem` rows all survive —
 *     M1 AC 36):
 *       (a) `extractedAt` set and `SOURCE_FILE_RETENTION_DAYS_AFTER_EXTRACTION`
 *           has elapsed since — the anchor is extraction success, never
 *           `createdAt` (plan §7).
 *       (b) the upload's extraction terminally `FAILED` — deleted with NO
 *           window at all (ADR-0007 §5: "deleted on the next run"), since a
 *           permanently failed extraction has nothing left to confirm
 *           against and the photo serves no further purpose.
 *   - `CONSENT_PSEUDONYM` — `ConsentAuditArtifact` rows past `purgeAfter`.
 *   - `DELETION_AUDIT` — `DeletionAudit` rows whose `completedAt` is older
 *     than `DELETION_AUDIT_RETENTION_DAYS`.
 *   - `DIRECT_NOTICE` — see the NOTE below. Always `0`.
 *
 * `EXTRACTED_TEXT`, `PROFILE_FIELDS`, `CONSENT_FULL` and `ACCOUNT_SESSION`
 * have `windowDays: null` ("life of the ACTIVE profile" / event-driven) and
 * correctly have no step here. `PRE_CONSENT` and `CLOSED_ACCOUNT` are
 * windowed but are enforced by `purge-pre-consent.ts` and
 * `purge-closed-accounts.ts` respectively, not here — `tests/unit/lib/jobs/
 * retention-policy-coverage.test.ts` asserts every windowed key has SOME
 * job step, across all four jobs, not necessarily this one.
 *
 * Beyond `RETENTION_POLICY` itself, per plan §3 endpoint 27's own
 * description, this job also expires unconsumed `ConsentVerificationChallenge`
 * rows (`consumedAt IS NULL AND expiresAt < now`) — reported under
 * `byCategory.CONSENT_CHALLENGE_EXPIRED`, a key with no `RETENTION_POLICY`
 * entry of its own because it isn't a data-retention window, it's a
 * security TTL (`CONSENT_CHALLENGE_TTL_HOURS`) on a credential.
 *
 * ── NOTE / PLAN GAP, flagged rather than silently worked around ──
 * `RETENTION_POLICY`'s `DIRECT_NOTICE` entry names `anchor: 'deletedAt'`,
 * but `DirectNotice` (`prisma/schema.prisma`) has no `deletedAt` column, and
 * the row is `onDelete: Cascade` from `StudentProfile` — it cannot outlive
 * the profile the way `DeletionAudit`/`ConsentAuditArtifact` are designed
 * to (no foreign key, by design, ADR-0007 §4/§6). There is therefore no
 * query this job could run that matches the stated anchor. This function
 * reports `DIRECT_NOTICE: 0` unconditionally rather than inventing a field
 * or a query against a column that doesn't exist — see this task's report
 * for the recommendation (either a real post-deletion notice-evidence
 * artifact, mirroring `ConsentAuditArtifact`, or removing the anchor from
 * the plan/schema table if `DirectNotice` was never meant to survive
 * deletion).
 */

export type EnforceRetentionResult = {
  byCategory: Record<string, number>;
};

export async function enforceRetention(storage: StoragePort, clock: Clock): Promise<EnforceRetentionResult> {
  const now = clock();

  // ── SOURCE_FILE ──
  // Retry-safety note: unlike `deleteStudentData` (`lib/deletion/service.ts`,
  // B13), which marks `Upload.status = SOURCE_DELETED` BEFORE calling
  // `storage.del()` — appropriate there because a concurrent page load
  // during an interactive, user-initiated deletion must never show a live
  // upload whose bytes are already gone — this is a silent background
  // sweep with no concurrent reader to keep honest mid-flight. Marking rows
  // SOURCE_DELETED before a storage.del() failure would permanently remove
  // them from every future run's `status: { not: 'SOURCE_DELETED' }`
  // selection, without the blob ever actually having been deleted — a real
  // orphan (object with no future deletion path), not the accepted
  // "dangling row" trade-off. So here the order is reversed: call
  // `storage.del()` FIRST, and only mark rows on success. A thrown error
  // leaves every row exactly as `enforceRetention` found it, so the next
  // scheduled run selects the identical set and retries.
  const extractedCutoff = new Date(
    now.getTime() - SOURCE_FILE_RETENTION_DAYS_AFTER_EXTRACTION * 24 * 60 * 60 * 1000,
  );

  const [expiredByAge, expiredByFailure] = await Promise.all([
    db.upload.findMany({
      where: { status: { not: "SOURCE_DELETED" }, extractedAt: { not: null, lte: extractedCutoff } },
      select: { id: true, pathname: true },
    }),
    db.upload.findMany({
      where: { status: { not: "SOURCE_DELETED" }, extraction: { status: "FAILED" } },
      select: { id: true, pathname: true },
    }),
  ]);

  const sourceFilesById = new Map<string, string>();
  for (const upload of [...expiredByAge, ...expiredByFailure]) {
    sourceFilesById.set(upload.id, upload.pathname);
  }

  let sourceFileCount = 0;
  if (sourceFilesById.size > 0) {
    const ids = [...sourceFilesById.keys()];
    const pathnames = [...sourceFilesById.values()];
    await storage.del(pathnames);
    const result = await db.upload.updateMany({
      where: { id: { in: ids } },
      data: { status: "SOURCE_DELETED", sourceDeletedAt: now },
    });
    sourceFileCount = result.count;
  }

  // ── CONSENT_PSEUDONYM ── ConsentAuditArtifact rows past purgeAfter.
  const pseudonymResult = await db.consentAuditArtifact.deleteMany({
    where: { purgeAfter: { lte: now } },
  });

  // ── DELETION_AUDIT ── DeletionAudit rows completed long enough ago.
  const auditCutoff = new Date(now.getTime() - DELETION_AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const auditResult = await db.deletionAudit.deleteMany({
    where: { completedAt: { not: null, lte: auditCutoff } },
  });

  // ── CHAT_TRANSCRIPT ── whole sessions past their window; ChatMessage rows
  // cascade from ChatSession, so deleting the session is the whole step.
  //
  // Anchored on `openedAt` rather than `closedAt`: a session abandoned mid
  // conversation may never be closed at all, and anchoring on a column that can
  // stay null forever is how a retention window quietly becomes infinite.
  const chatCutoff = new Date(now.getTime() - CHAT_TRANSCRIPT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const chatResult = await db.chatSession.deleteMany({
    where: { openedAt: { lte: chatCutoff } },
  });

  // ── VOICE_SAMPLE ── M6. The raw recording of an account owner's voice.
  //
  // The happy path deletes this inline the moment vendor creation succeeds
  // (`VOICE_SAMPLE_RETENTION_DAYS` is 0), so this sweep exists for the samples
  // that inline deletion never reached: a creation that failed after upload, a
  // function killed between the vendor call and the delete, a row whose blob
  // delete threw. Without it those are permanent, and this is the most
  // sensitive object the application holds.
  //
  // BLOBS FIRST, then the column — the opposite direction to
  // `purgeUnreferencedNarration`, and deliberately so. There the risk was a live
  // row pointing at deleted audio; here nothing reads `samplePathname` except
  // this sweep, and the failure that matters is bytes of a real person's voice
  // outliving their retention row. If the blob delete throws, the column is left
  // set and the next run tries again.
  const sampleCutoff = new Date(now.getTime() - VOICE_SAMPLE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const staleSamples = await db.customVoice.findMany({
    where: { samplePathname: { not: null }, createdAt: { lte: sampleCutoff } },
    select: { id: true, samplePathname: true },
  });
  let voiceSampleCount = 0;
  if (staleSamples.length > 0) {
    await storage.del(staleSamples.map((row) => row.samplePathname as string));
    const cleared = await db.customVoice.updateMany({
      where: { id: { in: staleSamples.map((row) => row.id) } },
      data: { samplePathname: null, sampleDeletedAt: now },
    });
    voiceSampleCount = cleared.count;
  }

  // ── VOICE_CONSENT_RECORDING ── M6. The account owner saying aloud that they
  // consented. Kept far longer than the sample, because the question it answers
  // — "was this authorised" — outlives the voice it authorised.
  //
  // Deleting the row leaves the `ParentalConsent` row it references untouched:
  // that relation is `Restrict` in the other direction, and the consent record
  // has its own published window. What expires here is the AUDIO, not the fact
  // that consent was given.
  const consentAudioCutoff = new Date(
    now.getTime() - VOICE_CONSENT_RECORDING_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  const staleConsentAudio = await db.voiceConsentRecording.findMany({
    where: { createdAt: { lte: consentAudioCutoff } },
    select: { id: true, pathname: true },
  });
  let voiceConsentCount = 0;
  if (staleConsentAudio.length > 0) {
    await storage.del(staleConsentAudio.map((row) => row.pathname));
    const deleted = await db.voiceConsentRecording.deleteMany({
      where: { id: { in: staleConsentAudio.map((row) => row.id) } },
    });
    voiceConsentCount = deleted.count;
  }

  // ── Unconsumed consent challenges (endpoint 27's extra scope, not a
  // RETENTION_POLICY entry — see docstring). ──
  const challengeResult = await db.consentVerificationChallenge.deleteMany({
    where: { consumedAt: null, expiresAt: { lte: now } },
  });

  return {
    byCategory: {
      SOURCE_FILE: sourceFileCount,
      // Always 0 — see the NOTE in the docstring above.
      DIRECT_NOTICE: 0,
      CONSENT_PSEUDONYM: pseudonymResult.count,
      DELETION_AUDIT: auditResult.count,
      CHAT_TRANSCRIPT: chatResult.count,
      VOICE_SAMPLE: voiceSampleCount,
      VOICE_CONSENT_RECORDING: voiceConsentCount,
      CONSENT_CHALLENGE_EXPIRED: challengeResult.count,
    },
  };
}

/**
 * Every `RETENTION_POLICY` key this app currently ships. Referenced by
 * `tests/unit/lib/jobs/retention-policy-coverage.test.ts` so the assertion
 * "every windowed category has a corresponding job step and vice versa"
 * (plan §7) can be written once against a real export rather than a copy of
 * the table pasted into a test file.
 */
export const RETENTION_POLICY_KEYS = RETENTION_POLICY.map((entry) => entry.key);
