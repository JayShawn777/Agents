import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StoragePort } from "@/lib/storage/port";

/**
 * `lib/voice/delete.ts` — M6 AC 18/19/20/21.
 *
 * The property worth most here is the one that is invisible when it breaks: a
 * vendor deletion that fails must NOT abort the local deletion, and must leave
 * a `VENDOR_DELETE_FAILED` row naming the voice. Without the audit row an
 * operator has no way to know a model of a real adult's voice is still sitting
 * at the vendor — and nothing else would ever fail.
 */

const calls: string[] = [];
const audits: Record<string, unknown>[] = [];

let voiceRow: Record<string, unknown> | null;
let assets: { pathname: string }[];
let personas: { id: string }[];

const dbMock = {
  customVoice: {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if (!voiceRow) return null;
      if ("userId" in where && voiceRow.userId !== where.userId) return null;
      if ("personaId" in where && voiceRow.personaId !== where.personaId) return null;
      return voiceRow;
    }),
  },
  narrationAsset: {
    findMany: vi.fn(async () => assets),
    deleteMany: vi.fn(async () => { calls.push("assets.deleteRows"); return { count: assets.length }; }),
  },
  studentProfile: {
    updateMany: vi.fn(async () => { calls.push("profiles.fallback"); return { count: 1 }; }),
  },
  voiceCreationAudit: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      calls.push(`audit:${data.event}`);
      audits.push(data);
      return data;
    }),
  },
};
vi.mock("@/lib/db", () => ({ db: dbMock }));

const deleteVoiceMock = vi.fn();
vi.mock("@/lib/voice/provider", () => ({ deleteVoice: deleteVoiceMock }));

const HASHED = "0".repeat(64);
vi.mock("@/lib/consent/audit", () => ({ hashAdultIdentity: vi.fn(() => HASHED) }));

const deleteOwnedPersonaMock = vi.fn(async () => { calls.push("persona.delete"); return 1; });
const revokeOwnedPersonaMock = vi.fn(async () => { calls.push("persona.revoke"); return 1; });
const listOwnedPersonasMock = vi.fn(async () => personas);
vi.mock("@/lib/personas/dal", () => ({
  deleteOwnedPersona: deleteOwnedPersonaMock,
  revokeOwnedPersona: revokeOwnedPersonaMock,
  listOwnedPersonas: listOwnedPersonasMock,
}));

const { deleteCustomVoice, revokeCustomVoice, deleteAllCustomVoicesForUser } = await import("@/lib/voice/delete");

function storage() {
  return {
    del: vi.fn(async () => { calls.push("storage.del"); }),
    head: vi.fn(), readBytes: vi.fn(), put: vi.fn(),
    signedReadUrl: vi.fn(), listAll: vi.fn(), handleClientUpload: vi.fn(),
  };
}
const ARGS = { userId: "user_1", userEmail: "parent@example.com", personaId: "persona_1" };

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  audits.length = 0;
  assets = [{ pathname: "students/s1/narration/a.mp3" }];
  personas = [{ id: "persona_1" }];
  voiceRow = {
    userId: "user_1",
    personaId: "persona_1",
    providerVoiceId: "pv_1",
    samplePathname: null,
    consentRecording: { consentWordingVersion: "2026-09-02.2" },
  };
  deleteVoiceMock.mockResolvedValue({ ok: true, alreadyGone: false });
});

describe("AC 19 — the explicit delete", () => {
  it("calls the vendor BEFORE removing the rows that name the voice", async () => {
    await deleteCustomVoice(storage() as unknown as StoragePort, ARGS);
    // After `persona.delete` nothing in our database holds providerVoiceId.
    expect(calls.indexOf("audit:DELETED")).toBeLessThan(calls.indexOf("persona.delete"));
  });

  it("removes cached narration audio, blob-first then rows", async () => {
    const s = storage();
    await deleteCustomVoice(s as unknown as StoragePort, ARGS);
    expect(s.del).toHaveBeenCalledWith(["students/s1/narration/a.mp3"]);
    expect(calls.indexOf("storage.del")).toBeLessThan(calls.indexOf("assets.deleteRows"));
  });

  it("matches cached audio on providerVoiceId, not personaId", async () => {
    // `NarrationAsset.personaId` is SetNull. Matching on it would miss any row
    // whose persona had already gone — leaving a real adult's voice reading a
    // child's homework in the store, after a delete that claimed to remove it.
    await deleteCustomVoice(storage() as unknown as StoragePort, ARGS);
    expect(dbMock.narrationAsset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { providerVoiceId: "pv_1" } }),
    );
  });

  it("deletes the sample too when creation's own cleanup did not get it", async () => {
    voiceRow!.samplePathname = "users/user_1/voice-sample/a.webm";
    const s = storage();
    await deleteCustomVoice(s as unknown as StoragePort, ARGS);
    expect(s.del).toHaveBeenCalledWith(["users/user_1/voice-sample/a.webm"]);
  });

  it("refuses another account's persona as NOT_FOUND, touching nothing", async () => {
    const result = await deleteCustomVoice(storage() as unknown as StoragePort, { ...ARGS, userId: "user_2" });
    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(deleteVoiceMock).not.toHaveBeenCalled();
    expect(deleteOwnedPersonaMock).not.toHaveBeenCalled();
  });
});

describe("AC 21 — a vendor failure is recorded, never swallowed", () => {
  it("writes VENDOR_DELETE_FAILED and STILL completes the local deletion", async () => {
    deleteVoiceMock.mockResolvedValue({ ok: false, failureCode: "UPSTREAM", retryable: true });

    const result = await deleteCustomVoice(storage() as unknown as StoragePort, ARGS);

    expect(result).toMatchObject({ ok: true, removal: { vendorDeleted: false } });
    expect(audits[0]).toMatchObject({ event: "VENDOR_DELETE_FAILED", providerVoiceId: "pv_1", actorHash: HASHED });
    // The local half must still happen: refusing would leave the voice
    // selectable and narrating after the parent asked for it to be gone.
    expect(deleteOwnedPersonaMock).toHaveBeenCalled();
  });

  it("records the failure even when the vendor call THROWS", async () => {
    deleteVoiceMock.mockRejectedValue(new Error("socket hang up"));

    const result = await deleteCustomVoice(storage() as unknown as StoragePort, ARGS);

    expect(result).toMatchObject({ ok: true, removal: { vendorDeleted: false } });
    expect(audits[0]).toMatchObject({ event: "VENDOR_DELETE_FAILED" });
  });

  it("treats an already-gone vendor voice as success — the end state is what matters", async () => {
    deleteVoiceMock.mockResolvedValue({ ok: true, alreadyGone: true });
    const result = await deleteCustomVoice(storage() as unknown as StoragePort, ARGS);
    expect(result).toMatchObject({ ok: true, removal: { vendorDeleted: true } });
    expect(audits[0]).toMatchObject({ event: "DELETED" });
  });

  it("never puts the parent's email in the audit row", async () => {
    await deleteCustomVoice(storage() as unknown as StoragePort, ARGS);
    expect(JSON.stringify(audits[0])).not.toContain("parent@example.com");
  });
});

describe("AC 18 — revocation", () => {
  it("marks REVOKED, falls profiles back, and still deletes at the vendor", async () => {
    const result = await revokeCustomVoice(ARGS);

    expect(result).toMatchObject({ ok: true, removal: { vendorDeleted: true } });
    expect(revokeOwnedPersonaMock).toHaveBeenCalledWith("user_1", "persona_1");
    expect(dbMock.studentProfile.updateMany).toHaveBeenCalledWith({
      where: { personaId: "persona_1" },
      data: { personaId: null },
    });
  });

  it("keeps cached narration — that audio is AC 19's separate act", async () => {
    await revokeCustomVoice(ARGS);
    expect(dbMock.narrationAsset.deleteMany).not.toHaveBeenCalled();
  });

  it("does not delete the persona row, so cached audio keeps its attribution", async () => {
    await revokeCustomVoice(ARGS);
    expect(deleteOwnedPersonaMock).not.toHaveBeenCalled();
  });

  it("refuses another account's persona", async () => {
    expect(await revokeCustomVoice({ ...ARGS, userId: "user_2" })).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(deleteVoiceMock).not.toHaveBeenCalled();
  });
});

describe("AC 20 — every voice on the account", () => {
  it("deletes each owned persona's voice", async () => {
    personas = [{ id: "persona_1" }];
    const removals = await deleteAllCustomVoicesForUser(storage() as unknown as StoragePort, {
      userId: "user_1",
      userEmail: "parent@example.com",
    });
    expect(removals).toHaveLength(1);
    expect(removals[0]).toMatchObject({ providerVoiceId: "pv_1" });
  });

  it("skips a persona with no custom voice rather than failing the purge", async () => {
    // Shared personas are never owned, but a REVOKED-then-partially-cleaned row
    // must not stop an account purge that is already in flight.
    voiceRow = null;
    const removals = await deleteAllCustomVoicesForUser(storage() as unknown as StoragePort, {
      userId: "user_1",
      userEmail: "parent@example.com",
    });
    expect(removals).toEqual([]);
  });
});
