---
name: vitest-server-only-shim
description: server-only throws under Vitest unless aliased to a no-op shim — needed to unit test any module in the DAL/server-only chain
metadata:
  type: project
---

The `server-only` package throws unconditionally when imported outside
Next's own RSC compilation step (that's what makes it a useful compile-time
guard in the real app per ADR-0006/CLAUDE.md). Under plain Vitest, any
module starting with `import "server-only"` (e.g. `lib/auth/dal.ts`,
`lib/api/handler.ts`, `lib/students/dto.ts`, all the `lib/email/*` senders)
crashes the whole test file at import time with "This module cannot be
imported from a Client Component module."

**Fix applied (2026-08-26, M0 backend work):** added a Vitest resolve alias
in `vitest.config.mts` mapping the bare specifier `server-only` to
`tests/unit/mocks/server-only.ts`, a one-line `export {}` shim. This is a
config change affecting the whole test suite, not scoped to one file — it
was necessary before `lib/api/handler.ts`'s check-ordering tests (which
depend on `lib/auth/dal.ts`'s types) could even import successfully.

**Separately:** `lib/auth/dal.ts` (and by extension `lib/auth/config.ts`,
which configures real Auth.js/Prisma) is too heavy to actually execute in a
unit test — importing it for real pulls in `next-auth`, which pulls in
`next/server`, which doesn't resolve cleanly under Vitest's module
resolution. Route-handler tests that exercise real exported route files
(e.g. `app/api/students/**/route.ts`) must `vi.mock("@/lib/auth/dal", ...)`
and `vi.mock("@/lib/db", ...)` at the top of the test file — don't rely on
`withAuth()`'s `getSession` override for this; production route files never
pass it, so the DAL mock is the only lever a route-level test has.

**How to apply:** Any future test that imports a `server-only`-guarded
module needs the `server-only` alias already in place (it is, as of this
change — don't re-add it). Any test that imports an actual `app/api/**`
route file needs to `vi.mock` `@/lib/auth/dal` and `@/lib/db` before
importing the route module (dynamic `await import(...)` after the
`vi.mock` calls, since `vi.mock` is hoisted but the route file's top-level
imports still need the mocks in place first).
