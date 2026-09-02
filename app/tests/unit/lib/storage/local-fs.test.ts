import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { InvalidPathnameError, LocalFsStorage } from "@/lib/storage/local-fs";
import type { ClientUploadPolicy } from "@/lib/storage/port";

/**
 * The `StoragePort` contract (ADR-0003) exercised against a REAL directory
 * on disk, not a mock — the whole point of building `local-fs.ts` before
 * `vercel-blob.ts` exists is that jobs (`reconcile-blobs`, `enforce-retention`,
 * `deleteStudentData`) can be proven against real filesystem semantics now.
 */

let rootDir: string;
let storage: LocalFsStorage;

beforeEach(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-fs-storage-"));
  storage = new LocalFsStorage(rootDir);
});

afterEach(async () => {
  await fs.rm(rootDir, { recursive: true, force: true });
});

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("LocalFsStorage — put + head", () => {
  it("head() returns provider-derived contentType and sizeBytes for a stored object", async () => {
    await storage.put("students/sp_1/uploads/a.jpg", bytesOf("hello world"), "image/jpeg");

    const meta = await storage.head("students/sp_1/uploads/a.jpg");

    expect(meta).toEqual({ contentType: "image/jpeg", sizeBytes: 11 });
  });

  it("head() returns null for an object that does not exist", async () => {
    const meta = await storage.head("students/sp_1/uploads/missing.jpg");
    expect(meta).toBeNull();
  });
});

describe("LocalFsStorage — readBytes", () => {
  it("returns exactly the bytes that were put", async () => {
    await storage.put("students/sp_1/uploads/b.pdf", bytesOf("%PDF-1.4 fake"), "application/pdf");

    const buf = await storage.readBytes("students/sp_1/uploads/b.pdf");

    expect(new TextDecoder().decode(buf)).toBe("%PDF-1.4 fake");
  });

  it("rejects for an object that does not exist", async () => {
    await expect(storage.readBytes("students/sp_1/uploads/missing.pdf")).rejects.toThrow();
  });
});

describe("LocalFsStorage — del", () => {
  it("removes the object so head() and readBytes() both see it as gone", async () => {
    await storage.put("students/sp_1/uploads/c.png", bytesOf("bytes"), "image/png");

    await storage.del(["students/sp_1/uploads/c.png"]);

    expect(await storage.head("students/sp_1/uploads/c.png")).toBeNull();
    await expect(storage.readBytes("students/sp_1/uploads/c.png")).rejects.toThrow();
  });

  it("is idempotent — deleting a pathname that was never written does not throw", async () => {
    await expect(storage.del(["students/sp_1/uploads/never-existed.png"])).resolves.toBeUndefined();
  });

  it("is idempotent — deleting the same pathname twice does not throw", async () => {
    await storage.put("students/sp_1/uploads/d.png", bytesOf("bytes"), "image/png");

    await storage.del(["students/sp_1/uploads/d.png"]);

    await expect(storage.del(["students/sp_1/uploads/d.png"])).resolves.toBeUndefined();
  });

  it("deletes a mixed batch of existing and already-gone pathnames without throwing", async () => {
    await storage.put("students/sp_1/uploads/exists.png", bytesOf("bytes"), "image/png");

    await expect(
      storage.del(["students/sp_1/uploads/exists.png", "students/sp_1/uploads/never-existed.png"]),
    ).resolves.toBeUndefined();
    expect(await storage.head("students/sp_1/uploads/exists.png")).toBeNull();
  });
});

describe("LocalFsStorage — listAll enumerates the store itself", () => {
  it("sees an object written directly to the store with no external record of it (the orphan case)", async () => {
    // No "database row" of any kind is created here — `put()` is the only
    // thing that happened. `listAll()` must still find it, because that is
    // the entire mechanism `reconcile-blobs.ts` depends on.
    await storage.put("students/sp_1/uploads/orphan.jpg", bytesOf("x"), "image/jpeg");

    const seen = [];
    for await (const obj of storage.listAll()) seen.push(obj.pathname);

    expect(seen).toEqual(["students/sp_1/uploads/orphan.jpg"]);
  });

  it("filters by prefix", async () => {
    await storage.put("students/sp_1/uploads/a.jpg", bytesOf("a"), "image/jpeg");
    await storage.put("students/sp_2/uploads/b.jpg", bytesOf("b"), "image/jpeg");

    const seen = [];
    for await (const obj of storage.listAll("students/sp_1/")) seen.push(obj.pathname);

    expect(seen).toEqual(["students/sp_1/uploads/a.jpg"]);
  });

  it("paginates internally without dropping or duplicating objects across a page boundary", async () => {
    const total = 250; // several times the adapter's internal batch size
    for (let i = 0; i < total; i++) {
      await storage.put(`students/sp_1/uploads/file-${String(i).padStart(4, "0")}.jpg`, bytesOf("x"), "image/jpeg");
    }

    const seen: string[] = [];
    for await (const obj of storage.listAll()) seen.push(obj.pathname);

    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total); // no duplicates
    for (let i = 0; i < total; i++) {
      expect(seen).toContain(`students/sp_1/uploads/file-${String(i).padStart(4, "0")}.jpg`);
    }
  });

  it("reports uploadedAt honestly, including a caller-supplied historical value", async () => {
    const uploadedAt = new Date("2020-01-01T00:00:00.000Z");
    await storage.put("students/sp_1/uploads/old.jpg", bytesOf("x"), "image/jpeg", { uploadedAt });

    const results = [];
    for await (const obj of storage.listAll()) results.push(obj);

    expect(results).toEqual([{ pathname: "students/sp_1/uploads/old.jpg", uploadedAt }]);
  });
});

describe("LocalFsStorage — path traversal is rejected, not resolved", () => {
  const unsafePathnames = [
    "../escape.jpg",
    "students/../../escape.jpg",
    "students/sp_1/uploads/../../../etc/passwd",
    "/etc/passwd",
    "C:\\windows\\system32",
    "students\\sp_1\\uploads\\a.jpg",
    "",
    ".",
    "..",
  ];

  it.each(unsafePathnames)("put() rejects %j", async (pathname) => {
    await expect(storage.put(pathname, bytesOf("x"), "image/jpeg")).rejects.toThrow(InvalidPathnameError);
  });

  it.each(unsafePathnames)("head() rejects %j", async (pathname) => {
    await expect(storage.head(pathname)).rejects.toThrow(InvalidPathnameError);
  });

  it.each(unsafePathnames)("readBytes() rejects %j", async (pathname) => {
    await expect(storage.readBytes(pathname)).rejects.toThrow(InvalidPathnameError);
  });

  it.each(unsafePathnames)("del() rejects a batch containing %j", async (pathname) => {
    await expect(storage.del([pathname])).rejects.toThrow(InvalidPathnameError);
  });

  it("never creates a file outside rootDir even if a traversal attempt is made", async () => {
    await storage.put("../escape.jpg", bytesOf("x"), "image/jpeg").catch(() => {});

    const outside = path.join(path.dirname(rootDir), "escape.jpg");
    await expect(fs.stat(outside)).rejects.toThrow();
  });
});

describe("LocalFsStorage — handleClientUpload", () => {
  it("issues an inert local token for a well-formed generate-client-token request", async () => {
    const body = {
      type: "blob.generate-client-token",
      payload: { pathname: "students/sp_1/uploads/new.jpg" },
    };
    const opts = {
      access: "private" as const,
      allowedContentTypes: ["image/jpeg"] as ClientUploadPolicy["allowedContentTypes"],
      maximumSizeInBytes: 1024,
      addRandomSuffix: true as const,
    };

    const res = await storage.handleClientUpload(new Request("http://localhost/api/blob/upload"), body, opts);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.type).toBe("blob.generate-client-token");
    expect(typeof json.clientToken).toBe("string");
  });

  it("rejects an unsafe pathname in a generate-client-token request", async () => {
    const body = {
      type: "blob.generate-client-token",
      payload: { pathname: "../escape.jpg" },
    };
    const opts = {
      access: "private" as const,
      allowedContentTypes: ["image/jpeg"] as ClientUploadPolicy["allowedContentTypes"],
      maximumSizeInBytes: 1024,
      addRandomSuffix: true as const,
    };

    const res = await storage.handleClientUpload(new Request("http://localhost/api/blob/upload"), body, opts);

    expect(res.status).toBe(400);
  });

  it("acknowledges an upload-completed callback idempotently", async () => {
    await storage.put("students/sp_1/uploads/done.jpg", bytesOf("x"), "image/jpeg");
    const body = {
      type: "blob.upload-completed",
      payload: { blob: { pathname: "students/sp_1/uploads/done.jpg" } },
    };
    const opts = {
      access: "private" as const,
      allowedContentTypes: ["image/jpeg"] as ClientUploadPolicy["allowedContentTypes"],
      maximumSizeInBytes: 1024,
      addRandomSuffix: true as const,
    };

    const res = await storage.handleClientUpload(new Request("http://localhost/api/blob/upload"), body, opts);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.alreadyPersisted).toBe(true);
  });
});

/**
 * ─────────── the 2026-09-02 review: the sidecar-less object ───────────
 *
 * `put()` writes `objects/<p>` and THEN `meta/<p>.json`. `listAll()` used to
 * skip any object whose sidecar was missing, commented as a race with a
 * concurrent `del()`. It also silently swallowed a crash between those two
 * writes — and `listAll()` is the only call in the codebase that enumerates the
 * STORE rather than walking from a database row, so such an object was
 * invisible to `reconcile-blobs` forever: bytes derived from a child's
 * schoolwork that no deletion path could ever reach.
 */
describe("LocalFsStorage — an object whose meta sidecar is missing (2026-09-02)", () => {
  async function removeSidecar(pathname: string) {
    await fs.rm(path.join(rootDir, "meta", `${pathname}.json`), { force: true });
  }

  it("still yields the object from listAll(), so the reconciler can see it", async () => {
    await storage.put("students/sp_1/narration/orphan.mp3", new Uint8Array([1, 2, 3]), "audio/mpeg");
    await removeSidecar("students/sp_1/narration/orphan.mp3");

    const seen: string[] = [];
    for await (const obj of storage.listAll()) seen.push(obj.pathname);

    expect(seen).toContain("students/sp_1/narration/orphan.mp3");
  });

  it("dates it from the file's own mtime, so the orphan threshold still applies", async () => {
    await storage.put("students/sp_1/narration/orphan.mp3", new Uint8Array([1]), "audio/mpeg");
    await removeSidecar("students/sp_1/narration/orphan.mp3");

    const entries: Array<{ pathname: string; uploadedAt: Date }> = [];
    for await (const obj of storage.listAll()) entries.push(obj);

    const entry = entries.find((e) => e.pathname === "students/sp_1/narration/orphan.mp3");
    expect(entry).toBeDefined();
    expect(entry!.uploadedAt).toBeInstanceOf(Date);
    expect(Number.isNaN(entry!.uploadedAt.getTime())).toBe(false);
  });

  it("still skips an object that genuinely vanished, which is the case the old comment described", async () => {
    await storage.put("students/sp_1/narration/gone.mp3", new Uint8Array([1]), "audio/mpeg");
    // Remove the bytes but leave the sidecar: `walk()` enumerates `objects/`,
    // so this simply is not listed — and the stat fallback must not resurrect it.
    await fs.rm(path.join(rootDir, "objects", "students/sp_1/narration/gone.mp3"), { force: true });

    const seen: string[] = [];
    for await (const obj of storage.listAll()) seen.push(obj.pathname);

    expect(seen).not.toContain("students/sp_1/narration/gone.mp3");
  });
});
