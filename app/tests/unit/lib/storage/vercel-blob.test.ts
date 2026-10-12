import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `VercelBlobStorage` against a MOCKED `@vercel/blob`.
 *
 * Read the limit before the assertions (retro lesson 17): this proves our
 * translation of the port's contract into SDK calls, and our failure handling.
 * It cannot prove the SDK does what we think, which is what the first preview
 * deployment is for — see the three checks in `lib/storage/vercel-blob.ts`.
 */
class FakeNotFound extends Error {}

const sdk = {
  BlobNotFoundError: FakeNotFound,
  head: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
  put: vi.fn(),
  list: vi.fn(),
  issueSignedToken: vi.fn(),
  presignUrl: vi.fn(),
};
vi.mock("@vercel/blob", () => sdk);

const handleUpload = vi.fn();
vi.mock("@vercel/blob/client", () => ({ handleUpload }));
vi.mock("server-only", () => ({}));

const { VercelBlobStorage } = await import("@/lib/storage/vercel-blob");

const policy = {
  access: "private" as const,
  allowedContentTypes: ["image/png"] as never,
  maximumSizeInBytes: 1234,
  addRandomSuffix: false,
  tokenPayload: "payload",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("VercelBlobStorage", () => {
  it("head maps size to sizeBytes", async () => {
    sdk.head.mockResolvedValue({ size: 42, contentType: "audio/mpeg" });
    expect(await new VercelBlobStorage().head("a/b")).toEqual({ contentType: "audio/mpeg", sizeBytes: 42 });
  });

  it("head returns null ONLY for not-found; any other failure surfaces", async () => {
    const s = new VercelBlobStorage();
    sdk.head.mockRejectedValue(new FakeNotFound());
    expect(await s.head("a/b")).toBeNull();

    sdk.head.mockRejectedValue(new Error("store suspended"));
    await expect(s.head("a/b")).rejects.toThrow("store suspended");
  });

  it("signedReadUrl asks for a get-only token and never exceeds the ttl", async () => {
    sdk.issueSignedToken.mockResolvedValue({ delegationToken: "d", clientSigningToken: "c", validUntil: 0 });
    sdk.presignUrl.mockResolvedValue({ presignedUrl: "https://x/y?sig" });
    const before = Date.now();
    const { url, expiresAt } = await new VercelBlobStorage().signedReadUrl("a/b", 300_000);

    expect(url).toBe("https://x/y?sig");
    expect(expiresAt.getTime() - before).toBeLessThanOrEqual(300_000 + 1000);
    expect(sdk.issueSignedToken).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "a/b", operations: ["get"] }),
    );
    expect(sdk.presignUrl.mock.calls[0][1]).toMatchObject({ operation: "get", pathname: "a/b", access: "private" });
  });

  it("readBytes returns the body, and throws on a missing or 304 result", async () => {
    const s = new VercelBlobStorage();
    sdk.get.mockResolvedValue({ statusCode: 200, stream: new Response("hello").body });
    expect(new TextDecoder().decode(await s.readBytes("a/b"))).toBe("hello");
    expect(sdk.get).toHaveBeenCalledWith("a/b", { access: "private", useCache: false });

    sdk.get.mockResolvedValue(null);
    await expect(s.readBytes("a/b")).rejects.toThrow(/no object/);
    sdk.get.mockResolvedValue({ statusCode: 304, stream: null });
    await expect(s.readBytes("a/b")).rejects.toThrow(/no object/);
  });

  it("del passes every pathname and skips the call for an empty list", async () => {
    const s = new VercelBlobStorage();
    await s.del([]);
    expect(sdk.del).not.toHaveBeenCalled();
    await s.del(["a", "b"]);
    expect(sdk.del).toHaveBeenCalledWith(["a", "b"]);
  });

  it("put writes a PRIVATE object at the exact key, overwriting", async () => {
    sdk.put.mockResolvedValue({});
    const out = await new VercelBlobStorage().put("n/a.mp3", new Uint8Array([1, 2, 3]), "audio/mpeg");
    expect(out).toEqual({ pathname: "n/a.mp3", sizeBytes: 3 });
    expect(sdk.put.mock.calls[0][2]).toMatchObject({
      access: "private",
      contentType: "audio/mpeg",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  });

  it("listAll follows the cursor across pages", async () => {
    sdk.list
      .mockResolvedValueOnce({ blobs: [{ pathname: "a", uploadedAt: new Date(1) }], hasMore: true, cursor: "c1" })
      .mockResolvedValueOnce({ blobs: [{ pathname: "b", uploadedAt: new Date(2) }], hasMore: false });
    const seen: string[] = [];
    for await (const o of new VercelBlobStorage().listAll("users/")) seen.push(o.pathname);
    expect(seen).toEqual(["a", "b"]);
    expect(sdk.list.mock.calls[1][0]).toMatchObject({ prefix: "users/", cursor: "c1" });
  });

  describe("handleClientUpload", () => {
    it("translates the route's policy into token constraints and never allows overwrite", async () => {
      handleUpload.mockImplementation(async ({ onBeforeGenerateToken }) => ({
        type: "blob.generate-client-token",
        clientToken: "tok",
        constraints: await onBeforeGenerateToken("p", null, false),
      }));
      const res = await new VercelBlobStorage().handleClientUpload(new Request("http://x"), { type: "t" }, policy);
      const json = await res.json();

      expect(json.clientToken).toBe("tok");
      expect(json.constraints).toEqual({
        allowedContentTypes: ["image/png"],
        maximumSizeInBytes: 1234,
        addRandomSuffix: false,
        allowOverwrite: false,
        tokenPayload: "payload",
      });
    });

    it("registers no upload-completed callback (confirm endpoints are the primary path)", async () => {
      handleUpload.mockResolvedValue({ type: "blob.generate-client-token", clientToken: "t" });
      await new VercelBlobStorage().handleClientUpload(new Request("http://x"), {}, policy);
      expect(handleUpload.mock.calls[0][0]).not.toHaveProperty("onUploadCompleted");
    });

    it("answers a failure with a fixed 400, never the SDK's message", async () => {
      handleUpload.mockRejectedValue(new Error("store st_secret123 suspended"));
      const res = await new VercelBlobStorage().handleClientUpload(new Request("http://x"), {}, policy);
      expect(res.status).toBe(400);
      expect(JSON.stringify(await res.json())).not.toContain("st_secret123");
    });
  });
});
