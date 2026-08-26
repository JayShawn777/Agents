# Research: Vercel Blob — signatures verified against installed types

- **Date:** 2026-08-26
- **Researcher:** Claude, reading `node_modules/@vercel/blob@2.8.0/dist/*.d.ts`
- **Question:** Do the API shapes that ADR-0003 and the M0/M1 plan depend on actually exist, or were they inferred from documentation?
- **Verdict:** They exist. The load-bearing assumption — that a **client-direct upload can target a private blob** — is confirmed at the type level: `upload()` from `@vercel/blob/client` takes a **required** `access: 'public' | 'private'`. Every other API the plan names is present with the expected shape. Runtime behaviour still needs a Vercel account; the type surface no longer does.

## Summary

- **`@vercel/blob@2.8.0` installed.** This supersedes the doc-derived signatures in
  [file-upload-storage.md](file-upload-storage.md), which were explicitly flagged as unverified.
- **`upload(pathname, body, options)`** from `@vercel/blob/client` — `access` is **required** and accepts `'private'`. This was spike assertion S1's blocking premise and it holds.
- **`handleUpload`** exists as expected, plus an undocumented-to-us sibling **`handleUploadPresigned`** worth evaluating.
- **`issueSignedToken`** and **`presignUrl`** both exist as real exports. The plan's signed-URL design is not fictional.
- **`get()` requires `access`** too, and adds `useCache` and `ifNoneMatch` — an ETag path we had not planned for and which is useful for repeat previews.
- **`list()` returns `uploadedAt: Date` per blob, plus `cursor` and `hasMore`.** Spike assertion S9 — that the reconciler can walk the store by object age — is satisfied by the type surface.
- **`head()` returns `size`, `contentType`, `uploadedAt`, `cacheControl`.** S8 satisfied.
- **`upload()` supports `onUploadProgress({loaded, total, percentage})`** and `multipart`. The progress UI in the design is backed by a real callback, not a guess.
- Also present and unplanned: `putImage`, `putFromUrl`, `copy`, `createFolder`, `createMultipartUploader`.

## Findings

### The question the spike existed to answer

`ClientCommonCreateBlobOptions` carries:

```ts
access: BlobAccessType;   // 'public' | 'private' — REQUIRED, not optional
```

and `UploadOptions = ClientCommonPutOptions & CommonUploadOptions`, where
`CommonUploadOptions` requires `handleUploadUrl` — the route on our server that
mints the token. So the shape the plan assumed (browser uploads bytes directly,
server only authorises) is the shape the library implements, and it can do so
against a private store.

**What this does not prove:** that the bytes actually bypass our origin, that an
unauthenticated fetch of a private URL is refused, or that a `get`-signed URL
cannot be replayed as a `put`. Those are runtime behaviours (spike assertions
S1, S2, S4) and still require a real store.

### What changed relative to the plan

- `get()` taking `ifNoneMatch` gives us a cheap 304 path for repeat previews.
  Worth considering in M1's preview route, which currently assumes a fresh read.
- `handleUploadPresigned` is a second client-upload flow we had not evaluated.
  Someone should read it before committing to `handleUpload`.
- The signed-token API is two calls (`issueSignedToken` then `presignUrl`), not
  one. The plan's storage port should reflect that.

## Risks and unknowns

- **No runtime verification.** Everything here is the type surface. A library can
  export a correctly-typed function that fails against a store the account is not
  entitled to — in particular, whether **Private Blob is available on the Hobby
  plan** is still unknown and is a listed open question.
- **`issueSignedToken` / `presignUrl` option shapes were not read in full.**
  The declarations exist; the exact fields (expiry bound, operation scoping)
  were not enumerated here and must be read before the storage port is written.
- The 7-day signed-URL expiry cap and the one-operation-one-pathname scoping
  claims come from documentation, not from these types. Unverified.
- `heic-to@1.5.2`, `pdf-lib@1.17.1`, `next-auth@5.0.0-beta.32`,
  `@auth/prisma-adapter@2.11.3`, `@anthropic-ai/sdk@0.120.0` are installed but
  **not yet type-checked against this project**. `@auth/prisma-adapter` against
  the Prisma 7 generated client is the flagged risk.

## Sources

- `node_modules/@vercel/blob/dist/client.d.ts` — client upload surface, `UploadOptions`, `CommonUploadOptions`, `handleUpload`, `handleUploadPresigned`
- `node_modules/@vercel/blob/dist/index.d.ts` — `get`, `head`, `list`, `del`, `copy`, `put*`, result shapes
- `node_modules/@vercel/blob/dist/create-folder-BM6BTlko.d.ts` — `BlobAccessType`, `issueSignedToken`, `presignUrl`

---

**Note on staleness:** research goes out of date silently. Anything in here is
only true as of the Date above. Re-verify version numbers, pricing, and API
shapes before relying on them for a new decision.
