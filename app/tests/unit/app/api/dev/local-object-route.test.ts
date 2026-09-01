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

  it("also fences off an unset STORAGE_DRIVER that somehow isn't 'local' (defensive: only an exact 'local' match opens this route)", async () => {
    process.env.STORAGE_DRIVER = "something-unexpected";
    // lib/config.ts's own zod validation throws on an unrecognized value at
    // import time — confirming there is no silent fallthrough that could
    // open this route under a typo'd env value.
    await expect(import("@/app/api/dev/local-object/route")).rejects.toThrow();
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
