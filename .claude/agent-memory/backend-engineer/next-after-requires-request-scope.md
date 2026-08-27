---
name: next-after-requires-request-scope
description: next/server's after() throws "called outside a request scope" when invoked from a plain function call in a Vitest unit test — must be mocked
metadata:
  type: feedback
---

`after()` from `next/server` (used to schedule extraction post-response,
ADR-0005 — `lib/uploads/record-upload.ts`, `app/api/extractions/[id]/retry/route.ts`)
throws `` `after` was called outside a request scope `` when called directly
in a Vitest unit test, even though the surrounding route handler runs fine
under `withAuth()`'s plain `(req, ctx)` call signature otherwise. It relies
on Next's own request-scoped `AsyncLocalStorage`, which a bare `await
handler(req, ctx)` in a test never establishes.

**Why:** confirmed by writing a throwaway `after(() => {})` call directly in
a Vitest test file — it threw immediately, unconditionally, regardless of
mocking anything else. This is not a bug in the route; it's an artifact of
testing a route handler without Next's real request pipeline.

**How to apply:** any unit test that exercises a code path calling `after()`
must `vi.mock("next/server", () => ({ after: vi.fn() }))` before importing
the module under test — see `tests/unit/lib/uploads/record-upload.test.ts`
and `tests/unit/app/api/extractions/retry-route.test.ts` for the pattern.
Assert `afterMock` was/wasn't called to verify scheduling behavior (e.g. "no
`after()` call on the idempotent re-read branch of a confirm").
