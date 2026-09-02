import "server-only";

import { db } from "@/lib/db";
import type { StoragePort } from "@/lib/storage/port";
import type { Clock } from "@/lib/jobs/clock";
import { ORPHAN_THRESHOLD_MINUTES, GRANT_PRUNE_AFTER_HOURS } from "@/lib/config";

/**
 * `GET /api/cron/reconcile-blobs` (endpoint 24, ADR-0007 §2, M0 AC 43 /
 * M1 AC 16).
 *
 * **This is the one control that enumerates the STORE, not the database.**
 * Every other deletion path in the app walks from a database row to a
 * pathname; that direction can never find an object the database has never
 * heard of — an upload whose bytes landed but whose confirming write
 * failed. `storage.listAll()` is the only call in the codebase that can see
 * that object, which is the entire reason this job exists rather than being
 * folded into `enforce-retention.ts`.
 *
 * Three independent things happen per run, matching ADR-0007 §2 exactly:
 *
 *   1. Page through every object in the store. Any pathname NO registered
 *      `BLOB_CLAIMANTS` entry claims, and older than
 *      `ORPHAN_THRESHOLD_MINUTES`, is an orphan and is deleted from
 *      storage. An object that ANY claimant recognises is left untouched,
 *      however old.
 *   2. Any `Upload` row still `PENDING` past the same threshold is flipped
 *      to `FAILED` — the confirm step never happened and never will, so the
 *      student should see a failed upload with a retry rather than a
 *      spinner forever.
 *   3. Any `UploadTokenGrant` row older than `GRANT_PRUNE_AFTER_HOURS` is
 *      deleted — its only job was bounding token issuance for the hourly
 *      cap (M1 AC 17), and it has long since stopped mattering for that.
 *
 * The threshold on (1) exists because an object legitimately in flight has
 * no owning row yet — e.g. an upload's bytes land in the store before the
 * confirm request that creates its `Upload` row ever arrives.
 *
 * ## M5 §7.1 — the finding this file's history records
 *
 * This job used to enumerate the WHOLE store and treat any pathname with no
 * matching `Upload` row as an orphan. That is correct for the upload prefix
 * and actively destructive for any other one: M5 writes narration audio
 * under `students/<id>/narration/...`, which has no `Upload` row by
 * construction, so the first cron run past `ORPHAN_THRESHOLD_MINUTES` after
 * the first narration object existed would have deleted every narration
 * object in the store while the `NarrationAsset` rows survived pointing at
 * nothing — every lesson then plays a 404, silently, with nothing failing
 * loudly enough to notice.
 *
 * `BLOB_CLAIMANTS` below is the fix: a registry of "does any OWNER claim
 * this pathname", not a single hard-coded table. An object is an orphan
 * only if NO claimant returns it. Adding a third blob-writing model (M6's
 * voice sample, most likely) is a new entry in this array, not an edit to
 * the orphan logic.
 */

export type ReconcileBlobsResult = {
  scanned: number;
  orphansDeleted: number;
  uploadsFailed: number;
  grantsPruned: number;
};

/**
 * How many pathnames from `storage.listAll()` are batched into one round of
 * `BLOB_CLAIMANTS` lookups (ADR-0007 §2: "pages through storage.listAll(),
 * batches pathnames"). Implementation chunking, not a compliance tunable —
 * deliberately not in `lib/config.ts`.
 */
const LIST_BATCH_SIZE = 500;

/**
 * Every model that owns blob pathnames in this store, each answering "of
 * these pathnames, which do you hold a row for" as a batched
 * `findMany({ where: { pathname: { in: ... } } })` — the same query shape
 * the single-table lookup always used, just one entry per owner instead of
 * one hard-coded table. See the class docstring above (M5 §7.1) for why
 * this exists as a registry rather than a second special case.
 */
export const BLOB_CLAIMANTS = [
  { model: "upload", column: "pathname" },
  { model: "narrationAsset", column: "pathname" },
  // M6. Both were caught by `blob-claimants.test.ts` before they could be
  // reaped — and `CustomVoice` is why this registry now carries a COLUMN NAME.
  // Its blob lives in `samplePathname`, not `pathname`, so the completeness
  // check's original `^pathname` pattern could not see it at all: an unregistered
  // claimant whose column is merely NAMED differently would have had the raw
  // recording of a real person's voice deleted an hour after it was uploaded.
  { model: "voiceConsentRecording", column: "pathname" },
  { model: "customVoice", column: "samplePathname" },
] as const;

export type BlobClaimantModel = (typeof BLOB_CLAIMANTS)[number]["model"];

/**
 * **`BLOB_CLAIMANTS` carries model NAMES, not bare closures** (2026-09-02
 * security review). It used to be an array of anonymous functions, which no
 * test could introspect — so unlike `PROFILE_BLOB_SOURCES` it had no
 * completeness check at all, and a missing registration fails toward DELETING a
 * live blob. Naming the models makes the registry readable by
 * `tests/unit/lib/jobs/blob-claimants.test.ts`, which reads `schema.prisma` and
 * fails on any model owning a `pathname` that is not listed here.
 *
 * The claim query is driven by the manifest rather than hand-written per model,
 * the same indexing-and-casting shape `readProfileBlobPathnamesBySource`
 * (`lib/deletion/service.ts`) uses and for the same reason: Prisma's generated
 * client has no delegate type spanning arbitrary models. The manifest's
 * completeness is what the test guards, not this cast.
 */
async function claimPathnames(
  model: BlobClaimantModel,
  column: string,
  pathnames: string[],
): Promise<string[]> {
  const delegate = db[model] as unknown as {
    findMany: (args: {
      where: Record<string, { in: string[] }>;
      select: Record<string, true>;
    }) => Promise<Array<Record<string, string | null>>>;
  };
  const rows = await delegate.findMany({
    where: { [column]: { in: pathnames } },
    select: { [column]: true },
  });
  // `samplePathname` is nullable — a CustomVoice whose sample has been deleted
  // claims nothing, which is correct: the object is gone and any bytes still
  // sitting there ARE an orphan.
  return rows.map((row) => row[column]).filter((value): value is string => typeof value === "string");
}

export async function reconcileBlobs(storage: StoragePort, clock: Clock): Promise<ReconcileBlobsResult> {
  const now = clock();
  const orphanThresholdMs = ORPHAN_THRESHOLD_MINUTES * 60_000;

  let scanned = 0;
  let orphansDeleted = 0;
  let batch: Array<{ pathname: string; uploadedAt: Date }> = [];

  const flushBatch = async (): Promise<void> => {
    if (batch.length === 0) return;
    const pathnames = batch.map((obj) => obj.pathname);
    // An object is an orphan only if NO claimant claims it (M5 §7.1).
    const claimedByAnyOwner = await Promise.all(
      BLOB_CLAIMANTS.map((claimant) => claimPathnames(claimant.model, claimant.column, pathnames)),
    );
    const knownPathnames = new Set(claimedByAnyOwner.flat());

    const orphans = batch
      .filter((obj) => !knownPathnames.has(obj.pathname))
      .filter((obj) => now.getTime() - obj.uploadedAt.getTime() >= orphanThresholdMs)
      .map((obj) => obj.pathname);

    if (orphans.length > 0) {
      await storage.del(orphans);
      orphansDeleted += orphans.length;
    }
    batch = [];
  };

  for await (const obj of storage.listAll()) {
    scanned += 1;
    batch.push(obj);
    if (batch.length >= LIST_BATCH_SIZE) {
      await flushBatch();
    }
  }
  await flushBatch();

  // (2) Stale PENDING uploads -> FAILED. Boundary: an upload created
  // EXACTLY `ORPHAN_THRESHOLD_MINUTES` ago counts as stale (`<=`, matching
  // the `>=` used for orphan age above).
  const pendingCutoff = new Date(now.getTime() - orphanThresholdMs);
  const failedResult = await db.upload.updateMany({
    where: { status: "PENDING", createdAt: { lte: pendingCutoff } },
    data: { status: "FAILED" },
  });

  // (3) Prune stale UploadTokenGrant rows.
  const grantCutoff = new Date(now.getTime() - GRANT_PRUNE_AFTER_HOURS * 60 * 60 * 1000);
  const grantsResult = await db.uploadTokenGrant.deleteMany({
    where: { createdAt: { lte: grantCutoff } },
  });

  // M6. The same prune, for the same reason, on the voice-recording grants. Their
  // only job was bounding one upload; past the window they are rows naming the
  // pathname of an adult's voice recording and nothing else. Left unpruned they
  // accumulate forever — which the retention classification for
  // `VoiceUploadGrant` asserts does not happen, so it has to actually not happen.
  const voiceGrantsResult = await db.voiceUploadGrant.deleteMany({
    where: { createdAt: { lte: grantCutoff } },
  });

  return {
    scanned,
    orphansDeleted,
    uploadsFailed: failedResult.count,
    grantsPruned: grantsResult.count + voiceGrantsResult.count,
  };
}
