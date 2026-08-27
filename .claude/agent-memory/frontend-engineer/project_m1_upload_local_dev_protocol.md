---
name: project-m1-upload-local-dev-protocol
description: M1's client-direct upload has two real wire protocols (production Vercel Blob vs local dev), and the client tells them apart from the token response, never an env var.
metadata:
  type: project
---

`STORAGE_DRIVER` (`lib/config.ts`) defaults to `"local"` — filesystem-backed,
no CDN. `@vercel/blob/client`'s `upload()`/`put()` cannot work against it
(there's nothing at the other end of the PUT). Two real, disjoint upload
paths exist as of M1:

- **Production (`vercel-blob` driver):** `POST /api/blob/upload` with
  `{ type: "blob.generate-client-token", payload: { pathname, clientPayload,
  multipart } }` returns a real signed client token; the browser then calls
  `put(pathname, file, { access: "private", token, ... })` to move bytes
  straight to the CDN.
- **Local dev:** the SAME `POST /api/blob/upload` call returns an inert
  token prefixed `"local-inert-token:"` (baked into
  `lib/storage/local-fs.ts`'s `handleClientUpload`) instead of a real one.
  Bytes then go to a completely different, dev-only route,
  `POST /api/dev/local-upload` — `multipart/form-data` with `file`,
  `studentProfileId`, `pathname` fields, standard `ApiResult` envelope back.
  That route 404s outright unless `STORAGE_DRIVER === "local"` server-side.

**Why this matters:** `lib/config.ts` deliberately resolves `STORAGE_DRIVER`
to `"local"` for ANY code running in the browser (a `typeof window` guard),
specifically so client code can never branch on which driver the server is
actually configured with. The `"local-inert-token:"` prefix in the token
response is the one signal that's both real (not invented by frontend) and
safe for client code to read. See `components/uploads/upload-flow.ts` for
the full implementation — `requestClientToken()` always calls the real
`/api/blob/upload` first, then branches on `clientToken.startsWith(...)`.

**How to apply:** if a later milestone touches the upload panel again,
re-read `app/api/dev/local-upload/route.ts` and
`lib/storage/local-fs.ts`'s `handleClientUpload` before assuming this
memory's contract details are still current — this is exactly the kind of
thing that drifts. See [[frontend-parallel-track-workflow]].
