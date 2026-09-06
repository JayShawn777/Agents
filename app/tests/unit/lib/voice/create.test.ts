import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `lib/voice/create.ts` — M6 AC 13/14/15/21.
 *
 * The load-bearing property is an ORDERING one: the vendor call must happen
 * before any local row, so AC 14's "no persona row without a vendor voice id"
 * cannot be violated by a crash. Several tests assert call order rather than
 * final state, because the final state of a successful run looks identical
 * either way — it is only the failure paths that tell the two designs apart.
 */

type Grant = {
  id: string;
  userId: string;
  purpose: string;
  pathname: string;
  contentType: string;
  consumedAt: Date | null;
};

let grants: Grant[];
let personaCount: number;
let consumedInWindow: number;
const calls: string[] = [];

const created: Record<string, unknown[]> = {};
function record(table: string, data: unknown) {
  (created[table] ??= []).push(data);
}

const tx = {
  persona: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      calls.push("persona.create");
      record("persona", data);
      return { id: "persona_1", ...data };
    }),
  },
  customVoice: {
    create: vi.fn(async ({ data }: { data: unknown }) => {
      calls.push("customVoice.create");
      record("customVoice", data);
      return data;
    }),
  },
  voiceConsentRecording: {
    update: vi.fn(async ({ data }: { data: unknown }) => {
      record("recordingUpdate", data);
      return data;
    }),
  },
  voiceCreationAudit: {
    create: vi.fn(async ({ data }: { data: unknown }) => {
      calls.push("audit.create");
      record("audit", data);
      return data;
    }),
  },
};

const dbMock = {
  persona: { count: vi.fn(async () => personaCount) },
  voiceUploadGrant: {
    count: vi.fn(async () => consumedInWindow),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const g = grants.find((x) => {
        if ("id" in where && x.id !== where.id) return false;
        if ("userId" in where && x.userId !== where.userId) return false;
        if ("purpose" in where && x.purpose !== where.purpose) return false;
        return true;
      });
      return g ?? null;
    }),
    updateMany: vi.fn(async ({ where }: { where: { id: string; consumedAt: null } }) => {
      const g = grants.find((x) => x.id === where.id && x.consumedAt === null);
      if (!g) return { count: 0 };
      g.consumedAt = new Date();
      calls.push("grant.consume");
      return { count: 1 };
    }),
  },
  customVoice: { update: vi.fn(async () => { calls.push("sample.null"); return {}; }) },
  $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
};
vi.mock("@/lib/db", () => ({ db: dbMock }));

const createVoiceMock = vi.fn();
vi.mock("@/lib/voice/provider", () => ({ createVoice: createVoiceMock }));

const findUsableConsentRecordingMock = vi.fn();
vi.mock("@/lib/voice/consent", () => ({ findUsableConsentRecording: findUsableConsentRecordingMock }));

// An OPAQUE stand-in, deliberately: a fake hash that embedded its input would
// make the "no email in the audit row" assertion below pass on its own text.
const HASHED = "0".repeat(64);
vi.mock("@/lib/consent/audit", () => ({ hashAdultIdentity: vi.fn(() => HASHED) }));

const { createCustomVoice } = await import("@/lib/voice/create");
const { MAX_CUSTOM_VOICES_PER_USER, VOICE_ATTEMPTS_PER_WINDOW } = await import("@/lib/config");

const GRANT_ID = "grant_1";
const RECORDING = { id: "vcr_1", consentWordingVersion: "2026-09-02.2" };

/**
 * Returns the mock with its `vi.fn()` members still visible to TypeScript —
 * `as never` would satisfy the port's type and then make every
 * `expect(s.del)` an error.
 */
function storage(over: Record<string, unknown> = {}) {
  return {
    head: vi.fn(async () => ({ contentType: "audio/webm", sizeBytes: 1000 })),
    readBytes: vi.fn(async () => { calls.push("readBytes"); return new ArrayBuffer(8); }),
    del: vi.fn(async () => { calls.push("storage.del"); }),
    put: vi.fn(), signedReadUrl: vi.fn(), listAll: vi.fn(), handleClientUpload: vi.fn(),
    ...over,
  };
}

function run(s: ReturnType<typeof storage> = storage()) {
  return createCustomVoice(s as unknown as Parameters<typeof createCustomVoice>[0], {
    userId: "user_1",
    userEmail: "parent@example.com",
    sampleGrantId: GRANT_ID,
    label: "Dad",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  for (const k of Object.keys(created)) delete created[k];
  personaCount = 0;
  consumedInWindow = 0;
  grants = [
    { id: GRANT_ID, userId: "user_1", purpose: "VOICE_SAMPLE", pathname: "users/user_1/voice-sample/a.webm", contentType: "audio/webm", consumedAt: null },
  ];
  findUsableConsentRecordingMock.mockResolvedValue(RECORDING);
  createVoiceMock.mockResolvedValue({ ok: true, providerVoiceId: "pv_1", requiresVerification: false });
});

describe("AC 14 — the vendor call happens BEFORE any row", () => {
  it("creates the persona only after the vendor returns a voice id", async () => {
    await run();
    const vendorAt = calls.indexOf("readBytes");
    expect(vendorAt).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf("persona.create")).toBeGreaterThan(vendorAt);
    const persona = created.persona[0] as Record<string, unknown>;
    expect(persona).toMatchObject({ providerVoiceId: "pv_1" });
    // AC 12, the load-bearing field: a cloned voice is ONE account's property.
    // A create that omitted `ownerUserId` would publish a parent's real voice to
    // every account in the system, and nothing else here would fail.
    expect(persona.ownerUserId).toBe("user_1");
  });

  it("writes NO row at all when the vendor fails", async () => {
    createVoiceMock.mockResolvedValue({ ok: false, failureCode: "UPSTREAM", retryable: true });

    const result = await run();

    expect(result).toEqual({ ok: false, code: "VENDOR_FAILED", retryable: true });
    expect(tx.persona.create).not.toHaveBeenCalled();
    expect(tx.customVoice.create).not.toHaveBeenCalled();
    expect(tx.voiceCreationAudit.create).not.toHaveBeenCalled();
  });

  it("never returns the vendor's own failure code to the caller", async () => {
    createVoiceMock.mockResolvedValue({ ok: false, failureCode: "UNAUTHORIZED", retryable: false });
    const result = await run();
    expect(JSON.stringify(result)).not.toContain("UNAUTHORIZED");
  });
});

describe("AC 15 — cap and window", () => {
  it("refuses at the cap, before reading any bytes", async () => {
    personaCount = MAX_CUSTOM_VOICES_PER_USER;
    const s = storage();
    expect(await run(s)).toEqual({ ok: false, code: "CAP_REACHED" });
    expect(createVoiceMock).not.toHaveBeenCalled();
    expect(s.readBytes).not.toHaveBeenCalled();
  });

  it("counts only ACTIVE and PENDING_VERIFICATION toward the cap, not REVOKED", async () => {
    await run();
    expect(dbMock.persona.count).toHaveBeenCalledWith({
      where: { ownerUserId: "user_1", status: { in: ["ACTIVE", "PENDING_VERIFICATION"] } },
    });
  });

  it("refuses once the window's attempts are used up", async () => {
    consumedInWindow = VOICE_ATTEMPTS_PER_WINDOW;
    expect(await run()).toEqual({ ok: false, code: "RATE_LIMITED" });
    expect(createVoiceMock).not.toHaveBeenCalled();
  });
});

describe("the grant is single-use", () => {
  it("refuses a grant already consumed", async () => {
    grants[0].consumedAt = new Date();
    expect(await run()).toEqual({ ok: false, code: "GRANT_UNUSABLE" });
    expect(createVoiceMock).not.toHaveBeenCalled();
  });

  it("refuses another account's grant", async () => {
    grants[0].userId = "user_2";
    expect(await run()).toEqual({ ok: false, code: "GRANT_UNUSABLE" });
  });

  it("claims the grant BEFORE calling the vendor, so a concurrent create cannot double-bill", async () => {
    await run();
    expect(calls.indexOf("grant.consume")).toBeLessThan(calls.indexOf("readBytes"));
  });

  it("refuses when the compare-and-swap loses the race", async () => {
    dbMock.voiceUploadGrant.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await run()).toEqual({ ok: false, code: "GRANT_UNUSABLE" });
    expect(createVoiceMock).not.toHaveBeenCalled();
  });
});

describe("AC 6 — consent is re-checked at the last moment", () => {
  it("refuses when consent has gone since the grant was issued", async () => {
    findUsableConsentRecordingMock.mockResolvedValue(null);
    expect(await run()).toEqual({ ok: false, code: "NO_USABLE_CONSENT" });
    expect(createVoiceMock).not.toHaveBeenCalled();
  });

  it("refuses when the uploaded sample object is not there", async () => {
    expect(await run(storage({ head: vi.fn(async () => null) }) as ReturnType<typeof storage>)).toEqual({ ok: false, code: "SAMPLE_MISSING" });
    expect(createVoiceMock).not.toHaveBeenCalled();
  });
});

describe("AC 21 — the audit row", () => {
  it("records the event under a pseudonym, with no email in it", async () => {
    await run();
    const audit = created.audit[0] as Record<string, unknown>;
    expect(audit).toMatchObject({
      event: "CREATED",
      userId: "user_1",
      actorHash: HASHED,
      providerVoiceId: "pv_1",
      consentWordingVersion: RECORDING.consentWordingVersion,
    });
    expect(JSON.stringify(audit)).not.toContain("parent@example.com");
    expect(audit).not.toHaveProperty("email");
  });

  it("is written inside the SAME transaction as the persona", async () => {
    await run();
    expect(dbMock.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.voiceCreationAudit.create).toHaveBeenCalledTimes(1);
  });
});

describe("AC 13 — the demoted pending state", () => {
  it("is ACTIVE when the vendor does not require verification", async () => {
    const result = await run();
    expect(result).toEqual({ ok: true, personaId: "persona_1", status: "ACTIVE" });
  });

  it("is PENDING_VERIFICATION when the vendor says so, and the persona says so too", async () => {
    createVoiceMock.mockResolvedValue({ ok: true, providerVoiceId: "pv_1", requiresVerification: true });
    const result = await run();
    expect(result).toMatchObject({ ok: true, status: "PENDING_VERIFICATION" });
    expect(created.persona[0]).toMatchObject({ status: "PENDING_VERIFICATION" });
  });
});

describe("the sample is deleted as soon as the clone exists", () => {
  it("deletes the blob and nulls the pathname", async () => {
    const s = storage();
    await run(s);
    expect(s.del).toHaveBeenCalledWith(["users/user_1/voice-sample/a.webm"]);
    expect(dbMock.customVoice.update).toHaveBeenCalledWith({
      where: { personaId: "persona_1" },
      data: { samplePathname: null, sampleDeletedAt: expect.any(Date) },
    });
  });

  it("deletes the blob BEFORE nulling the column, so a failure leaves something to sweep", async () => {
    await run();
    expect(calls.indexOf("storage.del")).toBeLessThan(calls.indexOf("sample.null"));
  });

  it("still succeeds when deletion fails — the voice exists and works", async () => {
    const s = storage({ del: vi.fn(async () => { throw new Error("blob down"); }) }) as ReturnType<typeof storage>;
    expect(await run(s)).toMatchObject({ ok: true, status: "ACTIVE" });
  });

  it("never sends the parent's label to the vendor", async () => {
    await run();
    const sent = createVoiceMock.mock.calls[0][0] as { name: string };
    expect(sent.name).toBe("m6-vcr_1");
    expect(sent.name).not.toContain("Dad");
  });
});
