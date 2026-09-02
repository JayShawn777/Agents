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
  chatSession: {
    deleteMany:
      vi.fn<(args: { where: { openedAt: { lte: Date } } }) => Promise<{ count: number }>>(async () => ({ count: 0 })),
  },
  // M6. Both default to "nothing stale", so every pre-existing test in this file
  // is unaffected by the two new steps.
  customVoice: {
    findMany:
      vi.fn<(args: { where: { createdAt: { lte: Date } } }) => Promise<Array<{ id: string; samplePathname: string }>>>(
        async () => [],
      ),
    updateMany:
      vi.fn<
        (args: { where: { id: { in: string[] } }; data: { samplePathname: null; sampleDeletedAt: Date } }) => Promise<{
          count: number;
        }>
      >(async () => ({ count: 0 })),
  },
  voiceConsentRecording: {
    findMany:
      vi.fn<(args: { where: { createdAt: { lte: Date } } }) => Promise<Array<{ id: string; pathname: string }>>>(
        async () => [],
      ),
    deleteMany: vi.fn(async () => ({ count: 0 })),
  },
};

vi.mock("@/lib/db", () => ({ db: dbMock }));

const { enforceRetention } = await import("@/lib/jobs/enforce-retention");
const {
  SOURCE_FILE_RETENTION_DAYS_AFTER_EXTRACTION,
  DELETION_AUDIT_RETENTION_DAYS,
  CHAT_TRANSCRIPT_RETENTION_DAYS,
  VOICE_SAMPLE_RETENTION_DAYS,
  VOICE_CONSENT_RECORDING_RETENTION_DAYS,
} = await import("@/lib/config");

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
  dbMock.chatSession.deleteMany.mockResolvedValue({ count: 0 });
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

// ─────────────── M3: CHAT_TRANSCRIPT ───────────────

describe("CHAT_TRANSCRIPT", () => {
  it("deletes sessions past the window and reports how many", async () => {
    dbMock.chatSession.deleteMany.mockResolvedValue({ count: 4 });

    const result = await enforceRetention(createFakeStorage([]), clock);

    expect(result.byCategory.CHAT_TRANSCRIPT).toBe(4);
  });

  it("anchors on openedAt, not closedAt — a session abandoned mid-conversation may never close", async () => {
    // Anchoring on a column that can stay null forever is how a retention
    // window quietly becomes infinite.
    await enforceRetention(createFakeStorage([]), clock);

    const where = dbMock.chatSession.deleteMany.mock.calls[0][0].where as {
      openedAt: { lte: Date };
      closedAt?: unknown;
    };
    expect(where.openedAt.lte).toBeInstanceOf(Date);
    expect(where.closedAt).toBeUndefined();
  });

  it("cuts off exactly CHAT_TRANSCRIPT_RETENTION_DAYS before now", async () => {
    await enforceRetention(createFakeStorage([]), clock);

    const where = dbMock.chatSession.deleteMany.mock.calls[0][0].where as { openedAt: { lte: Date } };
    const expected = NOW.getTime() - CHAT_TRANSCRIPT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    expect(where.openedAt.lte.getTime()).toBe(expected);
  });

});



/**
 * ─────────── M6: the two voice retention steps ───────────
 *
 * Both categories are recordings of the ACCOUNT OWNER — an adult — and are the
 * most sensitive objects this application holds. `/retention` publishes a window
 * for each; these prove the code keeps that promise. A published window nothing
 * enforces makes the disclosure inaccurate in exactly the way M4's retro found
 * the OMITTED category did, just in the other direction.
 */
describe("VOICE_SAMPLE (M6)", () => {
  it("deletes the blob BEFORE clearing the column, so a failed delete retries next run", async () => {
    dbMock.customVoice.findMany.mockResolvedValue([{ id: "cv_1", samplePathname: "users/u1/voice-sample/a.m4a" }]);
    dbMock.customVoice.updateMany.mockResolvedValue({ count: 1 });
    const storage = createFakeStorage([]);

    const result = await enforceRetention(storage, clock);

    expect(storage.deletedBatches).toEqual([["users/u1/voice-sample/a.m4a"]]);
    expect(result.byCategory.VOICE_SAMPLE).toBe(1);
  });

  it("clears samplePathname and stamps sampleDeletedAt rather than deleting the CustomVoice row", async () => {
    dbMock.customVoice.findMany.mockResolvedValue([{ id: "cv_1", samplePathname: "users/u1/voice-sample/a.m4a" }]);
    dbMock.customVoice.updateMany.mockResolvedValue({ count: 1 });

    await enforceRetention(createFakeStorage([]), clock);

    // The voice itself survives — only the raw recording expires. Deleting the
    // row would take the persona and the consent binding with it.
    const update = dbMock.customVoice.updateMany.mock.calls[0][0];
    expect(update.data.samplePathname).toBeNull();
    expect(update.data.sampleDeletedAt).toBeInstanceOf(Date);
    expect(dbMock.customVoice.updateMany).toHaveBeenCalledTimes(1);
  });

  it("touches nothing when no sample is past its window", async () => {
    dbMock.customVoice.findMany.mockResolvedValue([]);
    const storage = createFakeStorage([]);

    const result = await enforceRetention(storage, clock);

    expect(dbMock.customVoice.updateMany).not.toHaveBeenCalled();
    expect(storage.deletedBatches).toEqual([]);
    expect(result.byCategory.VOICE_SAMPLE).toBe(0);
  });

  it("only considers rows that still HAVE a sample", async () => {
    await enforceRetention(createFakeStorage([]), clock);

    const where = dbMock.customVoice.findMany.mock.calls[0][0].where as { samplePathname?: unknown };
    // Without this clause the sweep would re-select already-cleared rows on
    // every run and hand `storage.del` a list of nulls, forever.
    expect(where.samplePathname).toEqual({ not: null });
  });
});

describe("VOICE_CONSENT_RECORDING (M6)", () => {
  it("deletes the audio and the row, blob first", async () => {
    dbMock.voiceConsentRecording.findMany.mockResolvedValue([
      { id: "vcr_1", pathname: "users/u1/voice-consent/a.m4a" },
    ]);
    dbMock.voiceConsentRecording.deleteMany.mockResolvedValue({ count: 1 });
    const storage = createFakeStorage([]);

    const result = await enforceRetention(storage, clock);

    expect(storage.deletedBatches).toEqual([["users/u1/voice-consent/a.m4a"]]);
    expect(result.byCategory.VOICE_CONSENT_RECORDING).toBe(1);
  });

  it("cuts off exactly VOICE_CONSENT_RECORDING_RETENTION_DAYS before now", async () => {
    await enforceRetention(createFakeStorage([]), clock);

    const where = dbMock.voiceConsentRecording.findMany.mock.calls[0][0].where as { createdAt: { lte: Date } };
    const expected = new Date(NOW.getTime() - VOICE_CONSENT_RECORDING_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    expect(where.createdAt.lte).toEqual(expected);
  });

  it("keeps the consent recording far longer than the sample it evidences", () => {
    // The relationship is the point, not the numbers: the artifact answering
    // "was this authorised" must outlive the voice it authorised.
    expect(VOICE_CONSENT_RECORDING_RETENTION_DAYS).toBeGreaterThan(VOICE_SAMPLE_RETENTION_DAYS);
  });
});
