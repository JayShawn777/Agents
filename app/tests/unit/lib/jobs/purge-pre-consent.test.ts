import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeStorage } from "@/tests/unit/mocks/fake-storage";

/**
 * `lib/jobs/purge-pre-consent.ts` (B22, endpoint 25, ADR-0007 §5, M0 AC
 * 22/23).
 *
 * The two properties this suite must prove:
 *   1. Blob-before-row: a profile's blobs are enumerated by STORE PREFIX
 *      and deleted BEFORE the profile row is destroyed; a `storage.del()`
 *      failure leaves the profile row (and everything under it) untouched.
 *   2. The `PRE_CONSENT_PURGE_DAYS` boundary, on `createdAt`, and that
 *      `ACTIVE`/`CONSENT_WITHDRAWN` profiles are never selected regardless
 *      of age.
 */

type StudentProfileFindManyArgs = {
  where: { status: { notIn: string[] }; createdAt: { lte: Date } };
  select: { id: true };
};

const dbMock = {
  studentProfile: {
    findMany: vi.fn<(args: StudentProfileFindManyArgs) => Promise<Array<{ id: string }>>>(async () => []),
    delete: vi.fn(),
  },
  deletionAudit: {
    create: vi.fn(),
  },
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") {
      return (arg as (tx: typeof dbMock) => Promise<unknown>)(dbMock);
    }
    return arg;
  }),
};

vi.mock("@/lib/db", () => ({ db: dbMock }));

const { purgePreConsent } = await import("@/lib/jobs/purge-pre-consent");
const { PRE_CONSENT_PURGE_DAYS } = await import("@/lib/config");

const NOW = new Date("2026-08-27T12:00:00.000Z");
const clock = () => NOW;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.studentProfile.findMany.mockResolvedValue([]);
});

describe("purgePreConsent — selection query (M0 AC 22/23)", () => {
  it("selects profiles NOT IN (ACTIVE, CONSENT_WITHDRAWN) older than PRE_CONSENT_PURGE_DAYS", async () => {
    const storage = createFakeStorage([]);
    await purgePreConsent(storage, clock);

    expect(dbMock.studentProfile.findMany).toHaveBeenCalledWith({
      where: {
        status: { notIn: ["ACTIVE", "CONSENT_WITHDRAWN"] },
        createdAt: { lte: daysAgo(PRE_CONSENT_PURGE_DAYS) },
      },
      select: { id: true },
    });
  });

  describe("createdAt boundary (PRE_CONSENT_PURGE_DAYS = 14)", () => {
    it("does not purge a profile created one second inside the window", async () => {
      const cutoff = daysAgo(PRE_CONSENT_PURGE_DAYS);
      const notYetCutoff = new Date(cutoff.getTime() + 1000);
      // Real Postgres does the filtering; here we simulate that the query
      // returns nothing for a profile one second too young.
      dbMock.studentProfile.findMany.mockImplementation(async ({ where }: { where: { createdAt: { lte: Date } } }) =>
        notYetCutoff.getTime() <= where.createdAt.lte.getTime() ? [{ id: "sp_1" }] : [],
      );

      const result = await purgePreConsent(createFakeStorage([]), clock);
      expect(result.profilesPurged).toBe(0);
    });

    it("purges a profile created exactly at the window boundary", async () => {
      const cutoff = daysAgo(PRE_CONSENT_PURGE_DAYS);
      dbMock.studentProfile.findMany.mockImplementation(async ({ where }: { where: { createdAt: { lte: Date } } }) =>
        cutoff.getTime() <= where.createdAt.lte.getTime() ? [{ id: "sp_1" }] : [],
      );

      const result = await purgePreConsent(createFakeStorage([]), clock);
      expect(result.profilesPurged).toBe(1);
    });
  });
});

describe("purgePreConsent — blob-before-row ordering (ADR-0007 §1/§5)", () => {
  it("enumerates the profile's STORE PREFIX, deletes those blobs, then deletes the row and writes a PRE_CONSENT_PURGE audit", async () => {
    dbMock.studentProfile.findMany.mockResolvedValue([{ id: "sp_1" }]);
    const storage = createFakeStorage([
      { pathname: "students/sp_1/uploads/a.jpg", uploadedAt: NOW },
      { pathname: "students/sp_2/uploads/other.jpg", uploadedAt: NOW }, // different profile, must be ignored
    ]);

    const result = await purgePreConsent(storage, clock);

    expect(storage.deletedBatches).toEqual([["students/sp_1/uploads/a.jpg"]]);
    expect(dbMock.deletionAudit.create).toHaveBeenCalledWith({
      data: { kind: "PRE_CONSENT_PURGE", subjectRef: "sp_1", completedAt: NOW },
    });
    expect(dbMock.studentProfile.delete).toHaveBeenCalledWith({ where: { id: "sp_1" } });
    expect(result).toEqual({ profilesPurged: 1, blobsDeleted: 1 });
  });

  it("leaves the profile row untouched when storage.del() fails, and reports it as not purged", async () => {
    dbMock.studentProfile.findMany.mockResolvedValue([{ id: "sp_1" }]);
    const storage = createFakeStorage([{ pathname: "students/sp_1/uploads/a.jpg", uploadedAt: NOW }], {
      del: vi.fn(async () => {
        throw new Error("simulated provider outage");
      }),
    });

    const result = await purgePreConsent(storage, clock);

    expect(dbMock.deletionAudit.create).not.toHaveBeenCalled();
    expect(dbMock.studentProfile.delete).not.toHaveBeenCalled();
    expect(result).toEqual({ profilesPurged: 0, blobsDeleted: 0 });
  });

  it("purges a profile with no blobs at all (no storage.del call)", async () => {
    dbMock.studentProfile.findMany.mockResolvedValue([{ id: "sp_1" }]);
    const storage = createFakeStorage([]);

    const result = await purgePreConsent(storage, clock);

    expect(storage.deletedBatches).toEqual([]);
    expect(dbMock.studentProfile.delete).toHaveBeenCalledWith({ where: { id: "sp_1" } });
    expect(result).toEqual({ profilesPurged: 1, blobsDeleted: 0 });
  });
});
