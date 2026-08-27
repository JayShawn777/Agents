import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeStorage } from "@/tests/unit/mocks/fake-storage";

/**
 * `lib/jobs/enforce-retention.ts` (B22, endpoint 27, ADR-0007 §5, M0 AC 45 /
 * M1 AC 36).
 *
 * Properties this suite proves:
 *   1. `SOURCE_FILE` has TWO independent triggers: age since successful
 *      extraction (`extractedAt`, never `createdAt`), and terminal
 *      `FAILED` extraction (no window at all).
 *   2. Retry-safety: `storage.del()` runs BEFORE any row is marked
 *      `SOURCE_DELETED` — the reverse of `deleteStudentData`'s ordering,
 *      deliberately, because this is a silent background sweep with no
 *      concurrent reader to keep honest mid-flight (see the job's own
 *      docstring). A storage failure must leave every row exactly as found.
 *   3. Each independently-windowed category's exact-boundary behaviour.
 */

type UploadFindManyArgs =
  | { where: { status: { not: "SOURCE_DELETED" }; extractedAt: { not: null; lte: Date } }; select: unknown }
  | { where: { status: { not: "SOURCE_DELETED" }; extraction: { status: "FAILED" } }; select: unknown };

const dbMock = {
  upload: {
    findMany: vi.fn<(args: UploadFindManyArgs) => Promise<Array<{ id: string; pathname: string }>>>(async () => []),
    updateMany: vi.fn(async () => ({ count: 0 })),
  },
  consentAuditArtifact: {
    deleteMany: vi.fn(async () => ({ count: 0 })),
  },
  deletionAudit: {
    deleteMany: vi.fn(async () => ({ count: 0 })),
  },
  consentVerificationChallenge: {
    deleteMany: vi.fn(async () => ({ count: 0 })),
  },
};

vi.mock("@/lib/db", () => ({ db: dbMock }));

const { enforceRetention } = await import("@/lib/jobs/enforce-retention");
const { SOURCE_FILE_RETENTION_DAYS_AFTER_EXTRACTION, DELETION_AUDIT_RETENTION_DAYS } = await import("@/lib/config");

const NOW = new Date("2026-08-27T12:00:00.000Z");
const clock = () => NOW;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.upload.findMany.mockResolvedValue([]);
  dbMock.upload.updateMany.mockResolvedValue({ count: 0 });
  dbMock.consentAuditArtifact.deleteMany.mockResolvedValue({ count: 0 });
  dbMock.deletionAudit.deleteMany.mockResolvedValue({ count: 0 });
  dbMock.consentVerificationChallenge.deleteMany.mockResolvedValue({ count: 0 });
});

describe("enforceRetention — SOURCE_FILE, extractedAt anchor (plan §7: never createdAt)", () => {
  it("queries by extractedAt, not createdAt, with the configured window", async () => {
    await enforceRetention(createFakeStorage([]), clock);

    expect(dbMock.upload.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          extractedAt: { not: null, lte: daysAgo(SOURCE_FILE_RETENTION_DAYS_AFTER_EXTRACTION) },
        }),
      }),
    );
  });

  describe("extractedAt boundary (SOURCE_FILE_RETENTION_DAYS_AFTER_EXTRACTION = 14)", () => {
    function withExtractedAtBoundary(offsetMs: number) {
      const extractedAt = new Date(daysAgo(SOURCE_FILE_RETENTION_DAYS_AFTER_EXTRACTION).getTime() + offsetMs);
      dbMock.upload.findMany.mockImplementation(async (args) => {
        if ("extractedAt" in args.where) {
          return extractedAt.getTime() <= args.where.extractedAt.lte.getTime() ? [{ id: "up_1", pathname: "students/sp_1/uploads/a.jpg" }] : [];
        }
        return [];
      });
    }

    it("does not sweep a file extracted one second inside the window", async () => {
      withExtractedAtBoundary(1000); // 13d 23h 59m 59s since extraction
      const storage = createFakeStorage([]);

      const result = await enforceRetention(storage, clock);

      expect(storage.deletedBatches).toEqual([]);
      expect(result.byCategory.SOURCE_FILE).toBe(0);
    });

    it("sweeps a file extracted exactly at the window boundary", async () => {
      withExtractedAtBoundary(0);
      dbMock.upload.updateMany.mockResolvedValue({ count: 1 });
      const storage = createFakeStorage([]);

      const result = await enforceRetention(storage, clock);

      expect(storage.deletedBatches).toEqual([["students/sp_1/uploads/a.jpg"]]);
      expect(result.byCategory.SOURCE_FILE).toBe(1);
    });

    it("sweeps a file extracted one second past the window boundary", async () => {
      withExtractedAtBoundary(-1000); // 14d 00h 00m 01s since extraction
      dbMock.upload.updateMany.mockResolvedValue({ count: 1 });
      const storage = createFakeStorage([]);

      const result = await enforceRetention(storage, clock);

      expect(result.byCategory.SOURCE_FILE).toBe(1);
    });
  });
});

describe("enforceRetention — SOURCE_FILE, terminal FAILED extraction (ADR-0007 §5: no window at all)", () => {
  it("sweeps a FAILED-extraction upload regardless of age", async () => {
    dbMock.upload.findMany.mockImplementation(async (args) => {
      if ("extraction" in args.where) {
        return [{ id: "up_failed", pathname: "students/sp_2/uploads/b.jpg" }];
      }
      return [];
    });
    dbMock.upload.updateMany.mockResolvedValue({ count: 1 });
    const storage = createFakeStorage([]);

    const result = await enforceRetention(storage, clock);

    expect(dbMock.upload.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ extraction: { status: "FAILED" } }) }),
    );
    expect(storage.deletedBatches).toEqual([["students/sp_2/uploads/b.jpg"]]);
    expect(result.byCategory.SOURCE_FILE).toBe(1);
  });

  it("deduplicates an upload matched by BOTH triggers into a single delete", async () => {
    dbMock.upload.findMany.mockResolvedValue([{ id: "up_1", pathname: "students/sp_1/uploads/a.jpg" }]);
    dbMock.upload.updateMany.mockResolvedValue({ count: 1 });
    const storage = createFakeStorage([]);

    await enforceRetention(storage, clock);

    expect(storage.deletedBatches).toEqual([["students/sp_1/uploads/a.jpg"]]);
  });
});

describe("enforceRetention — SOURCE_FILE retry-safety (deliberately reversed vs. deleteStudentData)", () => {
  it("calls storage.del() BEFORE marking any row SOURCE_DELETED", async () => {
    dbMock.upload.findMany.mockResolvedValue([{ id: "up_1", pathname: "students/sp_1/uploads/a.jpg" }]);
    const callOrder: string[] = [];
    const storage = createFakeStorage([], {
      del: vi.fn(async () => {
        callOrder.push("storage.del");
      }),
    });
    dbMock.upload.updateMany.mockImplementation(async () => {
      callOrder.push("upload.updateMany(SOURCE_DELETED)");
      return { count: 1 };
    });

    await enforceRetention(storage, clock);

    expect(callOrder).toEqual(["storage.del", "upload.updateMany(SOURCE_DELETED)"]);
  });

  it("leaves every row untouched (no updateMany call) and rejects when storage.del() fails", async () => {
    dbMock.upload.findMany.mockResolvedValue([{ id: "up_1", pathname: "students/sp_1/uploads/a.jpg" }]);
    const storage = createFakeStorage([], {
      del: vi.fn(async () => {
        throw new Error("simulated provider outage");
      }),
    });

    await expect(enforceRetention(storage, clock)).rejects.toThrow();
    expect(dbMock.upload.updateMany).not.toHaveBeenCalled();
  });
});

describe("enforceRetention — CONSENT_PSEUDONYM (ConsentAuditArtifact.purgeAfter)", () => {
  it("deletes artifacts with purgeAfter <= now", async () => {
    dbMock.consentAuditArtifact.deleteMany.mockResolvedValue({ count: 4 });
    const result = await enforceRetention(createFakeStorage([]), clock);

    expect(dbMock.consentAuditArtifact.deleteMany).toHaveBeenCalledWith({ where: { purgeAfter: { lte: NOW } } });
    expect(result.byCategory.CONSENT_PSEUDONYM).toBe(4);
  });
});

describe("enforceRetention — DELETION_AUDIT boundary (DELETION_AUDIT_RETENTION_DAYS = 365)", () => {
  it("queries completedAt against the configured cutoff", async () => {
    await enforceRetention(createFakeStorage([]), clock);

    expect(dbMock.deletionAudit.deleteMany).toHaveBeenCalledWith({
      where: { completedAt: { not: null, lte: daysAgo(DELETION_AUDIT_RETENTION_DAYS) } },
    });
  });
});

describe("enforceRetention — unconsumed ConsentVerificationChallenge expiry (endpoint 27's extra scope)", () => {
  it("deletes unconsumed challenges whose expiresAt has passed", async () => {
    dbMock.consentVerificationChallenge.deleteMany.mockResolvedValue({ count: 2 });
    const result = await enforceRetention(createFakeStorage([]), clock);

    expect(dbMock.consentVerificationChallenge.deleteMany).toHaveBeenCalledWith({
      where: { consumedAt: null, expiresAt: { lte: NOW } },
    });
    expect(result.byCategory.CONSENT_CHALLENGE_EXPIRED).toBe(2);
  });
});

describe("enforceRetention — DIRECT_NOTICE plan gap", () => {
  it("always reports 0 — no schema column exists to enforce the stated anchor", async () => {
    const result = await enforceRetention(createFakeStorage([]), clock);
    expect(result.byCategory.DIRECT_NOTICE).toBe(0);
  });
});
