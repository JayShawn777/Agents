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
 *   1. Page through every object in the store. Any pathname with NO
 *      matching `Upload` row, and older than `ORPHAN_THRESHOLD_MINUTES`,
 *      is an orphan and is deleted from storage. An object that DOES have a
 *      row is left untouched, however old.
 *   2. Any `Upload` row still `PENDING` past the same threshold is flipped
 *      to `FAILED` — the confirm step never happened and never will, so the
 *      student should see a failed upload with a retry rather than a
 *      spinner forever.
 *   3. Any `UploadTokenGrant` row older than `GRANT_PRUNE_AFTER_HOURS` is
 *      deleted — its only job was bounding token issuance for the hourly
 *      cap (M1 AC 17), and it has long since stopped mattering for that.
 *
 * The threshold on (1) exists because an upload legitimately in flight has
 * no `Upload` row yet — the object exists in the store before the confirm
 * request that creates the row ever arrives.
 */

export type ReconcileBlobsResult = {
  scanned: number;
  orphansDeleted: number;
  uploadsFailed: number;
  grantsPruned: number;
};

/**
 * How many pathnames from `storage.listAll()` are batched into one
 * `db.upload.findMany({ where: { pathname: { in: ... } } })` lookup
 * (ADR-0007 §2: "pages through storage.listAll(), batches pathnames").
 * Implementation chunking, not a compliance tunable — deliberately not in
 * `lib/config.ts`.
 */
const LIST_BATCH_SIZE = 500;

export async function reconcileBlobs(storage: StoragePort, clock: Clock): Promise<ReconcileBlobsResult> {
  const now = clock();
  const orphanThresholdMs = ORPHAN_THRESHOLD_MINUTES * 60_000;

  let scanned = 0;
  let orphansDeleted = 0;
  let batch: Array<{ pathname: string; uploadedAt: Date }> = [];

  const flushBatch = async (): Promise<void> => {
    if (batch.length === 0) return;
    const pathnames = batch.map((obj) => obj.pathname);
    const known = await db.upload.findMany({
      where: { pathname: { in: pathnames } },
      select: { pathname: true },
    });
    const knownPathnames = new Set(known.map((upload) => upload.pathname));

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

  return {
    scanned,
    orphansDeleted,
    uploadsFailed: failedResult.count,
    grantsPruned: grantsResult.count,
  };
}
