import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeStorage } from "@/tests/unit/mocks/fake-storage";

/**
 * `lib/jobs/reconcile-blobs.ts` (B22, endpoint 24, ADR-0007 §2; M5 §7.1).
 *
 * The load-bearing property this suite proves: the job finds orphans by
 * enumerating the FAKE STORE (`storage.listAll()`), never by querying rows
 * outward — an object the fake store returns with no matching row is
 * exactly the case a database-driven sweep could never see.
 *
 * `dbMock.narrationAsset` exists because `BLOB_CLAIMANTS` now has TWO
 * entries, not one — the M5 finding this file's own docstring records: a
 * store-wide sweep that only asked `Upload` would have deleted every
 * narration object on its first run past the threshold. The narration
 * describe-block below is the regression test for that finding, run against
 * the UNFIXED single-claimant behaviour first (see its comment) before the
 * fix, per the retro rule that a test must be seen to fail.
 */

const dbMock = {
  upload: {
    findMany: vi.fn(async () => [] as Array<{ pathname: string }>),
    updateMany: vi.fn(async () => ({ count: 0 })),
  },
  narrationAsset: {
    findMany: vi.fn(async () => [] as Array<{ pathname: string }>),
  },
  uploadTokenGrant: {
    deleteMany: vi.fn(async () => ({ count: 0 })),
  },
};

vi.mock("@/lib/db", () => ({ db: dbMock }));

const { reconcileBlobs } = await import("@/lib/jobs/reconcile-blobs");

const NOW = new Date("2026-08-27T12:00:00.000Z");
const clock = () => NOW;

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000);
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.upload.findMany.mockResolvedValue([]);
  dbMock.upload.updateMany.mockResolvedValue({ count: 0 });
  dbMock.narrationAsset.findMany.mockResolvedValue([]);
  dbMock.uploadTokenGrant.deleteMany.mockResolvedValue({ count: 0 });
});

describe("reconcileBlobs — orphan detection (store-enumerating, ADR-0007 §2)", () => {
  it("deletes an object with no matching Upload row once it is past the orphan threshold", async () => {
    const storage = createFakeStorage([{ pathname: "students/sp_1/uploads/orphan.jpg", uploadedAt: minutesAgo(61) }]);
    dbMock.upload.findMany.mockResolvedValue([]); // no row for this pathname

    const result = await reconcileBlobs(storage, clock);

    expect(storage.deletedBatches).toEqual([["students/sp_1/uploads/orphan.jpg"]]);
    expect(result).toEqual({ scanned: 1, orphansDeleted: 1, uploadsFailed: 0, grantsPruned: 0 });
  });

  it("never deletes an object that HAS a matching Upload row, however old", async () => {
    const storage = createFakeStorage([{ pathname: "students/sp_1/uploads/known.jpg", uploadedAt: minutesAgo(100_000) }]);
    dbMock.upload.findMany.mockResolvedValue([{ pathname: "students/sp_1/uploads/known.jpg" }]);

    const result = await reconcileBlobs(storage, clock);

    expect(storage.deletedBatches).toEqual([]);
    expect(result.orphansDeleted).toBe(0);
  });

  describe("orphan-threshold boundary (ORPHAN_THRESHOLD_MINUTES = 60)", () => {
    it("does NOT delete an object one second before the threshold", async () => {
      const uploadedAt = new Date(minutesAgo(60).getTime() + 1000); // 59:59 old
      const storage = createFakeStorage([{ pathname: "students/sp_1/uploads/almost.jpg", uploadedAt }]);

      const result = await reconcileBlobs(storage, clock);

      expect(result.orphansDeleted).toBe(0);
      expect(storage.deletedBatches).toEqual([]);
    });

    it("DOES delete an object exactly at the threshold", async () => {
      const storage = createFakeStorage([{ pathname: "students/sp_1/uploads/exact.jpg", uploadedAt: minutesAgo(60) }]);

      const result = await reconcileBlobs(storage, clock);

      expect(result.orphansDeleted).toBe(1);
    });

    it("DOES delete an object one second after the threshold", async () => {
      const uploadedAt = new Date(minutesAgo(60).getTime() - 1000); // 60:01 old
      const storage = createFakeStorage([{ pathname: "students/sp_1/uploads/past.jpg", uploadedAt }]);

      const result = await reconcileBlobs(storage, clock);

      expect(result.orphansDeleted).toBe(1);
    });
  });
});

/**
 * M5 §7.1 — the finding, tested directly. Before the `BLOB_CLAIMANTS` fix,
 * this job asked only `db.upload.findMany` and treated ANY other pathname
 * with no matching row as an orphan, however it got there — so a narration
 * object (which never has an `Upload` row) older than the threshold was
 * deleted on the very first cron run, while its owning `NarrationAsset` row
 * survived pointing at nothing.
 *
 * Confirmed against the pre-fix code before writing the fix: with only
 * `dbMock.upload.findMany` wired up (as the suite was before this task) and
 * a narration pathname seeded with no `Upload` row, the old single-lookup
 * implementation deleted it — these two cases are that regression, pinned
 * so it cannot come back silently.
 */
describe("reconcileBlobs — the narration claimant (M5 §7.1)", () => {
  it("a narration object WITH a NarrationAsset row survives a reconcile run however old it is", async () => {
    const pathname = "students/sp_1/narration/deadbeef.mp3";
    const storage = createFakeStorage([{ pathname, uploadedAt: minutesAgo(100_000) }]);
    dbMock.upload.findMany.mockResolvedValue([]); // no Upload row — narration never has one
    dbMock.narrationAsset.findMany.mockResolvedValue([{ pathname }]);

    const result = await reconcileBlobs(storage, clock);

    expect(storage.deletedBatches).toEqual([]);
    expect(result.orphansDeleted).toBe(0);
  });

  it("a narration object WITHOUT a NarrationAsset row, older than the threshold, IS deleted — the real orphan class this job exists for (slice 5 writes the blob before the row)", async () => {
    const pathname = "students/sp_1/narration/orphaned.mp3";
    const storage = createFakeStorage([{ pathname, uploadedAt: minutesAgo(61) }]);
    dbMock.upload.findMany.mockResolvedValue([]);
    dbMock.narrationAsset.findMany.mockResolvedValue([]);

    const result = await reconcileBlobs(storage, clock);

    expect(storage.deletedBatches).toEqual([[pathname]]);
    expect(result.orphansDeleted).toBe(1);
  });

  it("both claimants are consulted in the same batched round (an object either claimant recognises survives)", async () => {
    const uploadPathname = "students/sp_1/uploads/known.jpg";
    const narrationPathname = "students/sp_1/narration/known.mp3";
    const storage = createFakeStorage([
      { pathname: uploadPathname, uploadedAt: minutesAgo(100_000) },
      { pathname: narrationPathname, uploadedAt: minutesAgo(100_000) },
    ]);
    dbMock.upload.findMany.mockResolvedValue([{ pathname: uploadPathname }]);
    dbMock.narrationAsset.findMany.mockResolvedValue([{ pathname: narrationPathname }]);

    const result = await reconcileBlobs(storage, clock);

    expect(storage.deletedBatches).toEqual([]);
    expect(result.orphansDeleted).toBe(0);
  });
});

describe("reconcileBlobs — stale PENDING uploads flip to FAILED (M1 AC 16)", () => {
  it("flips PENDING uploads created at least ORPHAN_THRESHOLD_MINUTES ago to FAILED", async () => {
    dbMock.upload.updateMany.mockResolvedValue({ count: 3 });
    const storage = createFakeStorage([]);

    const result = await reconcileBlobs(storage, clock);

    expect(dbMock.upload.updateMany).toHaveBeenCalledWith({
      where: { status: "PENDING", createdAt: { lte: minutesAgo(60) } },
      data: { status: "FAILED" },
    });
    expect(result.uploadsFailed).toBe(3);
  });
});

describe("reconcileBlobs — UploadTokenGrant pruning (ADR-0007 §2)", () => {
  it("prunes grants older than GRANT_PRUNE_AFTER_HOURS (24h)", async () => {
    dbMock.uploadTokenGrant.deleteMany.mockResolvedValue({ count: 2 });
    const storage = createFakeStorage([]);

    const result = await reconcileBlobs(storage, clock);

    expect(dbMock.uploadTokenGrant.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lte: new Date(NOW.getTime() - 24 * 60 * 60 * 1000) } },
    });
    expect(result.grantsPruned).toBe(2);
  });
});
