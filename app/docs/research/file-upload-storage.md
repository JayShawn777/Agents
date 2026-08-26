# Research: File upload and storage

- **Date:** 2026-08-26
- **Researcher:** researcher agent
- **Question:** How should the AI tutor app store student-uploaded schoolwork (JPEG/PNG/HEIC/PDF, 1–20MB) on Next.js 16 + Vercel, given the files contain a minor's data and must not be publicly enumerable?
- **Verdict:** Use **Vercel Blob with a private store** (`access: 'private'`), uploading client-side-direct via `upload()` + `handleUpload()`. Vercel Private Blob went GA and now offers genuinely private (auth-required) blobs plus operation-scoped signed URLs up to 7 days, so the old "public URLs with unguessable paths" objection no longer applies. The catch: the private-blob API surface is new, I could not read the installed types (nothing is installed yet), and every API shape below is from docs rather than verified source — budget a spike to confirm signatures before committing.

## Summary

- **Vercel functions cap request bodies at 4.5 MB** ([ONLINE], docs say last updated 2026-07-01). With 1–20 MB files, routing bytes through a server action is **not viable** — this is the decisive architectural fact.
- Next.js adds its own **1 MB default `serverActions.bodySizeLimit`** ([VERIFIED] in local Next 16.3.1 docs). Even raised, it can never exceed Vercel's 4.5 MB platform cap.
- Therefore: **client-side direct upload is mandatory**, not an optimization. Server-action upload is only usable as a fallback for small files (<~4 MB).
- **Vercel Blob now has real private storage.** `access: 'private'` blobs live at `https://<store-id>.private.blob.vercel-storage.com/<pathname>` and are **not publicly readable** — every read requires auth via `get()` or a signed URL. [ONLINE]
- **Signed URLs** are scoped to one operation (`get`/`put`/`head`/`delete`), one pathname, and an expiry up to **7 days**. Minted server-side via `issueSignedToken()` + `presignUrl()`. [ONLINE]
- **OIDC auth**: functions on Vercel authenticate with a short-lived auto-rotating `VERCEL_OIDC_TOKEN` — no static `BLOB_READ_WRITE_TOKEN` needed in env for server-side reads. Good posture for children's data. [ONLINE]
- **HEIC must be converted.** No mainstream browser decodes HEIC, and vision models (Claude: JPEG/PNG/GIF/WebP) don't accept it. Convert client-side before upload. Requires a new dependency — **needs your approval**.
- **Pricing**: Vercel Blob Hobby = 1 GB storage, 10 GB transfer, 10k simple / 2k advanced ops per month. Then $0.023/GB storage, ~$0.05/GB transfer. Supabase Free = 1 GB storage, 5 GB egress; Pro = 8 GB + 250 GB egress. [ONLINE]
- **Supabase Storage is the credible alternative** and its private-bucket + RLS + `createSignedUrl` story is excellent — but the project's DB is on **Neon**, so Supabase would be a second, otherwise-unused vendor.
- **Recommendation: Vercel Blob private store.** Supabase is the fallback if the private-blob API disappoints during the spike.

## Findings

### 1. Vercel Blob SDK: package, version, and both upload paths

**Package:** `@vercel/blob`. Latest reported version **2.8.0**, published roughly mid-August 2026. [ONLINE — npm]

Nothing is installed in this repo yet (`/workspaces/Agents/app/package.json` has no storage SDK), so **I could not verify any of these signatures against real TypeScript types**. Everything in this section is from Vercel's docs.

**Breaking changes in v2 worth knowing** [ONLINE]:
- `put()` now **refuses to overwrite** an existing key unless `allowOverwrite: true` is passed (0.x overwrote silently). Expect "This blob already exists" errors if you reuse pathnames.
- `onUploadCompleted` in client uploads requires an explicit `callbackUrl` when *not* hosted on Vercel. On Vercel it is inferred. This matters for local dev.
- ETag-based conditional writes added: `ifMatch` on `del()`, `BlobPreconditionFailedError`.
- `useCache` on `get()` is deprecated and is now a no-op.

#### Path A — server action upload (small files only)

```ts
// Shape per Vercel docs. NOT verified against installed types.
import { put } from '@vercel/blob';

export async function uploadWork(formData: FormData) {
  'use server';
  const file = formData.get('image') as File;
  const blob = await put(file.name, file, {
    access: 'private',     // 'private' | 'public'
    addRandomSuffix: true,
  });
  return blob;
}
```

This path pushes the whole file through the function and is therefore **hard-capped at 4.5 MB** by Vercel (see §2). Useful only as a fallback.

#### Path B — client direct upload (the real path)

Two pieces. A route handler that authorizes and mints a scoped client token, and a browser call that streams bytes straight to Blob storage.

```ts
// app/api/upload/route.ts — shape per Vercel docs, NOT verified.
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';

export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;

  const jsonResponse = await handleUpload({
    body,
    request,
    onBeforeGenerateToken: async (pathname, clientPayload) => {
      // AUTHENTICATE AND AUTHORIZE HERE. This is the security boundary.
      // Resolve the session, confirm the student owns the target path.
      return {
        access: 'private',
        allowedContentTypes: ['image/jpeg', 'image/png', 'application/pdf'],
        maximumSizeInBytes: 20 * 1024 * 1024,
        addRandomSuffix: true,
        tokenPayload: JSON.stringify({ /* studentId, etc. */ }),
      };
    },
    onUploadCompleted: async ({ blob, tokenPayload }) => {
      // Persist the blob pathname to Postgres via Prisma here.
    },
  });

  return Response.json(jsonResponse);
}
```

```ts
// client component
import { upload } from '@vercel/blob/client';

const blob = await upload(file.name, file, {
  access: 'private',
  handleUploadUrl: '/api/upload',
  multipart: true,                 // recommended for large files
  onUploadProgress: (p) => setProgress(p.percentage),
});
```

Key points from the docs [ONLINE]:
- The constraints returned from `onBeforeGenerateToken` (`allowedContentTypes`, `maximumSizeInBytes`) are **enforced server-side**, so a tampered client cannot exceed them. This is the correct place for validation — zod-validate the `clientPayload` here per project conventions.
- `multipart: true` splits the file, uploads parts in parallel, and retries failed parts. Parts are min 5 MB except the last. Blob supports files up to **5 TB** with multipart.
- Bytes never touch a function, so **no function data-transfer charge** on upload.
- `onUploadCompleted` does **not** fire against `localhost` without a tunnel or explicit `callbackUrl` — plan for that in local dev.

### 2. The serverless body-size limit — the key architectural question

Two independent limits stack:

| Limit | Value | Source | Configurable? |
|---|---|---|---|
| Vercel Function request/response body | **4.5 MB** | Vercel docs, "last updated July 1, 2026" [ONLINE] | **No** — platform hard cap, returns `413 FUNCTION_PAYLOAD_TOO_LARGE` |
| Next.js `serverActions.bodySizeLimit` | **1 MB** default | `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md:29` [VERIFIED] | Yes, e.g. `'4mb'` — but cannot exceed the platform cap |

The local Next 16.3.1 docs add a detail worth respecting [VERIFIED, `serverActions.md:45`]: the limit applies to the **raw HTTP body including multipart boundaries and part headers**, so leave 10–20 KB of headroom below whatever you configure.

**Answer to "at what file size are we forced to client-side direct upload":**
- Above **~1 MB**: server actions fail out of the box.
- Above **~4.4 MB** (4.5 MB minus multipart overhead): impossible through any Vercel function, period.
- Our stated range is **1–20 MB**, and a modern phone photo is routinely 3–8 MB. **Effectively 100% of real uploads exceed the server-action path.** Client-side direct upload is the only design that works. Do not build the server-action path as the primary flow.

Vercel's docs note streaming request bodies are exempt from the 4.5 MB cap [ONLINE], but that is a fragile workaround compared to direct-to-storage upload, and it would still burn function duration and data transfer.

### 3. Access control — the children's-data question

**This is where the answer changed.** Historically Vercel Blob was public-only, and the honest answer would have been "unguessable public URLs, unsuitable for a minor's data." That is **no longer true**.

**Vercel Private Blob is now generally available, on all plans.** [ONLINE — changelog]

- Upload with `access: 'private'` (via `put()` or `upload()`).
- Private blobs get a URL of the form `https://<store-id>.private.blob.vercel-storage.com/<pathname>`. This URL is **not publicly accessible**. Reads require authentication.
- Server-side read: `get()` in a function, which fetches through the CDN and streams to the browser. Supports `ifNoneMatch` for conditional 304 responses. You control browser caching via `Cache-Control` on your own function's response.
- **Signed URLs**, for handing time-limited access to a client without proxying bytes:

```ts
// Shape per Vercel docs. NOT verified against installed types.
import { issueSignedToken, presignUrl } from '@vercel/blob';

const token = await issueSignedToken({ operations: ['get'] });
const { presignedUrl } = await presignUrl(token, {
  pathname: 'students/<id>/work/<blobId>.jpg',
  operation: 'get',
  validUntil: Date.now() + 5 * 60 * 1000,   // max 7 days
});
```

The signature covers the operation and constraints, so a URL signed for `get` **cannot be replayed as a `put`**. Scoped to a single pathname. [ONLINE]

- **OIDC authentication**: when a private store is connected to a project, Vercel injects `BLOB_STORE_ID` and a short-lived, auto-rotating `VERCEL_OIDC_TOKEN`. The SDK prefers OIDC over `BLOB_READ_WRITE_TOKEN` when both are present. You still need the static read-write token to mint **client** tokens for browser uploads. [ONLINE]
- **Vercel WAF for Blob** is also GA [ONLINE], though I did not investigate it.

**For contrast — public blobs remain unsuitable here.** Vercel's own security docs say public blob URLs are "unique and hard to guess" with `addRandomSuffix: true`, explicitly analogize this to Google Docs "share via link", state there is **no built-in access control for public blobs**, warn that search engines can index them, and recommend private storage when authentication is needed. For a minor's schoolwork, unguessable-but-public is not an acceptable control. **Do not use a public store.**

**Design implication:** short signed URL TTLs (minutes, not days), pathnames namespaced by student ID, and an authorization check in your own code before minting any signed URL. The signed URL is a bearer credential — treat leakage of one as leakage of that file.

### 4. HEIC

**Yes, something must convert them.** [ONLINE]

- No mainstream browser decodes HEIC natively — including Safari, which does not recognize the `image/heic` mimetype for rendering. So you cannot show a preview without converting.
- Anthropic's vision API accepts **JPEG, PNG, GIF, WebP** (plus PDFs directly). **HEIC is not on the list.** I found a 2023-era OpenAI community thread saying HEIC was unsupported there too, but I could **not** confirm OpenAI's current 2026 format list from primary docs.

**Common approaches, and the honest trade-offs:**

1. **Rely on iOS auto-conversion.** iOS/Safari often transcodes HEIC to JPEG automatically when a photo is chosen through `<input type="file">`, especially with a restrictive `accept="image/jpeg,image/png"`. This is real but **not reliable** — picking an existing file via the Files app, or certain in-app browsers, can still deliver a `.heic`. Use `accept` as a first line of defense, never as the only one.
2. **Client-side conversion before upload** (most common in Next.js apps). Libraries: `heic2any` (long-standing, wraps libheif-wasm) or the newer `heic-to`. Decode → draw to canvas → `toBlob('image/jpeg')`. Advantages: bytes shrink before they hit the network, the AI-ready format is what gets stored, and no server CPU. Disadvantage: a large wasm payload, so **lazy-load it only when a HEIC is detected** (sniff the file magic bytes / `ftypheic` box rather than trusting the extension).
   - **Correction to a claim I saw online:** several posts suggest "just use the canvas API instead of a library." That is wrong — canvas cannot decode HEIC if the browser cannot decode HEIC. You need a wasm decoder. Canvas is only the *encode* half.
3. **Server-side with `sharp`.** Possible but `sharp`'s prebuilt libvips has limited/awkward HEIC support and needs special configuration; and on Vercel you'd have to pull the file back out of Blob into a function, burning duration and transfer. Not recommended as the primary path.

**Suggested pipeline:** detect HEIC client-side → lazily convert to JPEG → upload the JPEG via `upload()` → server stores pathname + content type in Postgres → vision call reads via `get()` or a short-lived signed URL. Keep a server-side content-type allowlist in `onBeforeGenerateToken` as the enforcement point.

**This requires a new dependency (`heic2any` or `heic-to`). Flagging for approval — not assuming it.**

### 5. Vercel Blob pricing

[ONLINE — figures from Vercel's pricing/usage docs as surfaced in search; I could not read the pricing page directly, so treat as approximate and re-check before budgeting.]

- **Hobby (free):** 1 GB/month storage, 10 GB/month data transfer, 10,000 simple operations, 2,000 advanced operations.
- **Pro:** 5 GB storage, 100,000 simple ops, 10,000 advanced ops per month included.
- **Overage:** storage $0.023/GB; simple operations $0.40 per million; advanced operations $5.00 per million; data transfer from ~$0.05/GB (regional variation).
- Vercel markets storage/operation pricing as matching S3 with no premium.

**Sizing sanity check:** at ~5 MB per upload, the Hobby 1 GB allowance is roughly 200 files total. This project will outgrow the free tier quickly. Also note the **operation counts** — I could not confirm whether a signed-URL `get` counts as a simple or advanced operation, which matters a lot if every page view re-reads a blob. **Cache aggressively and store the pathname in Postgres rather than re-listing.**

### 6. Alternative — Supabase Storage

Genuinely strong on the exact axis we care about. [ONLINE]

- **Private buckets are the default posture.** Storage allows no uploads to buckets without RLS policies; you selectively grant operations by writing RLS policies on `storage.objects`. Marking a bucket "Public" explicitly bypasses access control for reads — so private is opt-out, not opt-in. That is the right default for children's data.
- **Signed URLs** via `createSignedUrl(path, expiresIn)`. Requires `select` on `storage.objects`. Notably: signed URLs are signed with a **dedicated internal key separate from the project's Auth JWT signing key**, so they stay valid across auth key rotation — a subtle operational gotcha both ways (rotating auth keys will *not* revoke outstanding signed URLs).
- **Client direct upload**: `createSignedUploadUrl()` mints a time-limited upload token, and resumable (TUS) uploads are supported for large files. Same architectural shape as Vercel's client upload.
- **File size limits:** Free projects cap individual files at **50 MB**; paid plans go to 500 GB. Our 20 MB ceiling fits either.
- **Pricing:** Free = 1 GB storage, 5 GB egress + 5 GB cached egress. Pro = 8 GB storage then $0.125/GB; 250 GB cached + 250 GB uncached egress included; overage $0.09/GB uncached, $0.03/GB cached.
- **Major caveat:** Free-plan projects are **paused after 1 week of inactivity**. Unacceptable for anything user-facing; you'd be on Pro from day one.

**The real cost of Supabase here is architectural, not financial.** Per `/workspaces/Agents/app/CLAUDE.md`, this project's Postgres is on **Neon**. Adopting Supabase Storage means running a second backend vendor purely for files, and — importantly — **the RLS advantage largely evaporates**, because RLS policies key off Supabase Auth's `auth.uid()`. With Neon as the database and (presumably) a non-Supabase auth story, you would be writing service-role-key access from your own server and enforcing authorization in application code anyway. That is exactly what you'd do with Vercel Blob, minus a vendor.

Supabase Storage is the right answer for a Supabase-native stack. It is a weaker fit here specifically because the RLS story does not transfer.

### 7. Alternative — S3 / R2

Brief, as requested. **Presigned uploads are not meaningfully more work — but the surrounding plumbing is.**

- The upload itself is a well-trodden path: `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, `getSignedUrl(client, new PutObjectCommand(...), { expiresIn })`. R2 is S3-API-compatible and presigned URLs work identically. Maybe 30 extra lines vs. `handleUpload()`.
- What *is* more work: **CORS configuration on the bucket** (a classic multi-hour time sink for browser presigned PUTs), bucket policy / public-access-block setup, credential management (long-lived access keys, since there's no Vercel OIDC integration out of the box), multipart upload orchestration if you want resumability, and no equivalent of `onUploadCompleted` — you'd either poll, have the client confirm, or wire up S3 event notifications.
- **R2's advantage is real: $0 egress**, vs. S3's ~$0.09/GB. If this app ever serves a lot of image reads, that is the single biggest cost lever available.
- Both are private-by-default with presigned reads, so the privacy requirement is satisfied cleanly.

Verdict: not more work for the happy path, noticeably more work for the whole path, and it adds AWS/Cloudflare as a third vendor. Worth revisiting only if egress costs become material.

### 8. Recommendation

**Use Vercel Blob with a private store (`access: 'private'`), client-direct upload via `upload()`/`handleUpload()`.**

Reasoning:
1. **The privacy requirement is met properly.** Private blobs are auth-required, not merely unguessable. Signed URLs are operation-scoped and time-limited. This is a real access-control boundary, not security-by-obscurity. I was prepared to recommend against Vercel Blob on this exact point, and the GA of Private Blob is what changes the answer.
2. **It solves the 4.5 MB problem natively.** `upload()` + `multipart: true` handles 20 MB files without touching a function, with progress and retries included.
3. **Best security posture per unit of effort.** OIDC means no static storage secret in the server environment for reads. That's a meaningful reduction in blast radius for children's data.
4. **One vendor.** The app already deploys to Vercel. No new provider, no new dashboard, no new on-call surface.

**Trade-offs you are accepting:**
- Vendor lock-in to Vercel storage. Migration later means re-uploading everything (mitigate by storing pathnames, never full URLs, in Postgres — keep an abstraction layer around the storage calls).
- Private-blob reads must go through your function or a signed URL, so you pay data transfer on reads that public blobs would have served from CDN for free. Cache deliberately.
- The private/signed-URL API is new. Docs are ahead of community knowledge; you will be debugging without many Stack Overflow answers.

**Concrete next steps:**
1. Timebox a spike: `pnpm add @vercel/blob`, then **read `node_modules/@vercel/blob/dist/index.d.ts`** and confirm the real signatures of `put`, `upload`, `handleUpload`, `get`, `issueSignedToken`, `presignUrl` before any design is finalized. Every signature in this doc is doc-derived, not type-verified.
2. Create a **private** Blob store (not public) and confirm the private URL 403s when fetched unauthenticated. Verify this yourself; don't trust the docs.
3. Model files in Prisma as `{ id, studentId, pathname, contentType, sizeBytes, createdAt }`. Store **pathname**, not the full URL.
4. Put the authorization check in `onBeforeGenerateToken` and zod-validate `clientPayload` there.
5. Decide on HEIC conversion and get dependency approval.

**Fallback:** if the private-blob spike goes badly, Supabase Storage private buckets + `createSignedUrl` is the next choice, accepting the second-vendor cost and Pro-plan-from-day-one.

## Risks and unknowns

**Could not verify (no SDK installed — everything below is doc-derived only):**
- Exact TypeScript signatures for `put`, `upload`, `handleUpload`, `get`, `issueSignedToken`, `presignUrl`. The `presignUrl` return shape (`{ presignedUrl }`) and the `issueSignedToken({ operations })` argument shape come from a changelog snippet, not from types. **Assume these are approximately right and confirm at install time.**
- Whether `@vercel/blob` **2.8.0** is truly the latest as of 2026-08-26. Search reported it as published "15 days ago"; I could not read the npm page directly.
- Whether client-side `upload()` with `access: 'private'` is fully supported end-to-end, or whether private stores impose extra constraints on browser uploads. Search suggests it works; **not confirmed from the client-upload doc itself.** This is load-bearing for the recommendation — verify it first in the spike.
- Whether private-store data transfer is priced the same as public. Not stated anywhere I found.
- Whether a signed-URL `get` counts as a simple or advanced operation. Materially affects cost at scale.
- Whether Private Blob is available on the **Hobby** plan specifically. The changelog says "generally available for all plans," but plan-level restrictions on storage features are common and I did not see a per-plan table.

**Time-sensitive / date-flagged:**
- The 4.5 MB function body limit is documented as "last updated July 1, 2026." Recent, but re-check before relying on it.
- All pricing figures are search-summarized rather than read from the pricing page. **Do not put these numbers in a budget without re-checking.**
- OpenAI's current supported vision image formats are **unconfirmed**; my only data point is a 2023 community post saying HEIC was unsupported. Anthropic's JPEG/PNG/GIF/WebP list is more recent but also second-hand.

**Operational risks:**
- **Signed URLs are bearer tokens.** Anyone with the URL reads the file until expiry. For a minor's data, use minutes-long TTLs and never embed them in cacheable HTML or logs. Consider proxying through `get()` for anything sensitive rather than handing out URLs at all.
- **`onUploadCompleted` does not fire on localhost** without a tunnel/`callbackUrl`. If DB writes depend on it, local dev and e2e tests will silently not persist. Design the Prisma write so it can also be driven by an explicit client confirmation call.
- **`allowOverwrite` default changed in v2.** Re-uploading to the same pathname throws. With `addRandomSuffix: true` this is mostly moot, but it will bite on any retry logic that reuses a path.
- **Orphaned blobs.** A client upload that succeeds while the DB write fails leaves an unreferenced blob containing a child's data. Needs a reconciliation/sweeper job — this is a genuine compliance concern, not just tidiness.
- **Deletion / right-to-erasure.** Nothing researched here covers how to guarantee deletion across CDN caches. If COPPA/FERPA obligations apply, that needs its own investigation.
- **HEIC detection by extension is unreliable.** Sniff magic bytes.

**Explicitly not researched:** COPPA/FERPA compliance requirements, Vercel/Supabase DPAs and sub-processor lists, data residency, encryption-at-rest guarantees, retention policies, and Vercel WAF for Blob. For an app handling minors' schoolwork, **the legal/compliance review is a separate and arguably higher-priority piece of work than the storage choice.**

## Sources

- https://www.npmjs.com/package/@vercel/blob — package identity; reported latest version 2.8.0
- https://vercel.com/docs/vercel-blob — Blob product overview
- https://vercel.com/docs/vercel-blob/using-blob-sdk — SDK reference, OIDC vs `BLOB_READ_WRITE_TOKEN` precedence
- https://vercel.com/docs/vercel-blob/server-upload — `put()` in a Next.js server action
- https://vercel.com/docs/vercel-blob/client-upload — `upload()` / `handleUpload()` / `onBeforeGenerateToken`, server-side enforcement of constraints
- https://vercel.com/docs/vercel-blob/private-storage — `access: 'private'`, private URL form, reading via `get()` with `ifNoneMatch`
- https://vercel.com/docs/vercel-blob/public-storage — public store behavior, for contrast
- https://vercel.com/docs/vercel-blob/vercel-signed-urls — `issueSignedToken` / `presignUrl`, operation scoping, 7-day max expiry
- https://vercel.com/docs/vercel-blob/security — public blobs have no built-in access control; `addRandomSuffix`; search-engine indexing warning
- https://vercel.com/changelog/vercel-private-blob-is-now-generally-available — Private Blob GA across all plans; signed URLs and OIDC out of beta
- https://vercel.com/changelog/signed-urls-are-now-available-for-vercel-blob — signed URL example code and semantics
- https://vercel.com/changelog/vercel-blob-now-supports-oidc-authentication — `VERCEL_OIDC_TOKEN`, `BLOB_STORE_ID`
- https://vercel.com/changelog/5tb-file-transfers-with-vercel-blob-multipart-uploads — multipart uploads, 5 TB ceiling, 5 MB minimum part size
- https://vercel.com/docs/functions/limitations — 4.5 MB function request/response body limit, "last updated July 1, 2026"
- https://vercel.com/docs/errors/FUNCTION_PAYLOAD_TOO_LARGE — the 413 returned when the cap is exceeded
- https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions — official guidance to upload direct-to-storage instead
- https://vercel.com/docs/vercel-blob/usage-and-pricing — Blob storage/transfer/operation pricing and plan allowances
- https://github.com/vercel/storage/releases — `@vercel/blob` v2 breaking changes (`allowOverwrite`, `callbackUrl`, `ifMatch`, deprecated `useCache`)
- `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md` — **[VERIFIED locally, Next 16.3.1]** 1 MB default `bodySizeLimit`; multipart overhead guidance
- `node_modules/next/dist/docs/01-app/02-guides/server-actions.md` — **[VERIFIED locally, Next 16.3.1]** server actions are untrusted public endpoints; CSRF and body-size protections
- https://supabase.com/docs/guides/storage/security/access-control — RLS on `storage.objects`, no uploads without policies
- https://supabase.com/docs/guides/storage/buckets/fundamentals — public buckets bypass access control
- https://supabase.com/docs/reference/javascript/v1/storage-from-createsignedurl — `createSignedUrl` API and required permissions
- https://supabase.com/docs/guides/storage/serving/downloads — signed URLs use a key separate from the Auth JWT signing key
- https://supabase.com/docs/guides/storage/uploads/resumable-uploads — `createSignedUploadUrl`, TUS resumable uploads
- https://supabase.com/docs/guides/storage/uploads/file-limits — 50 MB per-file cap on Free, 500 GB on paid
- https://supabase.com/pricing — Free/Pro storage and egress allowances and overage rates
- https://supabase.com/docs/guides/platform/free-project-pausing — Free projects pause after 1 week of inactivity
- https://www.npmjs.com/package/heic2any — client-side HEIC → JPEG/PNG conversion in the browser
- https://alexcorvi.github.io/heic2any/ — states no browser decodes HEIC natively, including Safari
- https://transloadit.com/devtips/browser-uploads-to-cloudflare-r2-with-aws-sdk/ — R2 presigned browser uploads with `@aws-sdk/s3-request-presigner`
- https://klymentiev.com/blog/r2-vs-s3 — R2 $0 egress vs S3 ~$0.09/GB (third-party blog, 2026)
- https://developers.openai.com/api/docs/guides/images-vision — OpenAI vision guide (surfaced in search; **current format list not confirmed**)

## New dependency?

Three, all requiring approval before use:

1. **`@vercel/blob`** — required for the recommended approach. Low risk, first-party to the existing Vercel deployment.
2. **`heic2any` or `heic-to`** — required only if we do client-side HEIC conversion. Adds a sizeable wasm decoder; must be lazy-loaded. Alternative is to rely on iOS auto-conversion, which is not reliable.
3. **`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`** — only if the S3/R2 path is chosen. Not recommended.
