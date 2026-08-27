import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeStorage } from "@/tests/unit/mocks/fake-storage";

/**
 * `lib/jobs/reconcile-blobs.ts` (B22, endpoint 24, ADR-0007 §2).
 *
 * The load-bearing property this suite proves: the job finds orphans by
 * enumerating the FAKE STORE (`storage.listAll()`), never by querying
 * `Upload` rows outward — an object the fake store returns with no matching
 * row is exactly the case a database-driven sweep could never see.
 */

const dbMock = {
  upload: {
    findMany: vi.fn(async () => [] as Array<{ pathname: string }>),
    updateMany: vi.fn(async () => ({ count: 0 })),
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
