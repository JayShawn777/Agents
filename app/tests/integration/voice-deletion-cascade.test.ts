import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { configureDirectDatabaseUrl } from "./db-test-url";

configureDirectDatabaseUrl();

/**
 * **M6 AC 18/19/20/21, against real Postgres.** The plan calls slice 7 the
 * highest-risk slice, and the reason is cascades: M3's and M4's reviews each
 * found one that was asserted in a mock and wrong in the database.
 *
 * What only a real database can answer here: whether deleting a `Persona`
 * actually takes its `CustomVoice` with it (declared `onDelete: Cascade`),
 * whether `StudentProfile.personaId` really goes NULL rather than blocking the
 * delete (`SetNull`), and whether `VoiceCreationAudit` — which deliberately has
 * NO foreign keys — genuinely survives the account purge it exists to record. A
 * stateful fake would answer each of those with whatever its author believed the
 * schema said.
 */

const deleteVoiceMock = vi.fn(async () => ({ ok: true, alreadyGone: false }));
vi.mock("@/lib/voice/provider", () => ({ deleteVoice: deleteVoiceMock }));

const { db } = await import("@/lib/db");
const { deleteCustomVoice, revokeCustomVoice, deleteAllCustomVoicesForUser } = await import("@/lib/voice/delete");

process.env.AUDIT_PSEUDONYM_KEY ??= "integration-test-key";

const createdUserIds: string[] = [];

afterAll(async () => {
  for (const id of createdUserIds) {
    await db.voiceCreationAudit.deleteMany({ where: { userId: id } }).catch(() => {});
    await db.user.delete({ where: { id } }).catch(() => {});
  }
});

const storage = {
  del: vi.fn(async () => {}),
  head: vi.fn(), readBytes: vi.fn(), put: vi.fn(),
  signedReadUrl: vi.fn(), listAll: vi.fn(), handleClientUpload: vi.fn(),
} as never;

/** A whole account with a cloned voice, a profile using it, and cached audio. */
async function seedAccountWithVoice(tag: string) {
  const unique = `${Date.now()}-${Math.random()}`;
  const user = await db.user.create({
    data: { email: `voice-del-${tag}-${unique}@example.com`, adultAttestedAt: new Date() },
  });
  createdUserIds.push(user.id);

  const recording = await db.voiceConsentRecording.create({
    data: {
      userId: user.id,
      pathname: `users/${user.id}/voice-consent/${unique}.webm`,
      consentWordingVersion: "2026-09-02.2",
      durationMs: 12_000,
    },
  });

  const persona = await db.persona.create({
    data: {
      slug: `custom-${tag}-${unique}`,
      label: "Dad",
      description: "A voice recorded by the account holder.",
      artworkId: "preset-custom-voice",
      providerVoiceId: `pv_${tag}_${unique}`,
      sortOrder: 0,
      ownerUserId: user.id,
    },
  });

  const customVoice = await db.customVoice.create({
    data: {
      userId: user.id,
      personaId: persona.id,
      voiceConsentRecordingId: recording.id,
      samplePathname: `users/${user.id}/voice-sample/${unique}.webm`,
      providerVoiceId: persona.providerVoiceId,
    },
  });

  const profile = await db.studentProfile.create({
    data: { userId: user.id, ageBand: "UNDER_13", status: "ACTIVE", personaId: persona.id },
  });

  const asset = await db.narrationAsset.create({
    data: {
      studentProfileId: profile.id,
      personaId: persona.id,
      cacheKey: `ck_${unique}`,
      providerVoiceId: persona.providerVoiceId,
      pathname: `students/${profile.id}/narration/${unique}.mp3`,
      ttsModelId: "eleven_flash_v2_5",
      contentType: "audio/mpeg",
      durationMs: 3000,
      sizeBytes: 1234,
      characterCount: 42,
      cues: [],
      cueFormatVersion: "1",
    },
  });

  return { user, persona, customVoice, profile, asset, recording };
}

beforeEach(() => {
  vi.clearAllMocks();
  deleteVoiceMock.mockResolvedValue({ ok: true, alreadyGone: false });
});

describe("AC 19 — explicit deletion reaches every store", () => {
  it("removes the persona, the CustomVoice cascade, and the cached audio", async () => {
    const seeded = await seedAccountWithVoice("explicit");

    const result = await deleteCustomVoice(storage, {
      userId: seeded.user.id,
      userEmail: seeded.user.email,
      personaId: seeded.persona.id,
    });

    expect(result).toMatchObject({ ok: true, removal: { vendorDeleted: true } });
    expect(deleteVoiceMock).toHaveBeenCalledWith(seeded.persona.providerVoiceId);
    expect(await db.persona.findUnique({ where: { id: seeded.persona.id } })).toBeNull();
    // Declared `onDelete: Cascade` — asserted here rather than trusted.
    expect(await db.customVoice.findUnique({ where: { id: seeded.customVoice.id } })).toBeNull();
    expect(await db.narrationAsset.findUnique({ where: { id: seeded.asset.id } })).toBeNull();
  });

  it("leaves the profile intact with a NULL persona — AC 18's fallback, by SetNull", async () => {
    const seeded = await seedAccountWithVoice("fallback");

    await deleteCustomVoice(storage, {
      userId: seeded.user.id,
      userEmail: seeded.user.email,
      personaId: seeded.persona.id,
    });

    const profile = await db.studentProfile.findUnique({ where: { id: seeded.profile.id } });
    // The child must NOT be deleted along with the voice, and must not be left
    // pointing at a persona that no longer exists. NULL means "the default".
    expect(profile).not.toBeNull();
    expect(profile!.personaId).toBeNull();
  });

  it("refuses another account's persona and changes nothing", async () => {
    const mine = await seedAccountWithVoice("mine");
    const theirs = await seedAccountWithVoice("theirs");

    const result = await deleteCustomVoice(storage, {
      userId: mine.user.id,
      userEmail: mine.user.email,
      personaId: theirs.persona.id,
    });

    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await db.persona.findUnique({ where: { id: theirs.persona.id } })).not.toBeNull();
    expect(deleteVoiceMock).not.toHaveBeenCalled();
  });
});

describe("AC 18 — revocation keeps the row and the audio", () => {
  it("marks REVOKED, nulls the profile's choice, keeps cached audio", async () => {
    const seeded = await seedAccountWithVoice("revoke");

    const result = await revokeCustomVoice({
      userId: seeded.user.id,
      userEmail: seeded.user.email,
      personaId: seeded.persona.id,
    });

    expect(result).toMatchObject({ ok: true });
    const persona = await db.persona.findUnique({ where: { id: seeded.persona.id } });
    expect(persona!.status).toBe("REVOKED");
    expect((await db.studentProfile.findUnique({ where: { id: seeded.profile.id } }))!.personaId).toBeNull();
    // AC 19 is a separate act: a child mid-lesson does not lose the lesson
    // because a parent changed a setting.
    expect(await db.narrationAsset.findUnique({ where: { id: seeded.asset.id } })).not.toBeNull();
  });
});

describe("AC 20/21 — account deletion, and the audit that must outlive it", () => {
  it("deletes the voice at the vendor and leaves an audit row that survives the purge", async () => {
    const seeded = await seedAccountWithVoice("purge");

    await deleteAllCustomVoicesForUser(storage, {
      userId: seeded.user.id,
      userEmail: seeded.user.email,
    });
    expect(deleteVoiceMock).toHaveBeenCalledWith(seeded.persona.providerVoiceId);

    // Now destroy the account itself, as `purgeClosedAccounts` does.
    await db.user.delete({ where: { id: seeded.user.id } });

    // VoiceCreationAudit has NO foreign keys precisely so this survives. If it
    // had one to User, the record of the deletion would be destroyed by the
    // deletion — and nobody would ever know a vendor call had failed.
    const audits = await db.voiceCreationAudit.findMany({
      where: { providerVoiceId: seeded.persona.providerVoiceId },
    });
    expect(audits.length).toBeGreaterThan(0);
    expect(audits[0].event).toBe("DELETED");
  });

  it("records VENDOR_DELETE_FAILED when the vendor refuses, and still purges locally", async () => {
    const seeded = await seedAccountWithVoice("vendorfail");
    deleteVoiceMock.mockResolvedValue({ ok: false, failureCode: "UPSTREAM", retryable: true } as never);

    await deleteAllCustomVoicesForUser(storage, {
      userId: seeded.user.id,
      userEmail: seeded.user.email,
    });

    expect(await db.persona.findUnique({ where: { id: seeded.persona.id } })).toBeNull();
    const audits = await db.voiceCreationAudit.findMany({
      where: { providerVoiceId: seeded.persona.providerVoiceId },
    });
    // The operator's only signal that a real adult's voice is still at the
    // vendor. Nothing else in the system would ever surface it.
    expect(audits.map((a) => a.event)).toContain("VENDOR_DELETE_FAILED");
  });
});
