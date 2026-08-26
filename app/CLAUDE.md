@AGENTS.md

# app

Stack, workflow, conventions, and the Never list are inherited from
`~/.claude/CLAUDE.md`. Only project-specific facts belong here.

## What this is

**An AI tutor app.** A student uploads a photo or PDF of their schoolwork; the
app reads it, generates similar practice, tutors them through it in chat,
explains with interactive whiteboard lessons narrated by a chosen voice, and
adapts to that student over time.

No features have been built yet — `app/page.tsx` is still the starter page.
Planning and research live in `docs/`; start at [docs/README.md](docs/README.md).

Because the app tutors minors, anything touching student data carries
COPPA/FERPA consent and retention obligations. Treat uploaded schoolwork as
sensitive personal data about a child, not as an ordinary file.

## Databases

- **Local (development):** `prisma dev`, server named `app`. `DATABASE_URL` in
  `.env` points at it. If the app cannot reach the database, it is simply
  stopped — run `pnpm exec prisma dev start app`.
- **Cloud (deployment):** Neon. The connection string lives in `.env.neon`,
  which is gitignored and deliberately separate so day-to-day work can never
  run against production.
- Apply migrations to Neon with `pnpm db:migrate:prod`. `scripts/prisma-prod.mjs`
  refuses `migrate dev` against the cloud — that command can drop the database.

## Project-specific quirks

- `postinstall` runs `prisma generate`. Do NOT remove it and do NOT override the
  build command in Vercel — the generated client is gitignored, so the build must
  recreate it, and Vercel's Install and Build fields are easy to confuse.
- `prebuild` clears `.next`. A stale `.next` makes Turbopack die on Windows with
  exit 3221225477.
- `typecheck` runs `next typegen` first; the route types are gitignored.

## Deployment

Pushing to `main` deploys to Vercel automatically. Migrations do not run on
deploy — apply them with `pnpm db:migrate:prod`.

## Documentation

`docs/README.md` is the map: specs, ADRs, research, and the runbook, with the
naming and immutability rules for each. Read the relevant doc before starting;
write the decision down when it is made, not at the end.

## Agents and skills

The nine pipeline agents live in `.claude/agents/`, and the `new-feature` /
`commit-and-pr` skills in `.claude/skills/`. They are **owned by this repository**,
which supersedes commit `7a00c41` (which had moved them to `~/.claude` so shared
fixes would propagate).

The reason for moving them back: these definitions are meant to improve after
every milestone. Untracked files have no history, no review, and no rollback,
and they do not survive a fresh Codespace — so every lesson learned would be
written somewhere git never sees. Project copies shadow the user-level ones, so
this project now pins its own; improvements to the shared `~/.claude` set no
longer flow in automatically, and that is the accepted trade.

### Retro cadence

At the end of each milestone — when the chunk is shipped and working, roughly
every one to two weeks — run a retro before starting the next one:

1. Review what the agents actually got wrong. Where was a spec ambiguous? What
   did the reviewers miss that QA caught, or that nobody caught? Where did an
   agent need correcting mid-run?
2. Write those lessons into the agent definitions in `.claude/agents/`, the
   skills in `.claude/skills/`, or this file — whichever is the right home.
3. Commit the changes separately from feature work, with the commit message
   naming the incident that motivated each edit.

Only act on repeated patterns. A one-off mistake is not evidence, and rewriting
an agent's instructions after every stumble makes them worse, not better.

Agents do not learn between runs — every run starts blank. These files ARE the
memory, which is why they are version-controlled and why the retro is a real
step rather than a good intention.

Each agent carries an explicit `model:` field. Deciding roles (architect,
product-spec) and verifying roles (code-reviewer, security-reviewer) run on
Opus; executing roles that build against an already-fixed contract
(backend-engineer, frontend-engineer, qa-tester, researcher, docs-writer) run on
Sonnet. Cheap generation, expensive verification. Do not change a model field
without saying why in the commit message.

## Available reference skills

`.claude/skills/prisma-*` are vendored Prisma 7 references (full copies, kept in
sync with `.agents/skills/` — despite earlier notes, they are duplicated
directories, not symlinks). Prisma 7 has breaking changes from earlier versions
— consult them rather than relying on memory.
