import { beforeEach, expect, it, vi } from "vitest";

/** `app/api/uploads/[uploadId]/preview-url/route.ts` (endpoint 18, M1 AC 31/32). */

const dalMock = { requireUpload: vi.fn(), verifySession: vi.fn(async () => ({ userId: "user_1" })) };
vi.mock("@/lib/auth/dal", () => dalMock);

const signedReadUrlMock = vi.fn();
vi.mock("@/lib/storage/get-storage", () => ({
  getStoragePort: () => ({ signedReadUrl: signedReadUrlMock }),
}));

const { GET } = await import("@/app/api/uploads/[uploadId]/preview-url/route");

function req() {
  return new Request("http://localhost/api/uploads/upload_1/preview-url", { method: "GET" });
}
function ctx() {
  return { params: Promise.resolve({ uploadId: "upload_1" }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  dalMock.verifySession.mockResolvedValue({ userId: "user_1" });
});

it("404s cross-account", async () => {
  dalMock.requireUpload.mockResolvedValue(null);
  const res = await GET(req(), ctx());
  expect(res.status).toBe(404);
});

it("mints a short-lived signed URL (<= 5 minutes) with no-store", async () => {
  dalMock.requireUpload.mockResolvedValue({ id: "upload_1", pathname: "students/sp_1/uploads/a.jpg", status: "STORED" });
  const expiresAt = new Date(Date.now() + 5 * 60_000);
  signedReadUrlMock.mockResolvedValue({ url: "local-storage:///x", expiresAt });

  const res = await GET(req(), ctx());
  const body = (await res.json()) as { data: { url: string; expiresAt: string } };

  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(body.data.url).toBe("local-storage:///x");
  expect(new Date(body.data.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(5 * 60_000 + 1000);
});

it("409s once the source file has already been removed (SOURCE_DELETED)", async () => {
  dalMock.requireUpload.mockResolvedValue({ id: "upload_1", pathname: "students/sp_1/uploads/a.jpg", status: "SOURCE_DELETED" });

  const res = await GET(req(), ctx());

  expect(res.status).toBe(409);
  expect(signedReadUrlMock).not.toHaveBeenCalled();
});
