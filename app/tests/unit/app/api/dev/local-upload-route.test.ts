import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `app/api/dev/local-upload/route.ts` — the LOCAL-ONLY ingest route named in
 * this task's brief. The property that matters most here: it must be
 * IMPOSSIBLE to reach when `STORAGE_DRIVER=vercel-blob` (production shape),
 * unconditionally and before any other check — including before a session is
 * even looked up, so a probe against a production deployment cannot learn
 * anything about this route's existence from timing or from which check
 * failed.
 */

const dalMock = {
  verifySession: vi.fn(async () => ({ userId: "user_1" })),
  requireStudentProfile: vi.fn(),
};
vi.mock("@/lib/auth/dal", () => dalMock);

const putMock = vi.fn(async (pathname: string, _bytes: unknown, contentType: string) => ({
  pathname,
  contentType,
  sizeBytes: 3,
}));
vi.mock("@/lib/storage/local-fs", () => ({
  LocalFsStorage: vi.fn().mockImplementation(function FakeLocalFsStorage(this: { put: typeof putMock }) {
    this.put = putMock;
  }),
}));

function localUploadRequest(fields: Record<string, string>, file?: File) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (file) form.append("file", file);
  return new Request("http://localhost/api/dev/local-upload", { method: "POST", body: form });
}

function jpegFile(name = "a.jpg") {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/jpeg" });
}

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
  it("is 404 — the same shape as a route that doesn't exist — with a valid session, body and file", async () => {
    process.env.STORAGE_DRIVER = "vercel-blob";
    const { POST } = await import("@/app/api/dev/local-upload/route");

    const res = await POST(
      localUploadRequest({ studentProfileId: "c000000000000000000000001", pathname: "students/c000000000000000000000001/uploads/a.jpg" }, jpegFile()),
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: false; error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("the fence runs BEFORE the session is even checked", async () => {
    process.env.STORAGE_DRIVER = "vercel-blob";
    const { POST } = await import("@/app/api/dev/local-upload/route");

    await POST(localUploadRequest({ studentProfileId: "c000000000000000000000001", pathname: "students/c000000000000000000000001/uploads/a.jpg" }, jpegFile()));

    expect(dalMock.verifySession).not.toHaveBeenCalled();
    expect(dalMock.requireStudentProfile).not.toHaveBeenCalled();
    expect(putMock).not.toHaveBeenCalled();
  });

  it("also fences off an unset STORAGE_DRIVER that somehow isn't 'local' (defensive: only an exact 'local' match opens this route)", async () => {
    process.env.STORAGE_DRIVER = "something-unexpected";
    // lib/config.ts's own zod validation throws on an unrecognized value at
    // import time — confirming there is no silent fallthrough that could
    // open this route under a typo'd env value.
    await expect(import("@/app/api/dev/local-upload/route")).rejects.toThrow();
  });
});

describe("when STORAGE_DRIVER is 'local'", () => {
  it("accepts a well-formed request from the owning, ACTIVE student's session", async () => {
    process.env.STORAGE_DRIVER = "local";
    dalMock.requireStudentProfile.mockResolvedValue({ id: "c000000000000000000000001", status: "ACTIVE" });
    const { POST } = await import("@/app/api/dev/local-upload/route");

    const res = await POST(
      localUploadRequest({ studentProfileId: "c000000000000000000000001", pathname: "students/c000000000000000000000001/uploads/a.jpg" }, jpegFile()),
    );

    expect(res.status).toBe(200);
    expect(putMock).toHaveBeenCalledTimes(1);
  });

  it("refuses (403) a pathname belonging to a profile the caller does not own", async () => {
    process.env.STORAGE_DRIVER = "local";
    dalMock.requireStudentProfile.mockResolvedValue(null);
    const { POST } = await import("@/app/api/dev/local-upload/route");

    const res = await POST(
      localUploadRequest({ studentProfileId: "c000000000000000000000002", pathname: "students/c000000000000000000000002/uploads/a.jpg" }, jpegFile()),
    );

    expect(res.status).toBe(403);
    expect(putMock).not.toHaveBeenCalled();
  });

  it("refuses (403) a non-ACTIVE profile, tested positively rather than via a denylist", async () => {
    process.env.STORAGE_DRIVER = "local";
    dalMock.requireStudentProfile.mockResolvedValue({ id: "c000000000000000000000001", status: "CONSENT_PENDING" });
    const { POST } = await import("@/app/api/dev/local-upload/route");

    const res = await POST(
      localUploadRequest({ studentProfileId: "c000000000000000000000001", pathname: "students/c000000000000000000000001/uploads/a.jpg" }, jpegFile()),
    );

    expect(res.status).toBe(403);
    expect(putMock).not.toHaveBeenCalled();
  });
});
