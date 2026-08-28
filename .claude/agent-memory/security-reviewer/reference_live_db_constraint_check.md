---
name: live-db-constraint-check
description: How to verify a hand-added CHECK constraint or FK cascade is actually live in the local Postgres, without adding files to the repo
metadata:
  type: reference
---

Every milestone in this project adds a hand-written CHECK constraint that
`schema.prisma` cannot show, and the review question is always "is it LIVE, or
only present in a migration file?". Two ways to answer it:

1. Run the milestone's integration test — `pnpm exec vitest run
   tests/integration/<x>-constraint.test.ts`. Passing rejection tests are proof
   the constraint applied.
2. Query `pg_constraint` directly when you need the constraint TEXT (e.g. to
   catch a snake_case/camelCase column mismatch). `DATABASE_URL` in `.env` is a
   `prisma+postgres://` proxy URL that `pg` cannot speak; decode its `api_key`
   query param as base64 JSON and use `.databaseUrl`, exactly as
   `tests/integration/db-test-url.ts` does. `pg` is not hoisted to
   `node_modules/pg` — import it from
   `node_modules/.pnpm/pg@<version>/node_modules/pg/lib/index.js`. Keep the
   script in the scratchpad, never in the repo.

Useful queries: `pg_get_constraintdef(oid)` filtered by
`conrelid='"Table"'::regclass` for `contype='c'` (CHECK) and `'f'` (FK, shows
ON DELETE), and `select * from _prisma_migrations` to confirm the migration
finished with `rolled_back_at` null.

**Why:** the project has shipped migration SQL that would not have applied
(snake_case columns against Prisma's camelCase), and a CHECK that never applied
leaves `schema.prisma` looking identical.

**How to apply:** use it on any review whose scope includes a migration with
hand-edited SQL or a declared `onDelete: Cascade`.
