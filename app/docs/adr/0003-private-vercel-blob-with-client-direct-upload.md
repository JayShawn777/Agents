# ADR-0003: Private Vercel Blob store with client-direct upload behind a storage port

- **Status:** Proposed
- **Date:** 2026-08-26
- **Deciders:** Jaysh (pending)
- **Spec:** docs/specs/m0-accounts-and-profiles.md, docs/specs/m1-upload-and-extract.md

## Context

M0 AC 25–36 require a private object store, a server-side authorization
boundary that mints upload credentials, database records that hold a
**pathname** rather than a URL, signed read URLs with a ≤5-minute expiry, and a
reconciliation job that enumerates the *store* to find objects with no database
row. M1 AC 2 requires the file bytes to travel from the browser to storage
**without passing through our functions**.

Two hard platform facts settle the transport question
(`docs/research/file-upload-storage.md` §2):

| Limit | Value | Configurable |
|---|---|---|
| Vercel Function request body | **4.5 MB** | No — platform cap, returns 413 |
| Next.js `serverActions.bodySizeLimit` | 1 MB default | Yes, but never above 4.5 MB |

A phone photo is routinely 3–8 MB and the spec's ceiling is 20 MB. Effectively
100% of real uploads exceed the server-action path. M1's non-goals state the
server-action upload path is **not to be built, not even as a fallback**.

The research recommends Vercel Blob with `access: 'private'`, but flags that
**every API signature in it is documentation-derived and unverified** — nothing
is installed — and specifically that client-side `upload()` against a *private*
store is unconfirmed end to end. Both specs mark this **BLOCKING**.

## Decision

We will use a **private Vercel Blob store** with **client-direct upload** via
`upload()` / `handleUpload()`, and we will place **every** storage call behind a
narrow port at `lib/storage/index.ts` so the provider can be replaced without
touching the schema, the routes, or any component.

**The port** (`lib/storage/port.ts`), implemented by
`lib/storage/vercel-blob.ts`:

```ts
export interface StoragePort {
  handleClientUpload(req: Request, body: unknown, opts: ClientUploadPolicy): Promise<Response>;
  head(pathname: string): Promise<{ contentType: string; sizeBytes: number } | null>;
  signedReadUrl(pathname: string, ttlMs: number): Promise<{ url: string; expiresAt: Date }>;
  readBytes(pathname: string): Promise<ArrayBuffer>;
  del(pathnames: string[]): Promise<void>;
  listAll(prefix?: string): AsyncIterable<{ pathname: string; uploadedAt: Date }>;
}
```

**The upload path**, exactly:

1. Client sniffs magic bytes, converts HEIC if needed (ADR-0004), validates
   size/type/PDF page count locally as a UX check.
2. Client calls `upload(pathname, file, { access: 'private', handleUploadUrl:
   '/api/blob/upload', multipart: true, clientPayload, onUploadProgress })`.
   The client-proposed pathname is
   `students/<studentProfileId>/uploads/<crypto.randomUUID()>.<ext>`.
3. `POST /api/blob/upload` reads the body **once** into a variable. If
   `body.type === 'blob.generate-client-token'` it runs our own checks *before*
   delegating: session (401), profile ownership scoped by `userId` (403),
   profile status `ACTIVE` (403), hourly cap (429). Only then does it call
   `handleUpload({ body, request, onBeforeGenerateToken, onUploadCompleted })`.
   `onBeforeGenerateToken` zod-validates `clientPayload`, re-asserts that the
   proposed pathname matches `^students/<authorizedProfileId>/uploads/[a-z0-9-]+\.[a-z0-9]+$`,
   and returns `{ access: 'private', allowedContentTypes: ['image/jpeg',
   'image/png', 'image/webp', 'application/pdf'], maximumSizeInBytes:
   20 * 1024 * 1024, addRandomSuffix: true, tokenPayload }`. These constraints
   are enforced by the provider, so a tampered client cannot exceed them
   (AC 27/28).
4. Bytes go browser → `*.blob.vercel-storage.com`. No function is involved.
5. **The client then calls `POST /api/uploads/confirm`** with the final
   pathname. The server calls `head(pathname)` and records the provider's
   contentType and size, never the client's claims. This is the *primary*
   persistence path.
6. `onUploadCompleted` calls the same idempotent `recordUpload()` function. It
   is a **backstop**, not the primary path, because it does not fire on
   `localhost` and would make local dev and Playwright silently persist nothing
   (M1 AC 14). `Upload.pathname` is `@unique`, so double delivery yields exactly
   one row (M1 AC 15).

**Pathnames, not URLs**, are stored (AC 29), namespaced by student profile id,
which makes profile deletion a prefix operation and makes cross-account access a
detectable pathname mismatch rather than a trusted identifier.

**Reads** use `signedReadUrl(pathname, 5 * 60 * 1000)` minted per request after
an authorization check, returned only from
`GET /api/uploads/[uploadId]/preview-url` with `Cache-Control: no-store`. Signed
URLs never appear in server-rendered HTML, in logs, or in any cacheable payload.
The extraction path uses `readBytes()` server-side and never mints a URL at all
(M1 AC 31).

**Nothing is built against this ADR until the spike in
`docs/plans/m0-m1-implementation.md` §9 passes.** The spike's failure branches
are specified there; because all storage access goes through the port, a
provider swap changes one file plus a dependency, not the design.

## Alternatives considered

### Server-action upload (`put()` inside a server action)
- **Pros:** Simplest possible code. One function, no token round trip, no
  callback, no confirm route, no orphan window.
- **Cons:** Hard-capped at 4.5 MB by Vercel with no configuration available;
  Next's own default is 1 MB. Puts a minor's schoolwork in a function request
  body and therefore potentially in function logs. Burns function duration and
  data transfer on every upload.
- **Rejected because:** it cannot carry the median file. M1 explicitly forbids
  building it even as a fallback, and a fallback that works for <10% of uploads
  is a trap that hides the real failure mode until production.

### Public Vercel Blob store with `addRandomSuffix` (unguessable URLs)
- **Pros:** Free CDN reads, no signing, no function in the read path.
- **Cons:** Vercel's own security docs state there is no access control on
  public blobs, analogise them to "share via link", and warn that search engines
  index them. A leaked or logged URL is permanent unrestricted access.
- **Rejected because:** security-by-obscurity is not an acceptable control for a
  photograph of a nine-year-old's homework, and M0 AC 31 requires an
  unauthenticated fetch to fail.

### Supabase Storage private buckets
- **Pros:** Private by default, mature `createSignedUrl` / `createSignedUploadUrl`,
  TUS resumable uploads, 50 MB per-file cap on Free.
- **Cons:** The database is on Neon, so Supabase would be a second vendor used
  only for files. The RLS advantage — the main reason to pick it — evaporates,
  because RLS policies key off Supabase Auth's `auth.uid()` and we do not use
  Supabase Auth; we would enforce authorization in application code exactly as
  with Vercel Blob, minus a vendor. Free-plan projects pause after a week of
  inactivity, so it is Pro from day one.
- **Rejected because:** more vendor, more cost, and no privacy advantage that
  actually transfers. **Retained as the designated fallback** if the spike
  fails.

### S3 or Cloudflare R2 with presigned PUTs
- **Pros:** Private by default. R2 has $0 egress, the single largest long-term
  cost lever. No lock-in.
- **Cons:** Browser CORS configuration on the bucket (a classic multi-hour sink),
  long-lived access keys with no Vercel OIDC integration, hand-rolled multipart
  orchestration for resumability, and no `onUploadCompleted` equivalent — we
  would poll, use the client confirm call, or wire S3 event notifications.
- **Rejected because:** it adds a third vendor and materially more plumbing for
  no M0/M1 benefit. Revisit only if read egress becomes a real cost line.

### Streaming request bodies through a function to bypass the 4.5 MB cap
- **Pros:** Keeps one upload path; Vercel documents streaming bodies as exempt
  from the cap.
- **Cons:** Fragile, undocumented in the SDK we would use, still burns function
  duration and data transfer, and still routes a child's schoolwork through our
  own infrastructure.
- **Rejected because:** it reintroduces the exact exposure M1 AC 2 exists to
  eliminate, in exchange for nothing.

## Consequences

### Positive
- File bytes never enter our functions or our logs (M1 AC 2, AC 31).
- Size and content-type limits are enforced by the provider, not the client
  (AC 27/28).
- One vendor. `VERCEL_OIDC_TOKEN` covers server-side reads, so no static storage
  secret is needed for reads; only client-token minting needs
  `BLOB_READ_WRITE_TOKEN`.
- Storing pathnames keeps a provider migration to a re-upload plus one file.

### Negative / accepted trade-offs
- Three moving parts (token route, direct upload, confirm route) instead of one,
  and a window in which bytes exist with no row. That window is exactly the
  orphan problem, handled in ADR-0007.
- Private reads cost data transfer that a public store would have served free
  from CDN. Preview URLs are minted on demand only, never eagerly.
- The private-blob and signed-URL API surface is new; we will debug it without
  much community precedent.
- `@vercel/blob` v2 refuses to overwrite an existing key unless
  `allowOverwrite: true`. We rely on `addRandomSuffix: true` so retries never
  collide (M1 AC 9).
- Vendor lock-in to Vercel storage, bounded by the port.

### Follow-up required
- [ ] Owner approval for `@vercel/blob@^2.8`.
- [ ] Run the spike (plan §9) and write `docs/research/vercel-blob-verified.md`
      with the real type signatures before any of AC 25–36 is implemented.
- [ ] Add `BLOB_READ_WRITE_TOKEN` and `CRON_SECRET` to `.env.example` and the
      runbook.
- [ ] Confirm whether Private Blob is available on the Hobby plan specifically,
      and whether a signed-URL `get` counts as a simple or advanced operation.
- [ ] Re-check the 4.5 MB function body cap (documented "last updated
      2026-07-01") before launch.

## Revisit when

Read egress becomes a material cost line (R2 becomes attractive); or the spike
fails on private client uploads (Supabase Storage becomes the answer and
supersedes this); or we outgrow single-file uploads and need resumable
multi-part sessions that survive a closed tab.
