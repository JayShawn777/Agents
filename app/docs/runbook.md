# Runbook

Operational reference for this project. Keep it accurate — docs-writer updates it
whenever env vars, migrations, or deploy steps change.

---

## 1. Run locally

**Prerequisites:** Node 20+, pnpm, and a Postgres database URL (see §3).

```bash
pnpm install                       # install dependencies
cp .env.example .env               # then edit .env and set DATABASE_URL
pnpm exec prisma dev --name app --detach   # first time only — see below
pnpm db:migrate                    # apply migrations + generate the Prisma client
pnpm dev                           # http://localhost:3000
```

### Local database (no signup required)

This project uses Prisma's built-in local Postgres for development. It runs on
your machine — no account, no cloud, nothing to pay for.

**First time on this machine — the instance does not exist yet:**

```bash
pnpm exec prisma dev --name app --detach   # creates AND starts it
```

Running `prisma dev start app` before the instance has ever been created prints
"No prisma dev servers found to start" and does nothing — `start` only starts an
instance that already exists. `--name app --detach` is what creates it.

**After it exists** (every time after, including after a reboot):

```bash
pnpm exec prisma dev start app   # start it
pnpm exec prisma dev ls          # check whether it is running
pnpm exec prisma dev stop app    # stop it
```

The server is named `app` and keeps its ports, so `DATABASE_URL` in `.env` stays
valid across restarts. If `pnpm dev` cannot reach the database, the server is
simply stopped — run `prisma dev start app` (not `--detach`, which is only for
first-time creation).

Swap `DATABASE_URL` for a Neon or Supabase string when you are ready to deploy.

**Verification gates** — all three must pass before anything is DONE:

```bash
pnpm typecheck   # next typegen && tsc --noEmit
pnpm lint        # eslint
pnpm test        # vitest run
pnpm test:e2e    # playwright test (starts the dev server itself)
```

`pnpm typecheck`, `pnpm lint` and `pnpm test` also run automatically whenever an
agent stops or finishes a subtask — see §5. `pnpm test:e2e` is not part of that
gate and must still be run by hand.

First Playwright run only, or this fails: `pnpm exec playwright install chromium`.

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
| Apply migrations in production | `pnpm db:migrate:prod` (guarded — see below) |
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

Today, on the still-unbuilt starter page, only the first two rows are read by
any code. The rest are named by
[the M0/M1 plan §7](plans/m0-m1-implementation.md#7-configuration-module) and
must exist in `.env.example` (placeholders only) and here **before** that work
lands, per CLAUDE.md's "every new env var" rule — not because the app reads
them yet.

| Variable | Required | Where used | Notes |
|---|---|---|---|
| `DATABASE_URL` | Yes, today | `prisma.config.ts`, `lib/db.ts` | Postgres connection string from Neon, Supabase, or the local `prisma dev` server. Server only. |
| `SHADOW_DATABASE_URL` | Neon only | `prisma.config.ts` | Leave `""` for the local `prisma dev` server — it carries its own shadow database inside its connection string. A real value is required once `DATABASE_URL` points at Neon. `prisma.config.ts` coerces an empty string to `undefined`; passing `""` straight through makes `prisma migrate` fail with P1013. |
| `NEXT_PUBLIC_APP_URL` | Yes, today | Client + server | Public base URL. **Anything `NEXT_PUBLIC_` ships to the browser — never put a secret here.** |
| `AUTH_SECRET` | M0 (not yet built) | Auth.js (ADR-0002), planned `lib/auth/config.ts` | Generate with `pnpm dlx auth secret`. |
| `AUTH_URL` | M0 (not yet built) | Auth.js | Base URL for callbacks. |
| `AUTH_RESEND_KEY` | M0 (not yet built) | planned `lib/email/client.ts` | Resend API key. Sends the magic link, the §312.4 direct notice, and the consent confirmation. |
| `EMAIL_FROM` | M0 (not yet built) | planned `lib/email/client.ts` | Verified sending address/domain in Resend. |
| `BLOB_READ_WRITE_TOKEN` | M0 (not yet built) | planned `lib/storage/vercel-blob.ts` | Vercel Blob token (ADR-0003). Server only — never sent to the client. |
| `ANTHROPIC_API_KEY` | M1 (not yet built) | planned `lib/ai/client.ts` | Worksheet extraction (ADR-0005). Server only. |
| `CRON_SECRET` | M0/M1 (not yet built) | planned `app/api/cron/*/route.ts` | Vercel Cron will send this as `Authorization: Bearer <value>`; the routes 401 without a match. |
| `CONSENT_METHOD` | **Yes, today** | `lib/config.ts` (ADR-0008) | Must be a value `lib/consent/methods/registry.ts` implements. Only `EMAIL_PLUS` ships in M0/M1; a bad value is meant to fail the boot. |
| `AUDIT_PSEUDONYM_KEY` | M0 (not yet built) | planned `lib/deletion/service.ts` | HMAC-SHA256 key that will pseudonymise the adult's identity in `ConsentAuditArtifact`. Never the raw email; never reused for anything else. |

Pooling: serverless functions exhaust direct Postgres connections. Use the pooled
connection string for the app (Neon `-pooler` host, Supabase port 6543) and the
direct one for migrations.

---

## 4. Deploying to Vercel

**One-time setup**
1. Push the repo to GitHub.
2. Vercel → Add New → Project → import the repo. Vercel detects Next.js.
3. Settings → General → **Root Directory: `app`**. The app lives in a
   subdirectory of this repository; without this, the build fails looking for
   `package.json` at the repo root.
4. Settings → Environment Variables: add every variable from §3 for Production,
   Preview, and Development (today that's `DATABASE_URL` and
   `NEXT_PUBLIC_APP_URL`; add the rest as each M0/M1 piece lands). They are NOT
   read from `.env` — `.env` is gitignored and never reaches Vercel.
5. **Leave the Build and Install commands at their defaults.** `postinstall` in
   `package.json` already runs `prisma generate`, so the gitignored client is
   recreated on every build. Overriding the Build command to
   `prisma generate && next build` is a common mistake — it works, but it means
   two sources of truth for the same step, and Vercel's Install and Build fields
   are easy to confuse. See CLAUDE.md.

**Each deploy**
- Push to `main` → Production. Open a PR → Preview deployment with its own URL.
- Migrations do NOT run automatically. Run `pnpm db:migrate:prod` after
  deploying a schema change. Do not add it to the build command — a failed
  migration would then take the whole deploy down with it.

**Rollback:** Vercel → Deployments → pick the last good one → Promote. Note that
this does NOT roll back a database migration; write a corrective migration.

**When a deploy fails**
| Symptom | Cause | Fix |
|---|---|---|
| `@prisma/client did not initialize` | Client not generated at build | `postinstall` must still run `prisma generate` — check it was not removed |
| `Can't reach database server` | Wrong URL, or unpooled connection | Use the pooled connection string |
| Works locally, 500 in prod | Missing env var in Vercel | Add it in Settings → Environment Variables |
| Type errors only in CI | Stale local `.next/types` | Run `pnpm typecheck` locally — it runs `next typegen` first |

---

## 5. Agent hooks (guard + verify)

Two hooks are wired in `.claude/settings.json` and run for every agent, not just
the pipeline agents. Both are code, not policy prose, so they cannot be skipped
by an agent that skims CLAUDE.md too fast.

| Hook | Fires on | Does |
|---|---|---|
| `.claude/hooks/guard.mjs` | `PreToolUse` (Edit/Write/MultiEdit/NotebookEdit/Bash) | **Blocks** (exit 2) before the tool call runs: editing anything under `prisma/migrations/`; writing to `.env` (`.env.example` is fine); `git push --force` (`--force-with-lease` is allowed); `npm`/`yarn` install commands; `prisma migrate dev` aimed at a Neon/cloud URL. |
| `.claude/hooks/verify.mjs` | `Stop` and `SubagentStop` | Runs `pnpm lint`, `pnpm typecheck`, and `pnpm test`, in that order, and **blocks** (exit 2) with the failure output if any fail. Does **not** run on every edit — only when an agent claims to be finished. `pnpm test:e2e` is not part of this gate; run it by hand (see §1). |

**Escape hatches**, both environment variables read at the top of the hook:

- `CLAUDE_SKIP_GUARD=1` — skips guard.mjs entirely. Legitimate for a
  human-driven exception the guard has no way to tell apart from the thing it
  exists to stop — e.g. you are intentionally hand-editing `.env` yourself
  outside the agent, or a deliberate corrective force-push you've reviewed.
  Not legitimate as a way to get an agent past a rule it's about to break.
- `CLAUDE_SKIP_VERIFY=1` — skips verify.mjs. Legitimate when you want an agent
  to stop mid-work to report back or ask a question without a failing
  `pnpm test` run blocking that response — e.g. mid-refactor across several
  files. Not legitimate as a way to declare a task DONE while lint, typecheck,
  or tests are red; CLAUDE.md's definition of DONE still requires all three to
  pass before the work is considered finished.

Both hooks are Node scripts with no dependencies beyond what's already
installed, so they run the same way in CI as they do locally.
