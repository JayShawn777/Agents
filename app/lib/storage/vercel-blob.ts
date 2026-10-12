import "server-only";

import { BlobNotFoundError, del, get, head, list, put } from "@vercel/blob";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { issueSignedToken, presignUrl } from "@vercel/blob";

import type { ClientUploadPolicy, StoragePort } from "@/lib/storage/port";

/**
 * The production `StoragePort` (ADR-0003, plan B15), backed by a PRIVATE Vercel
 * Blob store. Selected by `STORAGE_DRIVER=vercel-blob` in `get-storage.ts`.
 *
 * ## What is and is not verified about this file
 *
 * Written against the installed `@vercel/blob@2.8.0` declarations and the
 * library's own source (`docs/research/vercel-blob-verified.md`). **It has not
 * been run against a real store** — ADR-0003 says nothing is built on it until
 * the spike passes, and the spike needs a Vercel account. The unit tests mock
 * the SDK, which proves our mapping and our failure handling and proves nothing
 * about the SDK (retro lesson 17). Three things only a real store can answer,
 * and the first preview deployment must check them:
 *
 *  1. Private Blob is available on the account's plan.
 *  2. An unauthenticated fetch of a stored object is refused.
 *  3. A URL from `signedReadUrl` serves the object, and expires.
 *
 * ## Deliberately NOT done
 *
 * - **No `onUploadCompleted`.** Passing one makes the SDK register a callback URL
 *   that Vercel then POSTs to `/api/blob/upload` with no session. The confirm
 *   endpoints (M1 endpoint 15, M6 endpoint 49) are the primary path and they
 *   `head()` the object themselves, so the callback would only add a route that
 *   has to authenticate a caller it cannot (ADR-0003 step 6: "a backstop, not the
 *   primary path"). Omitting it makes the SDK skip the callback entirely.
 * - **No server-side overwrite protection on `put`.** Narration regenerates to
 *   the same key and `LocalFsStorage.put` overwrites, so this does too.
 */

const ACCESS = "private" as const;

export class VercelBlobStorage implements StoragePort {
  async handleClientUpload(req: Request, body: unknown, opts: ClientUploadPolicy): Promise<Response> {
    try {
      const result = await handleUpload({
        request: req,
        body: body as HandleUploadBody,
        // The authorization decision was made by the route before this call; this
        // only translates its policy into the token's own constraints, which the
        // provider enforces against the actual bytes (M0 AC 37/38).
        onBeforeGenerateToken: async () => ({
          allowedContentTypes: [...(opts.allowedContentTypes as string[])],
          maximumSizeInBytes: opts.maximumSizeInBytes,
          addRandomSuffix: opts.addRandomSuffix,
          // Never let a client token replace an existing object.
          allowOverwrite: false,
          ...(opts.tokenPayload !== undefined ? { tokenPayload: opts.tokenPayload } : {}),
        }),
      });
      return Response.json(result);
    } catch (err) {
      // The SDK's message can name the store; the client gets a fixed string.
      console.error("VercelBlobStorage.handleClientUpload failed:", err instanceof Error ? err.name : "unknown");
      return Response.json({ error: "Upload could not be authorized." }, { status: 400 });
    }
  }

  async head(pathname: string): Promise<{ contentType: string; sizeBytes: number } | null> {
    try {
      const result = await head(pathname);
      return { contentType: result.contentType, sizeBytes: result.size };
    } catch (err) {
      // Only "no such object" means null. Auth, store and rate-limit failures
      // must surface — answering them with null would tell the confirm step the
      // upload never happened.
      if (err instanceof BlobNotFoundError) return null;
      throw err;
    }
  }

  async signedReadUrl(pathname: string, ttlMs: number): Promise<{ url: string; expiresAt: Date }> {
    const validUntil = Date.now() + ttlMs;
    const token = await issueSignedToken({ pathname, operations: ["get"], validUntil });
    const { presignedUrl } = await presignUrl(token, {
      operation: "get",
      pathname,
      validUntil,
      access: ACCESS,
    });
    // `expiresAt - now` must never exceed `ttlMs` (M0 AC 41 / M1 AC 32).
    return { url: presignedUrl, expiresAt: new Date(validUntil) };
  }

  async readBytes(pathname: string): Promise<ArrayBuffer> {
    const result = await get(pathname, { access: ACCESS, useCache: false });
    if (!result || result.statusCode !== 200) {
      throw new Error(`VercelBlobStorage: no object at pathname "${pathname}".`);
    }
    return new Response(result.stream).arrayBuffer();
  }

  async del(pathnames: string[]): Promise<void> {
    if (pathnames.length === 0) return;
    // Idempotent by contract (ADR-0007 §1/§3): the SDK does not error on a
    // missing key, and a retried deletion must succeed.
    await del(pathnames);
  }

  async put(
    pathname: string,
    data: ArrayBuffer | Uint8Array,
    contentType: string,
  ): Promise<{ pathname: string; sizeBytes: number }> {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    await put(pathname, Buffer.from(bytes), {
      access: ACCESS,
      contentType,
      // The key is the contract: narration looks the object up by this exact
      // pathname, so a random suffix would orphan it.
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return { pathname, sizeBytes: bytes.byteLength };
  }

  async *listAll(prefix?: string): AsyncIterable<{ pathname: string; uploadedAt: Date }> {
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      for (const blob of page.blobs) {
        yield { pathname: blob.pathname, uploadedAt: blob.uploadedAt };
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  }
}
