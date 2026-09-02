---
name: dev-only-route-fence-pattern
description: The house pattern for a dev-only route (app/api/dev/local-upload, app/api/dev/local-object) — unconditional fence returning 404 first, session required anyway, and why.
metadata:
  type: project
---

Two routes now share this exact shape: `app/api/dev/local-upload/route.ts`
(pre-existing) and `app/api/dev/local-object/route.ts` (added 2026-09-01, the
GET counterpart — serves narration audio bytes to the browser when
`STORAGE_DRIVER=local`, since `LocalFsStorage.signedReadUrl` returns a
deliberately non-fetchable placeholder).

**The pattern:**
1. `if (STORAGE_DRIVER !== "local") return errorResponse(apiErr("NOT_FOUND"))`
   — literally the first line, before session lookup, before anything. 404,
   not 403 — a probe against a prod deployment (`STORAGE_DRIVER=vercel-blob`)
   gets the identical response a nonexistent route would give, so it can't
   even confirm the route exists. Tested explicitly: a test asserts
   `verifySession` was NOT called when the fence trips.
2. Session IS still required even though the route is dev-only. Reasoning to
   reuse verbatim: "dev-only" is not "unauthenticated" — reasoning that a
   local-only surface doesn't need auth is exactly the shape of past security
   incidents elsewhere. It costs nothing here (a local dev session already
   exists for anyone using the app) and keeps the route's authorization shape
   consistent with every other read path rather than a special case.
3. Any attacker-controlled pathname/id gets validated with zod at the
   boundary AND scoped to a narrow regex with captured segments re-verified
   against the caller's own ownership (`requireStudentProfile`/
   `requireUpload` etc.) — never a bare filesystem read off unvalidated
   input, even scoped under a storage root. `LocalFsStorage` re-validates the
   pathname a third time internally (`resolveSafePath`), so this is
   deliberate defense in depth, not redundancy to trim.
4. Neither route uses `withAuth` (`lib/api/handler.ts`) — that helper's
   handler contract requires every response to go through
   `successResponse`/`errorResponse`'s JSON envelope, and both dev routes
   need a non-JSON success shape (`FormData` in, or raw bytes with an audio
   `Content-Type` out). Every FAILURE path in both routes still uses the
   shared `ApiError` envelope.

**How to apply:** the next dev-only route should copy this shape rather than
reinvent it — see `app/api/dev/local-object/route.ts` for the annotated
version, and its test file `tests/unit/app/api/dev/local-object-route.test.ts`
for the fence-ordering + traversal-payload test technique (an `it.each` table
of bad pathnames: `..`, absolute, wrong extension, wrong path segment, double
slash, percent-encoded traversal).
