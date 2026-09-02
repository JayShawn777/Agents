import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `app/api/dev/local-object/route.ts` — the LOCAL-ONLY narration read route.
 * Same shape of proof as `local-upload-route.test.ts`: the fence
 * (`STORAGE_DRIVER !== "local"` -> 404, before ANY other check) must be
 * unconditional, and the `pathname` query parameter — attacker-controlled
 * input — must reject anything that is not exactly
 * `students/<id>/narration/<key>.mp3`, including traversal and absolute
 * paths, before it ever reaches `StoragePort`.
 */

const dalMock = {
  verifySession: vi.fn(async () => ({ userId: "user_1" }) as { userId: string } | null),
  requireStudentProfile: vi.fn(),
};
vi.mock("@/lib/auth/dal", () => dalMock);

const headMock = vi.fn();
const readBytesMock = vi.fn();
vi.mock("@/lib/storage/get-storage", () => ({
  getStoragePort: () => ({
    head: headMock,
    readBytes: readBytesMock,
  }),
}));

function localObjectRequest(pathname?: string) {
  const url = new URL("http://localhost/api/dev/local-object");
  if (pathname !== undefined) url.searchParams.set("pathname", pathname);
  return new Request(url, { method: "GET" });
}

const VALID_PATHNAME = "students/c000000000000000000000001/narration/deadbeef.mp3";

const originalStorageDriver = process.env.STORAGE_DRIVER;

beforeEach(() => {
  vi.clearAllMocks();
  dalMock.verifySession.mockResolvedValue({ userId: "user_1" });
});

afterEach(() => {
  process.env.STORAGE_DRIVER = originalStorageDriver;
  vi.resetModules();
});

describe("the fence: STORAGE_DRIVER !== 'local'", () => {
  it("is 404 — the same shape as a route that doesn't exist — with a valid session and pathname", async () => {
    process.env.STORAGE_DRIVER = "vercel-blob";
    const { GET } = await import("@/app/api/dev/local-object/route");

    const res = await GET(localObjectRequest(VALID_PATHNAME));

    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: false; error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("the fence runs BEFORE the session is even checked", async () => {
    process.env.STORAGE_DRIVER = "vercel-blob";
    const { GET } = await import("@/app/api/dev/local-object/route");

    await GET(localObjectRequest(VALID_PATHNAME));

    expect(dalMock.verifySession).not.toHaveBeenCalled();
    expect(dalMock.requireStudentProfile).not.toHaveBeenCalled();
    expect(headMock).not.toHaveBeenCalled();
    expect(readBytesMock).not.toHaveBeenCalled();
  });

  it("refuses to boot at all under a typo'd STORAGE_DRIVER", async () => {
    process.env.STORAGE_DRIVER = "something-unexpected";
    // `lib/config.ts`'s zod validation throws on an unrecognised value at import
    // time. Renamed: this test used to be titled "also fences off an UNSET
    // STORAGE_DRIVER", which is a different case entirely and the one that was
    // actually broken — see the block below. A test whose title names a case its
    // body never exercises is worse than no test, because it reads like coverage.
    await expect(import("@/app/api/dev/local-object/route")).rejects.toThrow();
  });
});

/**
 * ─────────── the 2026-09-02 review: the fence defaulted OPEN ───────────
 *
 * `resolveStorageDriver()` returns `"local"` for BOTH an unset and an empty
 * `STORAGE_DRIVER`, so `STORAGE_DRIVER !== "local"` was satisfied by simply
 * omitting the variable — a deployment that forgot to configure it served this
 * route, verified with a probe returning 200 and the object's bytes.
 *
 * The fence now also checks `NODE_ENV === "production"`, which is the condition
 * that cannot be satisfied by omission.
 */
describe("the fence fails CLOSED on a missing environment (2026-09-02)", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalNodeEnv === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
    else (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
  });

  it("404s in production even when STORAGE_DRIVER is unset (the measured hole)", async () => {
    delete process.env.STORAGE_DRIVER;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    const { GET } = await import("@/app/api/dev/local-object/route");

    const res = await GET(localObjectRequest(VALID_PATHNAME));

    expect(res.status).toBe(404);
    expect(dalMock.verifySession).not.toHaveBeenCalled();
    expect(readBytesMock).not.toHaveBeenCalled();
  });

  it("404s in production even when STORAGE_DRIVER is the empty string", async () => {
    process.env.STORAGE_DRIVER = "";
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    const { GET } = await import("@/app/api/dev/local-object/route");

    const res = await GET(localObjectRequest(VALID_PATHNAME));

    expect(res.status).toBe(404);
    expect(readBytesMock).not.toHaveBeenCalled();
  });

  it("404s in production even when STORAGE_DRIVER is explicitly 'local'", async () => {
    // Belt and braces: "we are in production" alone closes the route, whatever
    // the driver says. A dev-only route has no production configuration.
    process.env.STORAGE_DRIVER = "local";
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    const { GET } = await import("@/app/api/dev/local-object/route");

    const res = await GET(localObjectRequest(VALID_PATHNAME));

    expect(res.status).toBe(404);
    expect(readBytesMock).not.toHaveBeenCalled();
  });

  it("still SERVES outside production with an unset STORAGE_DRIVER — the local default that makes narration audible", async () => {
    delete process.env.STORAGE_DRIVER;
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    dalMock.requireStudentProfile.mockResolvedValue({ id: "c000000000000000000000001" });
    headMock.mockResolvedValue({ contentType: "audio/mpeg", sizeBytes: 3 });
    readBytesMock.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
    const { GET } = await import("@/app/api/dev/local-object/route");

    const res = await GET(localObjectRequest(VALID_PATHNAME));

    // The fix must not close the route in the environment it exists for —
    // otherwise nobody can hear a word of the narration locally.
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
  });
});

describe("when STORAGE_DRIVER is 'local'", () => {
  it("401s with no session, before the pathname is even validated", async () => {
    process.env.STORAGE_DRIVER = "local";
    dalMock.verifySession.mockResolvedValue(null);
    const { GET } = await import("@/app/api/dev/local-object/route");

    const res = await GET(localObjectRequest("../../etc/passwd"));

    expect(res.status).toBe(401);
    expect(headMock).not.toHaveBeenCalled();
  });

  describe("pathname validation — attacker-controlled input", () => {
    const badPathnames = [
      "../../etc/passwd",
      "/etc/passwd",
      "students/c000000000000000000000001/narration/../../../etc/passwd.mp3",
      "students/c000000000000000000000001/narration/..%2f..%2fetc.mp3",
      "students/c000000000000000000000001/uploads/a.jpg",
      "students/c000000000000000000000001/narration/key.wav",
      "students//narration/key.mp3",
      "",
    ];

    it.each(badPathnames)("rejects %j as 400 VALIDATION_ERROR without touching storage", async (bad) => {
      process.env.STORAGE_DRIVER = "local";
      const { GET } = await import("@/app/api/dev/local-object/route");

      const res = await GET(localObjectRequest(bad));

      expect(res.status).toBe(400);
      const body = (await res.json()) as { ok: false; error: { code: string } };
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(dalMock.requireStudentProfile).not.toHaveBeenCalled();
      expect(headMock).not.toHaveBeenCalled();
      expect(readBytesMock).not.toHaveBeenCalled();
    });

    it("400s when the pathname query parameter is missing entirely", async () => {
      process.env.STORAGE_DRIVER = "local";
      const { GET } = await import("@/app/api/dev/local-object/route");

      const res = await GET(localObjectRequest(undefined));

      expect(res.status).toBe(400);
    });
  });

  it("404s a well-formed pathname naming a profile the caller does not own", async () => {
    process.env.STORAGE_DRIVER = "local";
    dalMock.requireStudentProfile.mockResolvedValue(null);
    const { GET } = await import("@/app/api/dev/local-object/route");

    const res = await GET(localObjectRequest(VALID_PATHNAME));

    expect(res.status).toBe(404);
    expect(dalMock.requireStudentProfile).toHaveBeenCalledWith("c000000000000000000000001");
    expect(headMock).not.toHaveBeenCalled();
  });

  it("404s when the owned profile's object doesn't exist in the store", async () => {
    process.env.STORAGE_DRIVER = "local";
    dalMock.requireStudentProfile.mockResolvedValue({ id: "c000000000000000000000001", status: "ACTIVE" });
    headMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/dev/local-object/route");

    const res = await GET(localObjectRequest(VALID_PATHNAME));

    expect(res.status).toBe(404);
    expect(readBytesMock).not.toHaveBeenCalled();
  });

  it("serves the bytes with the stored content type for the owning session's own object", async () => {
    process.env.STORAGE_DRIVER = "local";
    dalMock.requireStudentProfile.mockResolvedValue({ id: "c000000000000000000000001", status: "ACTIVE" });
    headMock.mockResolvedValue({ contentType: "audio/mpeg", sizeBytes: 3 });
    const audioBytes = new Uint8Array([1, 2, 3]).buffer;
    readBytesMock.mockResolvedValue(audioBytes);
    const { GET } = await import("@/app/api/dev/local-object/route");

    const res = await GET(localObjectRequest(VALID_PATHNAME));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(readBytesMock).toHaveBeenCalledWith(VALID_PATHNAME);
    const body = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(body)).toEqual([1, 2, 3]);
  });
});
