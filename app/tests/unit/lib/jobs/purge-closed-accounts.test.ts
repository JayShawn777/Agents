import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DeleteStudentDataResult } from "@/lib/deletion/service";
import type { DeletionKind } from "@/lib/generated/prisma/enums";
import type { StoragePort } from "@/lib/storage/port";

/**
 * `lib/jobs/purge-closed-accounts.ts` (B22, endpoint 26, ADR-0007 §4(c),
 * M0 AC 47) — the third caller of `deleteStudentData`.
 *
 * `deleteStudentData` itself is mocked here (its own ordering/pseudonymisation
 * behaviour is `tests/unit/lib/deletion/service.test.ts`'s job) so this
 * suite proves only what THIS job adds: user selection by
 * `ACCOUNT_CLOSURE_RECOVERY_DAYS`, calling the destructor once per profile,
 * stamping the EXISTING account-level `DeletionAudit` row rather than
 * creating a new one, and never deleting the `User` row unless every
 * profile destruction succeeded.
 *
 * Mocks below are typed against the REAL signatures (`DeleteStudentDataResult`
 * is the actual discriminated union `deleteStudentData` returns) rather than
 * inferred from a zero-arg stub or widened with `as` — a mock that can only
 * express `{ ok: true }` can never test the `STORAGE_FAILURE` arm.
 */

type UserFindManyArgs = { where: { closureRequestedAt: { not: null; lte: Date } }; select: { id: true } };
type StudentProfileFindManyArgs = { where: { userId: string }; select: { id: true } };

const dbMock = {
  user: {
    findMany: vi.fn<(args: UserFindManyArgs) => Promise<Array<{ id: string }>>>(async () => []),
    delete: vi.fn(),
  },
  studentProfile: {
    findMany: vi.fn<(args: StudentProfileFindManyArgs) => Promise<Array<{ id: string }>>>(async () => []),
  },
  deletionAudit: {
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") {
      return (arg as (tx: typeof dbMock) => Promise<unknown>)(dbMock);
    }
    return arg;
  }),
};

const deletionServiceMock = {
  deleteStudentData: vi.fn<
    (studentProfileId: string, kind: DeletionKind, storage: StoragePort) => Promise<DeleteStudentDataResult>
  >(async () => ({ ok: true })),
};

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/deletion/service", () => deletionServiceMock);

const { purgeClosedAccounts } = await import("@/lib/jobs/purge-closed-accounts");
const { ACCOUNT_CLOSURE_RECOVERY_DAYS } = await import("@/lib/config");

const NOW = new Date("2026-08-27T12:00:00.000Z");
const clock = () => NOW;
const fakeStorage = {} as never; // never touched directly by this job — passed straight through

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.user.findMany.mockResolvedValue([]);
  dbMock.studentProfile.findMany.mockResolvedValue([]);
  deletionServiceMock.deleteStudentData.mockResolvedValue({ ok: true });
});

describe("purgeClosedAccounts — selection query (M0 AC 47)", () => {
  it("selects users whose closureRequestedAt is at least ACCOUNT_CLOSURE_RECOVERY_DAYS old", async () => {
    await purgeClosedAccounts(fakeStorage, clock);

    expect(dbMock.user.findMany).toHaveBeenCalledWith({
      where: { closureRequestedAt: { not: null, lte: daysAgo(ACCOUNT_CLOSURE_RECOVERY_DAYS) } },
      select: { id: true },
    });
  });

  describe("closureRequestedAt boundary (ACCOUNT_CLOSURE_RECOVERY_DAYS = 30)", () => {
    // The cutoff itself is computed by the job and asserted above; these
    // two cases simulate what Postgres's `lte` comparison against that
    // exact cutoff would return for a row one second on either side of it.
    function closedAt(offsetMs: number) {
      return new Date(daysAgo(ACCOUNT_CLOSURE_RECOVERY_DAYS).getTime() + offsetMs);
    }

    it("does not purge a user closed one second inside the recovery window", async () => {
      const requestedAt = closedAt(1000); // 29d 23h 59m 59s ago — not yet due
      dbMock.user.findMany.mockImplementation(async ({ where }: { where: { closureRequestedAt: { lte: Date } } }) =>
        requestedAt.getTime() <= where.closureRequestedAt.lte.getTime() ? [{ id: "user_1" }] : [],
      );

      const result = await purgeClosedAccounts(fakeStorage, clock);
      expect(result.purged).toBe(0);
    });

    it("purges a user closed exactly at the boundary", async () => {
      const requestedAt = closedAt(0); // exactly ACCOUNT_CLOSURE_RECOVERY_DAYS ago
      dbMock.user.findMany.mockImplementation(async ({ where }: { where: { closureRequestedAt: { lte: Date } } }) =>
        requestedAt.getTime() <= where.closureRequestedAt.lte.getTime() ? [{ id: "user_1" }] : [],
      );
      dbMock.studentProfile.findMany.mockResolvedValue([]);

      const result = await purgeClosedAccounts(fakeStorage, clock);
      expect(result.purged).toBe(1);
    });
  });
});

describe("purgeClosedAccounts — destruction and account-level audit stamp", () => {
  it("calls deleteStudentData(kind: ACCOUNT_CLOSURE) once per profile, then stamps the EXISTING account-level DeletionAudit row and deletes the User row", async () => {
    dbMock.user.findMany.mockResolvedValue([{ id: "user_1" }]);
    dbMock.studentProfile.findMany.mockResolvedValue([{ id: "sp_1" }, { id: "sp_2" }]);

    const result = await purgeClosedAccounts(fakeStorage, clock);

    expect(deletionServiceMock.deleteStudentData).toHaveBeenNthCalledWith(1, "sp_1", "ACCOUNT_CLOSURE", fakeStorage);
    expect(deletionServiceMock.deleteStudentData).toHaveBeenNthCalledWith(2, "sp_2", "ACCOUNT_CLOSURE", fakeStorage);
    // This job only ever FINISHES the account-level row written by
    // POST /api/account/closure — it never creates one (deletionAudit.create
    // is never called by this job).
    expect(dbMock.deletionAudit.updateMany).toHaveBeenCalledWith({
      where: { subjectRef: "user_1", kind: "ACCOUNT_CLOSURE", completedAt: null },
      data: { completedAt: NOW },
    });
    expect(dbMock.user.delete).toHaveBeenCalledWith({ where: { id: "user_1" } });
    expect(result).toEqual({ purged: 1 });
  });

  it("leaves the user and its audit row untouched if ANY profile destruction reports STORAGE_FAILURE", async () => {
    dbMock.user.findMany.mockResolvedValue([{ id: "user_1" }]);
    dbMock.studentProfile.findMany.mockResolvedValue([{ id: "sp_1" }, { id: "sp_2" }]);
    deletionServiceMock.deleteStudentData
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, code: "STORAGE_FAILURE" });

    const result = await purgeClosedAccounts(fakeStorage, clock);

    expect(dbMock.deletionAudit.updateMany).not.toHaveBeenCalled();
    expect(dbMock.user.delete).not.toHaveBeenCalled();
    expect(result).toEqual({ purged: 0 });
  });

  it("processes a second, independent user even after the first fails", async () => {
    dbMock.user.findMany.mockResolvedValue([{ id: "user_fail" }, { id: "user_ok" }]);
    dbMock.studentProfile.findMany.mockImplementation(async ({ where }: { where: { userId: string } }) =>
      where.userId === "user_fail" ? [{ id: "sp_fail" }] : [{ id: "sp_ok" }],
    );
    deletionServiceMock.deleteStudentData.mockImplementation(async (profileId: string) =>
      profileId === "sp_fail" ? { ok: false, code: "STORAGE_FAILURE" } : { ok: true },
    );

    const result = await purgeClosedAccounts(fakeStorage, clock);

    expect(dbMock.user.delete).toHaveBeenCalledWith({ where: { id: "user_ok" } });
    expect(dbMock.user.delete).not.toHaveBeenCalledWith({ where: { id: "user_fail" } });
    expect(result).toEqual({ purged: 1 });
  });
});
