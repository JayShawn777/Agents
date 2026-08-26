# Runbook

Operational reference for this project. Keep it accurate — docs-writer updates it
whenever env vars, migrations, or deploy steps change.

---

## 1. Run locally

**Prerequisites:** Node 20+, pnpm, and a Postgres database URL (see §3).

```bash
pnpm install                 # install dependencies
cp .env.example .env         # then edit .env and set DATABASE_URL
pnpm db:migrate              # apply migrations + generate the Prisma client
pnpm dev                     # http://localhost:3000
```

### Local database (no signup required)

This project uses Prisma’s built-in local Postgres for development. It runs on
your machine — no account, no cloud, nothing to pay for.

```bash
pnpm exec prisma dev start app   # start it (after a reboot, run this first)
pnpm exec prisma dev ls          # check whether it is running
pnpm exec prisma dev stop app    # stop it
```

The server is named `app` and keeps its ports, so `DATABASE_URL` in `.env` stays
valid across restarts. If `pnpm dev` cannot reach the database, the server is
simply stopped — run `prisma dev start app`.

Swap `DATABASE_URL` for a Neon or Supabase string when you are ready to deploy.

**Verification gates** — all three must pass before anything is DONE:

```bash
pnpm typecheck   # next typegen && tsc --noEmit
pnpm lint        # eslint
pnpm test        # vitest run
pnpm test:e2e    # playwright test (starts the dev server itself)
```

First Playwright run only: `pnpm exec playwright install chromium`.

**pnpm ONLY.** Never run `npm install` or `yarn` here — it produces a competing
lockfile and a different dependency tree.

---

## 2. Migrations

Schema lives in `prisma/schema.prisma`. The datasource URL is read from
`DATABASE_URL` via `prisma.config.ts` (Prisma 7 does not read `.env` on its own —
`prisma.config.ts` imports `dotenv/config`).

| Task | Command |
|---|---|
| Create + apply a migration in dev | `pnpm db:migrate` |
| Regenerate the client after a schema edit | `pnpm db:generate` |
| Inspect data in a GUI | `pnpm db:studio` |
| Apply migrations in production | `pnpm exec prisma migrate deploy` |
| Check drift | `pnpm exec prisma migrate status` |

**Rules**
- Migration files in `prisma/migrations/` are immutable once applied. To change an
  applied migration, write a NEW one.
- The generated client goes to `lib/generated/prisma/` and is gitignored — it is
  rebuilt by `pnpm db:generate`. Import the client from `@/lib/db`, never from
  `@prisma/client` (Prisma 7 requires the driver adapter wired up in `lib/db.ts`).
- Review the SQL before applying a migration that drops or renames a column.
  Renames are generated as drop+add, which loses data.
- Never point `db:migrate` at the production database. Use `migrate deploy`.

---

### Cloud database (Neon) — deployment only

The Neon connection string lives in `.env.neon`, which is gitignored and separate
from `.env` on purpose: day-to-day work must never run against production.

```bash
pnpm db:status:prod    # check migration state on Neon
pnpm db:migrate:prod   # apply existing migrations to Neon (migrate deploy)
```

`scripts/prisma-prod.mjs` refuses `migrate dev` against the cloud — that command
can drop and recreate the database. Create migrations locally with `pnpm
db:migrate`, then apply them with `pnpm db:migrate:prod`.

## 3. Environment variables

Copy `.env.example` → `.env`. `.env` is gitignored and must never be committed.

| Variable | Required | Where used | Notes |
|---|---|---|---|
| `DATABASE_URL` | Yes | `prisma.config.ts`, `lib/db.ts` | Postgres connection string from Neon or Supabase. Server only. |
| `NEXT_PUBLIC_APP_URL` | Yes | Client + server | Public base URL. **Anything `NEXT_PUBLIC_` ships to the browser — never put a secret here.** |
| `AUTH_SECRET` | When auth is added | Auth.js | Generate with `pnpm dlx auth secret`. |
| `AUTH_URL` | When auth is added | Auth.js | Base URL for callbacks. |

Pooling: serverless functions exhaust direct Postgres connections. Use the pooled
connection string for the app (Neon `-pooler` host, Supabase port 6543) and the
direct one for migrations.

---

## 4. Deploying to Vercel

**One-time setup**
1. Push the repo to GitHub.
2. Vercel → Add New → Project → import the repo. Vercel detects Next.js; leave
   build settings at their defaults.
3. Settings → Environment Variables: add `DATABASE_URL` and `NEXT_PUBLIC_APP_URL`
   for Production, Preview, and Development. They are NOT read from `.env` —
   `.env` is gitignored and never reaches Vercel.
4. Set the build command to `prisma generate && next build` so the client exists
   at build time (`lib/generated/prisma/` is gitignored).

**Each deploy**
- Push to `main` → Production. Open a PR → Preview deployment with its own URL.
- Migrations do NOT run automatically. Run `pnpm exec prisma migrate deploy`
  against production after deploying a schema change, or add it to the build
  command once you are confident in the migrations.

**Rollback:** Vercel → Deployments → pick the last good one → Promote. Note that
this does NOT roll back a database migration; write a corrective migration.

**When a deploy fails**
| Symptom | Cause | Fix |
|---|---|---|
| `@prisma/client did not initialize` | Client not generated at build | Build command must run `prisma generate` |
| `Can't reach database server` | Wrong URL, or unpooled connection | Use the pooled connection string |
| Works locally, 500 in prod | Missing env var in Vercel | Add it in Settings → Environment Variables |
| Type errors only in CI | Stale local `.next/types` | Run `pnpm typecheck` locally — it runs `next typegen` first |
