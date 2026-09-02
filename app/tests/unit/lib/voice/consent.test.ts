import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `lib/voice/consent.ts` — M6 AC 5/6/7. The grant that makes AC 4 enforceable,
 * and the confirm that turns an upload into the durable consent record.
 *
 * The db mock is STATEFUL rather than a fixed-return stub, the same technique
 * `purge.test.ts` and `generate.test.ts` use: a stub that returns the same row
 * whatever it was asked cannot catch a query-shape bug, and the shapes here are
 * the security properties (scoped to the caller, single-use, current wording).
 */

type Grant = {
  id: string;
  userId: string;
  purpose: string;
  pathname: string;
  contentType: string;
  consumedAt: Date | null;
  createdAt: Date;
};
type Recording = {
  id: string;
  userId: string;
  pathname: string;
  consentWordingVersion: string;
  durationMs: number;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  spent: boolean;
};

let grants: Grant[];
let recordings: Recording[];
let nextId: number;

const dbMock = {
  voiceUploadGrant: {
    count: vi.fn(async ({ where }: { where: { userId: string; createdAt: { gte: Date } } }) =>
      grants.filter((g) => g.userId === where.userId && g.createdAt >= where.createdAt.gte).length,
    ),
    create: vi.fn(async ({ data }: { data: Omit<Grant, "id" | "consumedAt" | "createdAt"> }) => {
      const grant: Grant = { id: `grant_${nextId++}`, consumedAt: null, createdAt: new Date(), ...data };
      grants.push(grant);
      return grant;
    }),
    findFirst: vi.fn(async ({ where }: { where: { id: string; userId: string; purpose: string } }) =>
      grants.find((g) => g.id === where.id && g.userId === where.userId && g.purpose === where.purpose) ?? null,
    ),
    updateMany: vi.fn(async ({ where }: { where: { id: string; consumedAt: null } }) => {
      const grant = grants.find((g) => g.id === where.id && g.consumedAt === null);
      if (!grant) return { count: 0 };
      grant.consumedAt = new Date();
      return { count: 1 };
    }),
  },
  voiceConsentRecording: {
    create: vi.fn(async ({ data }: { data: Omit<Recording, "id" | "createdAt" | "spent"> }) => {
      const row: Recording = { id: `vcr_${nextId++}`, createdAt: new Date(), spent: false, ...data };
      recordings.push(row);
      return row;
    }),
    findFirst: vi.fn(
      async ({ where }: { where: { userId: string; consentWordingVersion: string; customVoice: { is: null } } }) =>
        recordings.find(
          (r) =>
            r.userId === where.userId &&
            r.consentWordingVersion === where.consentWordingVersion &&
            // `customVoice: { is: null }` — not yet spent on a voice.
            !r.spent,
        ) ?? null,
    ),
  },
};
vi.mock("@/lib/db", () => ({ db: dbMock }));

const { issueConsentGrant, confirmConsentRecording, findUsableConsentRecording, voiceConsentPathname } = await import(
  "@/lib/voice/consent"
);
const { VOICE_CONSENT_WORDING_VERSION } = await import("@/lib/voice/consent-copy");
const { VOICE_CONSENT_MIN_MS, VOICE_CONSENT_MAX_MS, VOICE_ATTEMPTS_PER_WINDOW } = await import("@/lib/config");

function fakeStorage(head: unknown = { contentType: "audio/webm", sizeBytes: 1000 }) {
  return {
    head: vi.fn(async () => head),
    put: vi.fn(),
    del: vi.fn(),
    readBytes: vi.fn(),
    signedReadUrl: vi.fn(),
    listAll: vi.fn(),
    handleClientUpload: vi.fn(),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  grants = [];
  recordings = [];
  nextId = 1;
});

describe("issueConsentGrant — the pathname is ours, never theirs (AC 4)", () => {
  it("mints a user-scoped pathname the client never proposed", async () => {
    const result = await issueConsentGrant({ userId: "u1", contentType: "audio/webm", extension: "webm" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pathname).toMatch(/^users\/u1\/voice-consent\/[0-9a-f-]{36}\.webm$/);
  });

  it("never returns the same pathname twice", () => {
    const seen = new Set(Array.from({ length: 25 }, () => voiceConsentPathname("u1", "webm")));
    expect(seen.size).toBe(25);
  });

  it("refuses a format no in-app recorder produces", async () => {
    const result = await issueConsentGrant({ userId: "u1", contentType: "application/json", extension: "webm" });
    expect(result).toEqual({ ok: false, code: "UNSUPPORTED_TYPE" });
    expect(dbMock.voiceUploadGrant.create).not.toHaveBeenCalled();
  });

  it("rate-limits per account, and counts scoped to that account", async () => {
    for (let i = 0; i < VOICE_ATTEMPTS_PER_WINDOW; i++) {
      expect((await issueConsentGrant({ userId: "u1", contentType: "audio/webm", extension: "webm" })).ok).toBe(true);
    }

    expect(await issueConsentGrant({ userId: "u1", contentType: "audio/webm", extension: "webm" })).toEqual({
      ok: false,
      code: "RATE_LIMITED",
    });
    // A different account is unaffected — a cap keyed on anything but the caller
    // would throttle strangers.
    expect((await issueConsentGrant({ userId: "u2", contentType: "audio/webm", extension: "webm" })).ok).toBe(true);
  });
});

describe("confirmConsentRecording", () => {
  async function grantFor(userId = "u1") {
    const result = await issueConsentGrant({ userId, contentType: "audio/webm", extension: "webm" });
    if (!result.ok) throw new Error("grant failed");
    return result;
  }

  const GOOD_MS = Math.round((VOICE_CONSENT_MIN_MS + VOICE_CONSENT_MAX_MS) / 2);

  /**
   * This is the test that would have caught the bug this endpoint shipped with
   * for ten minutes: the route read `durationMs` from a place that always
   * yielded 0, so every confirm failed the bounds check. It typechecked
   * perfectly. Asserting the HAPPY path is what catches a wiring error that
   * every failure-path test would happily pass.
   */
  it("writes the recording on a well-formed confirm", async () => {
    const grant = await grantFor();

    const result = await confirmConsentRecording(fakeStorage(), {
      userId: "u1",
      grantId: grant.grantId,
      durationMs: GOOD_MS,
      ipAddress: "203.0.113.7",
      userAgent: "Mozilla/5.0",
    });

    expect(result).toMatchObject({ ok: true });
    expect(recordings).toHaveLength(1);
    expect(recordings[0]).toMatchObject({
      userId: "u1",
      pathname: grant.pathname,
      consentWordingVersion: VOICE_CONSENT_WORDING_VERSION,
      durationMs: GOOD_MS,
      ipAddress: "203.0.113.7",
      userAgent: "Mozilla/5.0",
    });
  });

  it("stamps the CURRENT wording version, so the row says which words were read", async () => {
    const grant = await grantFor();
    await confirmConsentRecording(fakeStorage(), {
      userId: "u1",
      grantId: grant.grantId,
      durationMs: GOOD_MS,
      ipAddress: null,
      userAgent: null,
    });
    expect(recordings[0].consentWordingVersion).toBe(VOICE_CONSENT_WORDING_VERSION);
  });

  it("rejects a duration outside the bounds, without burning the grant", async () => {
    const grant = await grantFor();

    for (const durationMs of [VOICE_CONSENT_MIN_MS - 1, VOICE_CONSENT_MAX_MS + 1]) {
      const result = await confirmConsentRecording(fakeStorage(), {
        userId: "u1",
        grantId: grant.grantId,
        durationMs,
        ipAddress: null,
        userAgent: null,
      });
      expect(result).toEqual({ ok: false, code: "DURATION_OUT_OF_BOUNDS" });
    }

    // Still usable: a recording the browser should have caught must not cost the
    // parent their grant and send them back to the start of the flow.
    expect(grants[0].consumedAt).toBeNull();
  });

  it("refuses when the object never landed, rather than evidencing nothing", async () => {
    const grant = await grantFor();

    const result = await confirmConsentRecording(fakeStorage(null), {
      userId: "u1",
      grantId: grant.grantId,
      durationMs: GOOD_MS,
      ipAddress: null,
      userAgent: null,
    });

    // AC 6 refuses voice creation without a recording; a recording pointing at
    // no audio would satisfy that check while proving nothing.
    expect(result).toEqual({ ok: false, code: "NO_OBJECT" });
    expect(recordings).toHaveLength(0);
  });

  it("is single-use", async () => {
    const grant = await grantFor();
    const args = {
      userId: "u1",
      grantId: grant.grantId,
      durationMs: GOOD_MS,
      ipAddress: null,
      userAgent: null,
    };

    expect(await confirmConsentRecording(fakeStorage(), args)).toMatchObject({ ok: true });
    expect(await confirmConsentRecording(fakeStorage(), args)).toEqual({ ok: false, code: "ALREADY_USED" });
    expect(recordings).toHaveLength(1);
  });

  it("claims the grant with a guarded update, so two concurrent confirms cannot both write", async () => {
    const grant = await grantFor();
    const args = {
      userId: "u1",
      grantId: grant.grantId,
      durationMs: GOOD_MS,
      ipAddress: null,
      userAgent: null,
    };

    const [a, b] = await Promise.all([
      confirmConsentRecording(fakeStorage(), args),
      confirmConsentRecording(fakeStorage(), args),
    ]);

    // Exactly one wins. The guard is `updateMany({ where: { consumedAt: null } })`
    // — a read-then-write would let both through, which is the shape M4's review
    // found in its own claim path.
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(recordings).toHaveLength(1);
  });

  it("cannot confirm another account's grant", async () => {
    const grant = await grantFor("u1");

    const result = await confirmConsentRecording(fakeStorage(), {
      userId: "u2",
      grantId: grant.grantId,
      durationMs: GOOD_MS,
      ipAddress: null,
      userAgent: null,
    });

    // NOT_FOUND, not FORBIDDEN — another account's grant is indistinguishable
    // from a nonexistent one (M1 AC 33's rule).
    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(recordings).toHaveLength(0);
  });
});

describe("findUsableConsentRecording — AC 6's gate", () => {
  async function record(userId: string) {
    const grant = await issueConsentGrant({ userId, contentType: "audio/webm", extension: "webm" });
    if (!grant.ok) throw new Error("grant failed");
    return confirmConsentRecording(fakeStorage(), {
      userId,
      grantId: grant.grantId,
      durationMs: Math.round((VOICE_CONSENT_MIN_MS + VOICE_CONSENT_MAX_MS) / 2),
      ipAddress: null,
      userAgent: null,
    });
  }

  it("finds a fresh recording for this account", async () => {
    await record("u1");
    expect(await findUsableConsentRecording("u1")).not.toBeNull();
  });

  it("finds nothing for an account that never recorded one", async () => {
    await record("u1");
    expect(await findUsableConsentRecording("u2")).toBeNull();
  });

  it("ignores a recording made against older wording", async () => {
    await record("u1");
    recordings[0].consentWordingVersion = "2020-01-01.1";

    // The stored row still says which words were actually read — that is why the
    // version lives on the row. It simply does not authorise a NEW clone.
    expect(await findUsableConsentRecording("u1")).toBeNull();
  });

  it("ignores a recording already spent on a voice", async () => {
    await record("u1");
    recordings[0].spent = true;

    // One recording authorises one clone. A second clone is a second act and
    // needs its own spoken consent.
    expect(await findUsableConsentRecording("u1")).toBeNull();
  });
});
