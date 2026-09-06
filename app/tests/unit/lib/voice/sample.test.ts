import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `lib/voice/sample.ts` — M6 AC 6/9/11. The grant for the voice SAMPLE.
 *
 * Stateful db mock rather than fixed-return stubs, for the reason
 * `consent.test.ts` gives: the query SHAPES here are the security properties
 * (scoped to the caller, current wording, not already spent), and a stub that
 * returns the same row whatever it was asked cannot catch a shape bug.
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
  consentWordingVersion: string;
  spent: boolean;
};

let grants: Grant[];
let recordings: Recording[];
let nextId: number;

const dbMock = {
  voiceUploadGrant: {
    /** Same discipline as `findFirst` below — only the filters actually passed. */
    count: vi.fn(async ({ where }: { where: Record<string, { gte: Date } | string | undefined> }) => {
      return grants.filter((g) => {
        if ("userId" in where && g.userId !== where.userId) return false;
        const created = where.createdAt as { gte: Date } | undefined;
        if (created && g.createdAt < created.gte) return false;
        return true;
      }).length;
    }),
    create: vi.fn(async ({ data }: { data: Omit<Grant, "id" | "consumedAt" | "createdAt"> }) => {
      const grant: Grant = { id: `grant_${nextId++}`, consumedAt: null, createdAt: new Date(), ...data };
      grants.push(grant);
      return grant;
    }),
    /** Only the filters actually passed — see the note on the recording mock. */
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const match = grants.find((g) => {
        if ("id" in where && g.id !== where.id) return false;
        if ("userId" in where && g.userId !== where.userId) return false;
        if ("purpose" in where && g.purpose !== where.purpose) return false;
        return true;
      });
      return match ?? null;
    }),
  },
  voiceConsentRecording: {
    /**
     * Applies ONLY the filters the caller actually passed, rather than
     * hardcoding the four we expect. This matters more than it looks: a mock
     * that always filters by `userId` keeps passing when production STOPS
     * filtering by `userId`, so the cross-account test would be asserting
     * against the mock rather than the code. Caught by mutation testing —
     * dropping the `customVoice` filter left every test green.
     */
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const match = recordings.find((r) => {
        if ("id" in where && r.id !== where.id) return false;
        if ("userId" in where && r.userId !== where.userId) return false;
        if ("consentWordingVersion" in where && r.consentWordingVersion !== where.consentWordingVersion) return false;
        // `customVoice: { is: null }` — not yet spent on a voice.
        if ("customVoice" in where && r.spent) return false;
        return true;
      });
      return match ?? null;
    }),
  },
};
vi.mock("@/lib/db", () => ({ db: dbMock }));

const { issueSampleGrant, voiceSamplePathname, authorizeVoiceUpload } = await import("@/lib/voice/sample");
const { VOICE_CONSENT_WORDING_VERSION } = await import("@/lib/voice/consent-copy");
const { VOICE_SAMPLE_MIN_MS, VOICE_SAMPLE_MAX_MS, VOICE_ATTEMPTS_PER_WINDOW } = await import("@/lib/config");

const USER = "user_1";
const GOOD_MS = Math.floor((VOICE_SAMPLE_MIN_MS + VOICE_SAMPLE_MAX_MS) / 2);

function seedRecording(over: Partial<Recording> = {}): Recording {
  const row: Recording = {
    id: `vcr_${nextId++}`,
    userId: USER,
    consentWordingVersion: VOICE_CONSENT_WORDING_VERSION,
    spent: false,
    ...over,
  };
  recordings.push(row);
  return row;
}

function args(over: Partial<Parameters<typeof issueSampleGrant>[0]> = {}) {
  return {
    userId: USER,
    contentType: "audio/webm",
    extension: "webm",
    durationMs: GOOD_MS,
    consentRecordingId: recordings[0]?.id ?? "vcr_missing",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  grants = [];
  recordings = [];
  nextId = 1;
});

describe("the happy path", () => {
  it("issues a grant with a server-chosen pathname under the caller's own prefix", async () => {
    const rec = seedRecording();

    const result = await issueSampleGrant(args());

    expect(result).toMatchObject({ ok: true, consentRecordingId: rec.id });
    if (!result.ok) throw new Error("unreachable");
    expect(result.pathname).toMatch(new RegExp(`^users/${USER}/voice-sample/[0-9a-f-]{36}\\.webm$`));
    expect(grants[0].purpose).toBe("VOICE_SAMPLE");
  });

  it("never reuses a pathname across two grants", async () => {
    seedRecording();
    const a = await issueSampleGrant(args());
    const b = await issueSampleGrant(args());
    if (!a.ok || !b.ok) throw new Error("unreachable");
    expect(a.pathname).not.toBe(b.pathname);
  });
});

describe("AC 6 / AC 5 — no sample without a usable consent recording", () => {
  it("refuses when the account has no consent recording at all", async () => {
    expect(await issueSampleGrant(args())).toEqual({ ok: false, code: "NO_USABLE_CONSENT" });
    expect(grants).toHaveLength(0);
  });

  it("refuses a recording that belongs to ANOTHER account", async () => {
    const other = seedRecording({ userId: "user_2" });
    const result = await issueSampleGrant(args({ consentRecordingId: other.id }));
    // Indistinguishable from "does not exist" — M1 AC 33's rule.
    expect(result).toEqual({ ok: false, code: "NO_USABLE_CONSENT" });
    expect(grants).toHaveLength(0);
  });

  it("refuses a recording made against SUPERSEDED wording", async () => {
    const stale = seedRecording({ consentWordingVersion: "2026-01-01.1" });
    expect(await issueSampleGrant(args({ consentRecordingId: stale.id }))).toEqual({
      ok: false,
      code: "NO_USABLE_CONSENT",
    });
  });

  it("refuses a recording already spent on a voice — one consent, one clone", async () => {
    const spent = seedRecording({ spent: true });
    expect(await issueSampleGrant(args({ consentRecordingId: spent.id }))).toEqual({
      ok: false,
      code: "NO_USABLE_CONSENT",
    });
  });
});

describe("AC 9 — duration bounds", () => {
  it.each([
    ["below the minimum", VOICE_SAMPLE_MIN_MS - 1],
    ["above the maximum", VOICE_SAMPLE_MAX_MS + 1],
  ])("refuses a sample %s", async (_label, durationMs) => {
    seedRecording();
    expect(await issueSampleGrant(args({ durationMs }))).toEqual({ ok: false, code: "DURATION_OUT_OF_BOUNDS" });
    expect(grants).toHaveLength(0);
  });

  it.each([
    ["exactly the minimum", VOICE_SAMPLE_MIN_MS],
    ["exactly the maximum", VOICE_SAMPLE_MAX_MS],
  ])("accepts a sample of %s", async (_label, durationMs) => {
    seedRecording();
    expect((await issueSampleGrant(args({ durationMs }))).ok).toBe(true);
  });

  it("rejects on duration BEFORE touching the database, so a bad length burns nothing", async () => {
    seedRecording();
    await issueSampleGrant(args({ durationMs: 1 }));
    expect(dbMock.voiceConsentRecording.findFirst).not.toHaveBeenCalled();
    expect(dbMock.voiceUploadGrant.count).not.toHaveBeenCalled();
  });
});

describe("format and rate limiting", () => {
  it("refuses a content type outside the recorder allowlist", async () => {
    seedRecording();
    expect(await issueSampleGrant(args({ contentType: "application/zip" }))).toEqual({
      ok: false,
      code: "UNSUPPORTED_TYPE",
    });
  });

  it("counts consent grants against the same window, so the budget is not doubled", async () => {
    seedRecording();
    // Fill the window with CONSENT_STATEMENT grants, the other purpose.
    for (let i = 0; i < VOICE_ATTEMPTS_PER_WINDOW; i++) {
      grants.push({
        id: `pre_${i}`,
        userId: USER,
        purpose: "CONSENT_STATEMENT",
        pathname: `users/${USER}/voice-consent/${i}.webm`,
        contentType: "audio/webm",
        consumedAt: null,
        createdAt: new Date(),
      });
    }
    expect(await issueSampleGrant(args())).toEqual({ ok: false, code: "RATE_LIMITED" });
  });

  it("does not count another account's grants against this caller", async () => {
    seedRecording();
    for (let i = 0; i < VOICE_ATTEMPTS_PER_WINDOW; i++) {
      grants.push({
        id: `other_${i}`,
        userId: "user_2",
        purpose: "VOICE_SAMPLE",
        pathname: `users/user_2/voice-sample/${i}.webm`,
        contentType: "audio/webm",
        consumedAt: null,
        createdAt: new Date(),
      });
    }
    expect((await issueSampleGrant(args())).ok).toBe(true);
  });
});

describe("voiceSamplePathname", () => {
  it("uses a prefix distinct from the consent recording's, so retention can target it", () => {
    expect(voiceSamplePathname(USER, "webm")).toContain(`users/${USER}/voice-sample/`);
  });
});

describe("the two content-type lists must not drift", () => {
  it("config's ALLOWED_VOICE_CONTENT_TYPES matches naming.ts's extension map exactly", async () => {
    // `lib/config.ts` is shared code and cannot import the server-only
    // `lib/voice/naming.ts`, so the list is spelled twice. A type accepted by
    // the API boundary but unknown to the extension map would be stored with a
    // `.bin` extension; one known to the map but absent from config would be
    // refused at the boundary despite being supported. Neither fails anything
    // else — exactly the silent class the M6 guards exist for.
    const { ALLOWED_VOICE_CONTENT_TYPES } = await import("@/lib/config");
    const { ACCEPTED_VOICE_CONTENT_TYPES } = await import("@/lib/voice/naming");
    expect([...ALLOWED_VOICE_CONTENT_TYPES].sort()).toEqual([...ACCEPTED_VOICE_CONTENT_TYPES].sort());
  });
});

describe("authorizeVoiceUpload — the upload itself", () => {
  function seedGrant(over: Partial<Grant> = {}): Grant {
    const g: Grant = {
      id: `grant_${nextId++}`,
      userId: USER,
      purpose: "VOICE_SAMPLE",
      pathname: `users/${USER}/voice-sample/abc.webm`,
      contentType: "audio/webm",
      consumedAt: null,
      createdAt: new Date(),
      ...over,
    };
    grants.push(g);
    return g;
  }

  it("authorizes the grant's own pathname", async () => {
    const g = seedGrant();
    expect(await authorizeVoiceUpload({ userId: USER, grantId: g.id, pathname: g.pathname })).toEqual({
      ok: true,
      pathname: g.pathname,
      contentType: "audio/webm",
    });
  });

  it("refuses a DIFFERENT pathname — the client cannot name the object (AC 4)", async () => {
    const g = seedGrant();
    expect(
      await authorizeVoiceUpload({ userId: USER, grantId: g.id, pathname: `users/${USER}/voice-sample/other.webm` }),
    ).toEqual({ ok: false, code: "PATHNAME_MISMATCH" });
  });

  it("refuses another account's grant", async () => {
    const g = seedGrant({ userId: "user_2" });
    expect(await authorizeVoiceUpload({ userId: USER, grantId: g.id, pathname: g.pathname })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
  });

  it("refuses a grant that was already consumed, so a spent grant cannot be replayed", async () => {
    const g = seedGrant({ consumedAt: new Date() });
    expect(await authorizeVoiceUpload({ userId: USER, grantId: g.id, pathname: g.pathname })).toEqual({
      ok: false,
      code: "ALREADY_USED",
    });
  });

  it("refuses a grant id that does not exist", async () => {
    expect(await authorizeVoiceUpload({ userId: USER, grantId: "nope", pathname: "x" })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
  });
});
