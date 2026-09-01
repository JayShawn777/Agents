import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { ClientUploadPolicy, StoragePort } from "@/lib/storage/port";

/**
 * A `StoragePort` (ADR-0003) backed by a directory on the local filesystem.
 * Unblocks M1 while the Vercel Blob account/store in ADR-0003's follow-up
 * list does not exist yet: `lib/storage/get-storage.ts` selects this
 * adapter via `STORAGE_DRIVER=local` (the default), and every route/job
 * written against `StoragePort` works unmodified against it. Swapping to
 * the real provider later replaces only `lib/storage/get-storage.ts`'s
 * branch plus a new `lib/storage/vercel-blob.ts` (B15) — this file is never
 * imported directly by application code, only through the factory.
 *
 * ## On-disk layout
 *
 * Two parallel trees under `rootDir` (default `<cwd>/.storage`, gitignored):
 *
 *   `<rootDir>/objects/<pathname>`       — the raw bytes, exactly as given.
 *   `<rootDir>/meta/<pathname>.json`     — a JSON sidecar: `{ contentType,
 *                                          sizeBytes, uploadedAt }`.
 *
 * A sidecar file (not a real object-storage provider's own metadata index)
 * is the simplest thing that answers `head()`/`listAll()` honestly, per the
 * task brief. Keeping metadata in a SEPARATE tree — rather than a sibling
 * file like `<pathname>.meta.json` next to the object — means `objects/`
 * contains exactly the objects this store holds and nothing else, so
 * walking it for `listAll()` never has to filter out its own bookkeeping
 * files.
 *
 * ## Path safety
 *
 * Every method that takes a `pathname` runs it through `resolveSafePath`
 * first: a `pathname` containing a `.`/`..` segment, a leading `/`, a `\`,
 * or a NUL byte is REJECTED (thrown), never resolved or sanitised. Defense
 * in depth: after joining, the resulting absolute path is re-checked to
 * fall under the tree root before any filesystem call touches it. This
 * adapter runs with the app process's own filesystem permissions, so this
 * is the one thing in this file that must never have a bug.
 *
 * ## `handleClientUpload` — the one method this adapter cannot fully honour
 *
 * See the docstring on that method below, and the backend-engineer report
 * for this task: the real protocol's request/response bodies never carry
 * file bytes even in production (they carry only metadata; bytes travel
 * browser-to-CDN out of band), so no `StoragePort` implementation can move
 * bytes through this method alone. This adapter therefore also exposes
 * `put()` as the actual local write path, for tests and for a future
 * local-only upload route to call directly.
 *
 * ## `put()` — now part of `StoragePort` (M5 §6)
 *
 * M5 is the first feature to write an object server-side (narration audio
 * from a vendor call), so `put` was promoted onto the port. This adapter's
 * own signature is deliberately wider than the port's — it keeps an extra
 * `options.uploadedAt` parameter, present only so tests can simulate an
 * object's age (e.g. `ORPHAN_THRESHOLD_MINUTES` boundary tests) without
 * sleeping; production code never passes it and the port's callers cannot
 * see it. A method may always accept more optional parameters than its
 * interface declares.
 */

const objectMetadataSchema = z.object({
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  uploadedAt: z.iso.datetime(),
});

type ObjectMetadata = z.infer<typeof objectMetadataSchema>;

/** Thrown by every path-taking method when `pathname` is unsafe. Never caught internally — a caller passing an unsafe pathname is a bug, not a "not found". */
export class InvalidPathnameError extends Error {
  constructor(pathname: string, reason: string) {
    super(`LocalFsStorage: invalid pathname "${pathname}": ${reason}`);
    this.name = "InvalidPathnameError";
  }
}

function assertSafePathnameShape(pathname: string): void {
  if (typeof pathname !== "string" || pathname.length === 0) {
    throw new InvalidPathnameError(String(pathname), "must be a non-empty string");
  }
  if (pathname.includes("\0")) {
    throw new InvalidPathnameError(pathname, "must not contain a NUL byte");
  }
  if (pathname.startsWith("/") || pathname.startsWith("~")) {
    throw new InvalidPathnameError(pathname, "must be relative, not absolute");
  }
  if (pathname.includes("\\")) {
    throw new InvalidPathnameError(pathname, 'must use "/" separators, not "\\"');
  }
  const segments = pathname.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new InvalidPathnameError(pathname, 'must not contain empty, ".", or ".." segments');
  }
}

/**
 * Joins `pathname` under `treeRoot`, re-verifying the result actually lands
 * inside it. `suffix` (e.g. `.json` for a meta sidecar) is appended to the
 * path AFTER `pathname` itself is validated — validating the suffixed
 * string instead would let a suffix mask an otherwise-rejected pathname
 * (e.g. `""` + `.json"` = `".json"`, which passes the "non-empty" and
 * "no `.`/`..` segment" checks that `""` alone would fail).
 */
function resolveSafePath(treeRoot: string, pathname: string, suffix = ""): string {
  assertSafePathnameShape(pathname);
  const resolved = path.resolve(treeRoot, pathname + suffix);
  const rootWithSep = treeRoot.endsWith(path.sep) ? treeRoot : treeRoot + path.sep;
  if (resolved !== treeRoot && !resolved.startsWith(rootWithSep)) {
    throw new InvalidPathnameError(pathname, "resolves outside the storage root");
  }
  return resolved;
}

function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "ENOENT";
}

function bufferToArrayBuffer(buf: Buffer): ArrayBuffer {
  // `Buffer.buffer` can be a larger, pooled ArrayBuffer than the Buffer's
  // own view into it — slice to exactly this buffer's window.
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/**
 * How many `listAll()` entries are read from disk and meta-parsed per
 * batch. Node's `readdir` is not itself cursor-paginated the way the real
 * provider's `list()` is, so this constant exists purely to prove the
 * generator's chunking has no off-by-one at a batch boundary — see
 * `tests/unit/lib/storage/local-fs.test.ts`. Deliberately small, and
 * deliberately NOT exported: an implementation detail of this adapter, not
 * a compliance tunable (`lib/config.ts` is for those).
 */
const LIST_PAGE_SIZE = 100;

export class LocalFsStorage implements StoragePort {
  private readonly objectsDir: string;
  private readonly metaDir: string;

  constructor(rootDir: string = path.join(process.cwd(), ".storage")) {
    this.objectsDir = path.join(rootDir, "objects");
    this.metaDir = path.join(rootDir, "meta");
  }

  private objectPath(pathname: string): string {
    return resolveSafePath(this.objectsDir, pathname);
  }

  private metaPath(pathname: string): string {
    return resolveSafePath(this.metaDir, pathname, ".json");
  }

  private async readMeta(pathname: string): Promise<ObjectMetadata | null> {
    try {
      const raw = await fs.readFile(this.metaPath(pathname), "utf8");
      return objectMetadataSchema.parse(JSON.parse(raw));
    } catch (err) {
      if (isEnoent(err)) return null;
      throw err;
    }
  }

  /**
   * The actual local write path — now also `StoragePort.put` (M5 §6). See
   * the class docstring for why the real protocol's `handleClientUpload`
   * cannot carry bytes, and for why this signature is wider than the
   * port's. Used by `tests/unit/lib/storage/local-fs.test.ts` to seed
   * objects, by narration generation (M5 slice 5) to write audio, and
   * available to a future local-only upload route.
   */
  async put(
    pathname: string,
    data: ArrayBuffer | Uint8Array,
    contentType: string,
    options?: { uploadedAt?: Date },
  ): Promise<{ pathname: string; contentType: string; sizeBytes: number; uploadedAt: Date }> {
    const objPath = this.objectPath(pathname);
    const metaPath = this.metaPath(pathname);
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data instanceof Uint8Array ? data : new Uint8Array(data));

    await fs.mkdir(path.dirname(objPath), { recursive: true });
    await fs.mkdir(path.dirname(metaPath), { recursive: true });
    await fs.writeFile(objPath, buf);

    // `options.uploadedAt` exists only so tests can simulate an object's age
    // (e.g. for `ORPHAN_THRESHOLD_MINUTES` boundary tests) without sleeping
    // — never used by production code, which always wants "now".
    const uploadedAt = options?.uploadedAt ?? new Date();
    const meta: ObjectMetadata = {
      contentType,
      sizeBytes: buf.byteLength,
      uploadedAt: uploadedAt.toISOString(),
    };
    await fs.writeFile(metaPath, JSON.stringify(meta));

    return { pathname, contentType, sizeBytes: buf.byteLength, uploadedAt };
  }

  /**
   * The real `@vercel/blob` `handleUpload()` protocol this method stands in
   * for has TWO request bodies, `blob.generate-client-token` and
   * `blob.upload-completed`, and NEITHER carries file bytes even in
   * production — bytes travel browser-to-CDN out of band
   * (docs/adr/0003-*.md step 4). A from-scratch local filesystem provider
   * therefore cannot move bytes through this method under any
   * implementation; there is no dishonest shortcut available, only an
   * honest partial one:
   *
   *   - `blob.generate-client-token`: validates the requested `pathname`
   *     against `opts` the same way the real callback would (path safety;
   *     `opts.allowedContentTypes`/`maximumSizeInBytes` are the provider's
   *     job to enforce against the actual bytes, which this adapter never
   *     sees here), and returns an inert local token. Nothing currently
   *     reads or verifies that token — there is no local CDN for it to
   *     authorize a write against.
   *   - `blob.upload-completed`: acknowledged idempotently by checking
   *     whether an object already exists at the given pathname (written via
   *     `put()` by whatever local route actually received the bytes). This
   *     mirrors ADR-0003 step 6's description of this callback as "a
   *     backstop, not the primary path".
   *
   * No production caller exists yet (B15-B18 are unbuilt — see
   * `get-storage.ts`), so nothing depends on this today. See the backend
   * report for this task: this is the one `StoragePort` method that is
   * awkward to implement honestly against a non-CDN-backed provider, and
   * that awkwardness is inherent to the method's shape, not this adapter.
   */
  async handleClientUpload(_req: Request, body: unknown, opts: ClientUploadPolicy): Promise<Response> {
    const parsed = clientUploadBodySchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "Invalid handleClientUpload body." }, { status: 400 });
    }

    if (parsed.data.type === "blob.generate-client-token") {
      try {
        assertSafePathnameShape(parsed.data.payload.pathname);
      } catch (err) {
        const message = err instanceof Error ? err.message : "invalid pathname";
        return Response.json({ error: message }, { status: 400 });
      }
      return Response.json({
        type: "blob.generate-client-token",
        clientToken: `local-inert-token:${randomUUID()}`,
        // Round-tripped for shape-compatibility with the real provider's
        // response only; nothing local verifies it.
        allowedContentTypes: opts.allowedContentTypes,
        maximumSizeInBytes: opts.maximumSizeInBytes,
      });
    }

    // blob.upload-completed — idempotent backstop ack (see docstring).
    const existing = await this.head(parsed.data.payload.blob.pathname).catch(() => null);
    return Response.json({ ok: true, alreadyPersisted: existing !== null });
  }

  async head(pathname: string): Promise<{ contentType: string; sizeBytes: number } | null> {
    const meta = await this.readMeta(pathname);
    if (!meta) return null;
    return { contentType: meta.contentType, sizeBytes: meta.sizeBytes };
  }

  async signedReadUrl(pathname: string, ttlMs: number): Promise<{ url: string; expiresAt: Date }> {
    assertSafePathnameShape(pathname);
    const expiresAt = new Date(Date.now() + ttlMs);
    // No CDN exists locally to mint a real, fetchable signed URL against.
    // This is a same-shaped, deliberately non-fetchable placeholder (a
    // scheme no HTTP client will resolve) so code compiled against
    // `StoragePort` behaves identically in TYPE across both adapters;
    // `lib/storage/vercel-blob.ts` (B15) replaces this with a real URL.
    // Never treat this as a real network address.
    const url = `local-storage:///${encodeURIComponent(pathname)}?expires=${expiresAt.getTime()}&token=${randomUUID()}`;
    return { url, expiresAt };
  }

  async readBytes(pathname: string): Promise<ArrayBuffer> {
    const objPath = this.objectPath(pathname);
    try {
      const buf = await fs.readFile(objPath);
      return bufferToArrayBuffer(buf);
    } catch (err) {
      if (isEnoent(err)) {
        throw new Error(`LocalFsStorage: no object at pathname "${pathname}".`);
      }
      throw err;
    }
  }

  /** Idempotent: deleting an already-gone (or never-existing) pathname succeeds silently (ADR-0007 §1/§3). */
  async del(pathnames: string[]): Promise<void> {
    await Promise.all(
      pathnames.map(async (pathname) => {
        const objPath = this.objectPath(pathname);
        const metaPath = this.metaPath(pathname);
        await Promise.all([rmIfExists(objPath), rmIfExists(metaPath)]);
      }),
    );
  }

  async *listAll(prefix?: string): AsyncIterable<{ pathname: string; uploadedAt: Date }> {
    const allPathnames: string[] = [];
    for await (const absPath of walk(this.objectsDir)) {
      const relPathname = path.relative(this.objectsDir, absPath).split(path.sep).join("/");
      if (prefix && !relPathname.startsWith(prefix)) continue;
      allPathnames.push(relPathname);
    }

    for (let i = 0; i < allPathnames.length; i += LIST_PAGE_SIZE) {
      const page = allPathnames.slice(i, i + LIST_PAGE_SIZE);
      const withMeta = await Promise.all(
        page.map(async (pathname) => ({ pathname, meta: await this.readMeta(pathname) })),
      );
      for (const { pathname, meta } of withMeta) {
        // A race between listing and a concurrent `del()` — treat as "gone",
        // not an error, matching `del`'s own idempotence.
        if (!meta) continue;
        yield { pathname, uploadedAt: new Date(meta.uploadedAt) };
      }
    }
  }
}

async function rmIfExists(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (!isEnoent(err)) throw err;
  }
}

async function* walk(dir: string): AsyncIterable<string> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (isEnoent(err)) return;
    throw err;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

/**
 * Best-effort model of `@vercel/blob`'s real `handleUpload()` wire body
 * (docs/research/vercel-blob-verified.md names the two `type` values but
 * does not enumerate the full payload shape) — sufficient for this
 * adapter's own validation, not a verified re-implementation of the
 * provider's schema.
 */
const clientUploadBodySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("blob.generate-client-token"),
    payload: z.object({
      pathname: z.string(),
      callbackUrl: z.string().optional(),
      clientPayload: z.string().nullable().optional(),
      multipart: z.boolean().optional(),
    }),
  }),
  z.object({
    type: z.literal("blob.upload-completed"),
    payload: z.object({
      blob: z.object({
        pathname: z.string(),
        contentType: z.string().optional(),
      }),
      tokenPayload: z.string().nullable().optional(),
    }),
  }),
]);
