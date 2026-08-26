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

Because the app tutors minors, anything touching student data carries **COPPA**
consent and retention obligations. Treat uploaded schoolwork as sensitive
personal data about a child, not as an ordinary file.

FERPA does **not** apply to the current direct-to-consumer design and will not
until a school contracts with us and exercises direct control over the records.
Overstating it obscures the obligations that are real — see
[docs/research/coppa-childrens-privacy.md](docs/research/coppa-childrens-privacy.md).

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

The nine pipeline agents live in **`/workspaces/Agents/.claude/agents/`** — the
repository root, NOT `app/.claude/agents/`. Subagent definitions are discovered
only at the project root; a `.claude/agents/` directory inside a subdirectory is
silently ignored. They were briefly kept under `app/` and every change made
there — tool grants, effort, memory, turn limits — was inert while appearing to
be applied. Skills do not share this limitation: `app/.claude/skills/` is
discovered and scoped to files under `app/`.

They are **owned by this repository**,
which supersedes commit `7a00c41` (which had moved them to `~/.claude` so shared
fixes would propagate).

The reason for moving them back: these definitions are meant to improve after
every milestone. Untracked files have no history, no review, and no rollback,
and they do not survive a fresh Codespace — so every lesson learned would be
written somewhere git never sees. Project copies shadow the user-level ones, so
this project now pins its own; improvements to the shared `~/.claude` set no
longer flow in automatically, and that is the accepted trade.

### Staging while agents are running

Never `git add` a directory while a background agent is writing into it. Stage
explicit file paths instead.

A broad `git add app/docs` in commit `0cb4c99` swept up an architect agent's
in-flight ADR work and committed it under an unrelated message about product
research. Nothing was lost, but the history now attributes ADR-0008 and three
ADR revisions to a commit that claims to be about something else — and a commit
message that lies is worse than no commit message.

### Enforced rules vs. advisory ones

`.claude/hooks/guard.mjs` runs on `PreToolUse` and **blocks** — it does not warn:

- editing anything under `prisma/migrations/` (an applied migration has already
  run; correct it with a new migration)
- writing to `.env` (`.env.example` is allowed)
- `git push --force` (`--force-with-lease` passes)
- `npm` / `yarn` install commands
- `prisma migrate dev` aimed at the cloud database

These were previously prose in the Never list, which an agent could break by not
reading carefully. Prefer moving a rule into the guard over restating it: three
enforced rules beat thirty advisory ones. `CLAUDE_SKIP_GUARD=1` is the escape
hatch for deliberate, human-driven exceptions.

`.claude/hooks/verify.mjs` runs `lint` and `typecheck` on `Stop` and
`SubagentStop` — when an agent claims to be finished — rather than after every
edit. Per-edit verification ran the full typecheck dozens of times per feature
for no extra signal.

### The parallel implementation split is deliberate

`frontend-engineer` and `backend-engineer` run in parallel against a fixed API
contract. This was challenged on 2026-08-26 and **reaffirmed by the owner**.

The counter-argument, recorded so it is not re-litigated: current practice
(Cognition, April 2026) argues writes should stay single-threaded and that extra
agents should contribute intelligence rather than actions, because concurrent
writers drift from each other in ways the contract does not catch. The
`docs/research/agentic-architecture.md` file makes this case in full.

We are keeping the split. The contract is fixed by the architect before either
engineer starts, shared files land in a prior phase, and the two tracks touch
disjoint files by design. If drift shows up in practice — two engineers
disagreeing about a type that the contract did not pin down — that is the signal
to revisit, and it belongs in a milestone retro rather than a fresh argument.

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

Agents carry a `memory: project` store between runs, so they are no longer
strictly blank each time. That memory is theirs and is narrow; the documents in
`docs/` remain the shared, reviewable record, which is why they are
version-controlled and why the retro is a real step rather than a good
intention.

A copy is mirrored into `~/.claude/agents/` so edits take effect in a running
session. The repository copy is canonical; refresh the mirror after changing it,
and expect a session restart to be needed otherwise.

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
