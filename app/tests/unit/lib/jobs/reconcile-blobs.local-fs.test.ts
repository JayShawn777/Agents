import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { LocalFsStorage } from "@/lib/storage/local-fs";
import type { StoragePort } from "@/lib/storage/port";

/**
 * `reconcile-blobs.test.ts` re-run against the REAL `LocalFsStorage`
 * adapter instead of `tests/unit/mocks/fake-storage.ts`'s in-memory fake —
 * proving the orphan-enumeration mechanism against actual filesystem
 * `readdir`/`unlink` semantics, not a mock's promise. See this task's
 * report for what, if anything, differed from the fake.
 */

const dbMock = {
  upload: {
    findMany: vi.fn(async () => [] as Array<{ pathname: string }>),
    updateMany: vi.fn(async () => ({ count: 0 })),
  },
  // M5 §7.1 — reconcileBlobs's second BLOB_CLAIMANTS entry. Never seeded
  // with a row in this file: every fixture here is under the uploads
  // prefix, so this claimant should always come back empty and never be
  // the reason an object survives.
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

/** Wraps a real `LocalFsStorage` with a call recorder for `del()`, matching `FakeStoragePort`'s `.deletedBatches` shape without faking the storage itself. */
function withDelSpy(storage: LocalFsStorage): StoragePort & { deletedBatches: string[][] } {
  const deletedBatches: string[][] = [];
  const port: StoragePort = {
    handleClientUpload: storage.handleClientUpload.bind(storage),
    head: storage.head.bind(storage),
    signedReadUrl: storage.signedReadUrl.bind(storage),
    readBytes: storage.readBytes.bind(storage),
    del: async (pathnames: string[]) => {
      deletedBatches.push(pathnames);
      await storage.del(pathnames);
    },
    put: storage.put.bind(storage),
    listAll: storage.listAll.bind(storage),
  };
  return Object.assign(port, { deletedBatches });
}

let rootDir: string;
let real: LocalFsStorage;

beforeEach(async () => {
  vi.clearAllMocks();
  dbMock.upload.findMany.mockResolvedValue([]);
  dbMock.upload.updateMany.mockResolvedValue({ count: 0 });
  dbMock.narrationAsset.findMany.mockResolvedValue([]);
  dbMock.uploadTokenGrant.deleteMany.mockResolvedValue({ count: 0 });
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "reconcile-blobs-local-fs-"));
  real = new LocalFsStorage(rootDir);
});

afterEach(async () => {
  await fs.rm(rootDir, { recursive: true, force: true });
});

describe("reconcileBlobs against LocalFsStorage — orphan detection", () => {
  it("deletes an object with no matching Upload row once it is past the orphan threshold", async () => {
    await real.put("students/sp_1/uploads/orphan.jpg", new Uint8Array([1]), "image/jpeg", {
      uploadedAt: minutesAgo(61),
    });
    const storage = withDelSpy(real);
    dbMock.upload.findMany.mockResolvedValue([]);

    const result = await reconcileBlobs(storage, clock);

    expect(storage.deletedBatches).toEqual([["students/sp_1/uploads/orphan.jpg"]]);
    expect(result).toEqual({ scanned: 1, orphansDeleted: 1, uploadsFailed: 0, grantsPruned: 0 });
    // Proven against the real store, not just the recorder: the bytes are
    // actually gone afterward.
    expect(await real.head("students/sp_1/uploads/orphan.jpg")).toBeNull();
  });

  it("never deletes an object that HAS a matching Upload row, however old", async () => {
    await real.put("students/sp_1/uploads/known.jpg", new Uint8Array([1]), "image/jpeg", {
      uploadedAt: minutesAgo(100_000),
    });
    const storage = withDelSpy(real);
    dbMock.upload.findMany.mockResolvedValue([{ pathname: "students/sp_1/uploads/known.jpg" }]);

    const result = await reconcileBlobs(storage, clock);

    expect(storage.deletedBatches).toEqual([]);
    expect(result.orphansDeleted).toBe(0);
    expect(await real.head("students/sp_1/uploads/known.jpg")).not.toBeNull();
  });

  describe("orphan-threshold boundary (ORPHAN_THRESHOLD_MINUTES = 60)", () => {
    it("does NOT delete an object one second before the threshold", async () => {
      const uploadedAt = new Date(minutesAgo(60).getTime() + 1000);
      await real.put("students/sp_1/uploads/almost.jpg", new Uint8Array([1]), "image/jpeg", { uploadedAt });
      const storage = withDelSpy(real);

      const result = await reconcileBlobs(storage, clock);

      expect(result.orphansDeleted).toBe(0);
      expect(storage.deletedBatches).toEqual([]);
    });

    it("DOES delete an object exactly at the threshold", async () => {
      await real.put("students/sp_1/uploads/exact.jpg", new Uint8Array([1]), "image/jpeg", {
        uploadedAt: minutesAgo(60),
      });
      const storage = withDelSpy(real);

      const result = await reconcileBlobs(storage, clock);

      expect(result.orphansDeleted).toBe(1);
    });

    it("DOES delete an object one second after the threshold", async () => {
      const uploadedAt = new Date(minutesAgo(60).getTime() - 1000);
      await real.put("students/sp_1/uploads/past.jpg", new Uint8Array([1]), "image/jpeg", { uploadedAt });
      const storage = withDelSpy(real);

      const result = await reconcileBlobs(storage, clock);

      expect(result.orphansDeleted).toBe(1);
    });
  });

  it("batches across LIST_BATCH_SIZE (500) pathnames from a real directory listing", async () => {
    const count = 501;
    for (let i = 0; i < count; i++) {
      await real.put(
        `students/sp_1/uploads/file-${String(i).padStart(4, "0")}.jpg`,
        new Uint8Array([1]),
        "image/jpeg",
        { uploadedAt: minutesAgo(61) },
      );
    }
    const storage = withDelSpy(real);
    dbMock.upload.findMany.mockResolvedValue([]);

    const result = await reconcileBlobs(storage, clock);

    expect(result.scanned).toBe(count);
    expect(result.orphansDeleted).toBe(count);
    const allDeleted = storage.deletedBatches.flat();
    expect(new Set(allDeleted).size).toBe(count);
  });
});

describe("reconcileBlobs against LocalFsStorage — stale PENDING uploads and grant pruning still flow through unchanged", () => {
  it("flips PENDING uploads to FAILED independent of the real store's contents", async () => {
    dbMock.upload.updateMany.mockResolvedValue({ count: 3 });
    const storage = withDelSpy(real);

    const result = await reconcileBlobs(storage, clock);

    expect(dbMock.upload.updateMany).toHaveBeenCalledWith({
      where: { status: "PENDING", createdAt: { lte: minutesAgo(60) } },
      data: { status: "FAILED" },
    });
    expect(result.uploadsFailed).toBe(3);
  });

  it("prunes grants older than GRANT_PRUNE_AFTER_HOURS (24h)", async () => {
    dbMock.uploadTokenGrant.deleteMany.mockResolvedValue({ count: 2 });
    const storage = withDelSpy(real);

    const result = await reconcileBlobs(storage, clock);

    expect(dbMock.uploadTokenGrant.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lte: new Date(NOW.getTime() - 24 * 60 * 60 * 1000) } },
    });
    expect(result.grantsPruned).toBe(2);
  });
});
