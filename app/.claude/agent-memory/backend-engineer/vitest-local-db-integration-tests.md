---
name: vitest-local-db-integration-tests
description: how to run a real-database Vitest integration test against this project's local `prisma dev` server — the DATABASE_URL in .env is the wrong protocol for lib/db.ts, and Vitest doesn't load .env at all
metadata:
  type: project
---

Two separate traps stacked when writing the first Vitest test that hits the
real local Postgres database (no mocks) instead of a mocked `@/lib/db`.

**1. Vitest does not load `.env` automatically.** Confirmed empirically:
`process.env.DATABASE_URL` (and everything else only `.env` sets) is
`undefined` inside a plain `vitest run`, even though `next dev` and `prisma`
both load it fine. `dotenv` is already a devDependency (used today only by
`prisma.config.ts`) — added `import "dotenv/config"` to `vitest.setup.ts` to
fix this project-wide. `??=` fallbacks for module-load-time-required env
vars (`CONSENT_METHOD`, `AUDIT_PSEUDONYM_KEY`, `EMAIL_TRANSPORT`) go in the
same file, applied *after* the dotenv load so `.env` wins when it sets one.

**2. Even with `.env` loaded, `DATABASE_URL` is the WRONG PROTOCOL for
`lib/db.ts`.** `pnpm exec prisma dev start` writes `.env`'s `DATABASE_URL`
as `prisma+postgres://localhost:<port>/?api_key=...` — this is understood
by Prisma's own CLI/query engine (`prisma.config.ts`, used by `prisma
migrate`/`prisma studio`) but NOT by `@prisma/adapter-pg`'s `PrismaPg`,
which `lib/db.ts` uses and which speaks the raw Postgres wire protocol via
`pg`. Pointing `pg` at that proxy URL fails with "Connection terminated
unexpectedly" (confirmed by direct reproduction). The proxy URL's
`api_key` query param is a base64 JSON blob containing the REAL
`postgres://...` URL the dev server proxies to (the same one `prisma dev
start` also prints as its second, "connect with Prisma ORM" connection
string) — decode it and swap `process.env.DATABASE_URL` before importing
`@/lib/db`.

**Fix applied:** `tests/integration/db-test-url.ts` exports
`configureDirectDatabaseUrl()` (NOT prefixed `use*` — ESLint's
`react-hooks/rules-of-hooks` flags any top-level function starting with
`use` as a hook and errors on a top-level call) which does this decode; a
no-op for a real `postgres://` URL (Neon/Supabase/CI). Every integration
test file must call it, then `const { db } = await import("@/lib/db")` —
a *dynamic* import, never a static one, since ESM hoists static imports
ahead of the env-var mutation and the fix wouldn't apply in time.

**How to apply:** any future integration test that needs the real
Prisma client (not a mock) — follow the same pattern:
`configureDirectDatabaseUrl()` first, then dynamic `import("@/lib/db")`.
Also add the test directory to `vitest.config.mts`'s `include` glob if it's
outside `tests/unit/**` (it wasn't originally).
