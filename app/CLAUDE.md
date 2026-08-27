@AGENTS.md

# app

Stack, workflow, conventions, and the Never list are inherited from
`~/.claude/CLAUDE.md`. Only project-specific facts belong here.

## What this is

**An AI tutor app.** A student uploads a photo or PDF of their schoolwork; the
app reads it, generates similar practice, tutors them through it in chat,
explains with interactive whiteboard lessons narrated by a chosen voice, and
adapts to that student over time.

## Where the build is (2026-08-27)

**3 of 8 milestones built. 544 tests. All gates green and stable.**

A parent can sign up, read the §312.4 notice, give verified consent, add a
student, upload a worksheet, see its problems extracted and correctable, and
generate graded practice from them. The retention jobs enforce what
`/retention` publishes.

| | |
|---|---|
| **M0** accounts, consent, deletion | done, reviewed — 52 criteria |
| **M1** upload, extraction | done, reviewed — 36 criteria |
| **M2** practice, grading, mastery | built, **reviewed** 2026-08-27 — 27 criteria |
| **subject coverage** | fixed 2026-08-27 — math, ELA, reading, writing, science, social studies, history all generate practice |
| **M2.5** checkpoints (quizzes) | spec, plan, ADRs 0017/0018. **Slice 1 built** 2026-08-27 (migration, CHECK constraint, config, shared DTO). Slices 2, 4-7 open. |
| **M3–M7** | specs written, architecture in `docs/plans/m2-m7-implementation.md`, ADRs 0009–0015. Not built. |
| **M8** spoken language | spec written 2026-08-27. Two BLOCKING open questions before architecture. Not built. |

### Start here, in this order

1. **M2 is reviewed** (2026-08-27). Three findings, all fixed: an uncapped
   attempts route that could buy Anthropic calls in a loop (21b72f9), two
   prompts that let a student address the grader marking them (dcd8f7d), and
   the retry route missing the Owner+ACTIVE consent gate every other M2
   mutation had — it could generate new practice for a profile whose parent had
   withdrawn consent, and it had no test file at all, which is why nobody
   noticed.

   Verified clean, so nobody re-derives it: ownership scoping on every DAL
   helper (no IDOR); `withAuth`'s boot-time throw that kills the previous
   fail-open class; answer-key separation end-to-end — DAL select, the
   `revealed` gate in `lib/practice/dto.ts`, and the practice page mapping
   through DTOs before anything crosses to a client component; the mastery
   ratchet's guarded `updateMany`, whose one race under-counts rather than
   inflates; and `mastery-strip`, which renders no percentage, score, streak or
   `n/m` fraction. The carried-forward worry about `mastery-strip` on the
   student page was unfounded.

   `MASTERY_MIN_ATTEMPTS_FOR_REPORT` now exists in `lib/config.ts` but nothing
   reads it. **Whoever builds M7 must wire it in.**

2. **Finish M2.5.** Slices 1-5 of
   [docs/plans/m2-5-checkpoints-implementation.md](docs/plans/m2-5-checkpoints-implementation.md)
   §6 are done and the backend is complete: schema and CHECK constraint,
   composition, generation, both routes, and the two behavioural deltas. Slice 3
   needed no work — the shared DTO change landed inside slice 1.

   **Slice 6 (frontend) is next.** Its acceptance test is the one that matters
   in this milestone: no child-facing payload may contain a value lower than one
   previously rendered (spec AC 13). **Slice 7** — the `ExtractedProblem.language`
   column from ADR-0016 — is independent of everything else and can go any time;
   the schema is already migrated, so it is prompt and validation work only.

   Slice 5 was planned as one unit and shipped as 5a/5b/5c. Seven files with
   three unrelated concerns is the mis-scoping retro lesson 10 is about.

3. **Then M3** (chat tutor). Its contract is fixed in the M2–M7 plan.
   M4–M7 are shape-only until the measurements in that plan's §9 are taken.

### This app is not a math app

Confirmed by the owner on 2026-08-27: the tutor covers **math, reading, language
arts, social studies, science** and, eventually, foreign languages. Math is the
first example, never the scope.

It very nearly shipped as a math app by accident. `GRADABLE_SUBJECTS` was hand
written in `lib/config.ts` as `['MATH', 'SCIENCE']` while the bundled taxonomy
carried math and ELA and **no science at all** — so science worksheets passed the
gradability filter and died as `SLATE_EMPTY`, and ELA's 18 usable skills were
filtered out one step earlier. Only math worked. Every one of the 501 tests that
passed over this used math.

The fix is structural, not a corrected constant. `lib/taxonomy/skills-k8.json`
now bundles four frameworks (CCSS math + ELA, NGSS science, C3 social studies),
`SUBJECT_FAMILY` maps the finer-grained `Subject` enum onto them so `READING`,
`WRITING` and `HISTORY` reach the right skills, and **`GRADABLE_SUBJECTS` is
derived from that coverage** — a subject cannot be declared gradable unless
skills for it exist. See ADR-0009's 2026-08-27 revision note.

`FOREIGN_LANGUAGE` is still uncovered and is the known gap against the promise:
ACTFL is organised by proficiency rather than grade, so bundling it means
deciding a mapping ACTFL does not publish. It needs its own ADR (proposed
**ADR-0016**) before any JSON is written. A test asserts it is non-gradable so
that adding it has to be deliberate.

**Speaking is in scope, and it is not a taxonomy entry.** Confirmed by the owner
on 2026-08-27: the tutor should help a child practise *speaking* a foreign
language, not only reading and writing it. Nothing in M0–M7 can hear — M3
excludes voice by name, M5 is the app talking, M6 records a consenting adult —
so this is a real capability gap, specced as **M8**
([docs/specs/m8-spoken-language.md](docs/specs/m8-spoken-language.md)) and
sequenced after M6 so it inherits M6's consent-gated audio capture.

Two of M8's open questions are **blocking** and no architecture may start until
they are answered: whether the chosen ASR vendor's terms permit audio from
children under 13, and whether its retention can be contractually disabled. A
child's voice is personal information under COPPA. The FTC tolerates audio
collected as a substitute for text and deleted immediately, which is narrower
than pronunciation feedback needs — so M8 stands on a separate, independently
withdrawable voice consent rather than on that allowance. **Never build a
voiceprint of a child**; that is the milestone's brightest line.

Do the written foreign-language track first. It proves the subject through
machinery that already exists, and speaking then has somewhere to attach.

**Before shipping anything subject-specific, ask whether it works for an essay
and a history question, not just an equation.**

### Known gaps, carried forward

- **A student cannot report a bad question.** No endpoint, no control. Extraction
  accuracy is unmeasured and generation quality unproven; a child saying "this
  makes no sense" is the fastest signal available, and there is nowhere to put
  it.
- **There is no child/parent separation in auth** — M0 deliberately has no
  student login. So "a child never sees a score that can fall" is enforced by
  which screen renders what, not by permissions. `mastery-strip` currently
  renders on the student page.
- **`renderMathText` exists twice**, identically, in `components/uploads/` and
  `lib/math/`. Delete one once both tracks are stable.
- Review findings left unfixed, deliberately batched rather than one commit
  each: the generation hourly cap is per student profile, not per account (an
  account with five profiles gets five times the spend); `resolveSkill(...)
  ?.subject ?? "MATH"` and `gradeLevel ?? "GRADE_4"` in the attempts route
  silently feed the grader wrong context if a skill code ever leaves the
  taxonomy (unreachable today — all 76 pre-2026-08-27 codes survive in the
  128-skill bundle — but `TAXONOMY_VERSION` bumping is exactly what makes it
  reachable); and the reveal route returns 200 with empty strings when an
  answer key is missing, masking an invariant violation as success.

### The one thing that is not verified

**No worksheet has ever been put in front of the model.** Every extraction test
mocks it. `ANTHROPIC_API_KEY` is unset. Two milestones now stand on an
assumption nobody has tested, and M2's grading plus M7's parent report stack on
top of it. Setting that key and running one real extraction is the highest-value
hour available in this project.

Storage runs on a local filesystem adapter (`STORAGE_DRIVER=local`); the Vercel
Blob implementation is unbuilt and its placeholder throws.

Start at [docs/README.md](docs/README.md); read
[docs/retros/m0-m1.md](docs/retros/m0-m1.md) before running the pipeline.

Because the app tutors minors, anything touching student data carries **COPPA**
consent and retention obligations. Treat uploaded schoolwork as sensitive
personal data about a child, not as an ordinary file.

FERPA does **not** apply to the current direct-to-consumer design and will not
until a school contracts with us and exercises direct control over the records.
Overstating it obscures the obligations that are real — see
[docs/research/coppa-childrens-privacy.md](docs/research/coppa-childrens-privacy.md).

## Databases

- **Local (development):** `prisma dev`, server named `app`. `DATABASE_URL` in
  `.env` points at it. **First time on a machine**, the instance does not exist
  yet and `prisma dev start app` prints "No prisma dev servers found to start"
  and does nothing — create it with `pnpm exec prisma dev --name app --detach`.
  After that it exists and stays; if the app cannot reach the database, it is
  simply stopped — run `pnpm exec prisma dev start app`. See runbook §1.
- **Cloud (deployment):** Neon. The connection string lives in `.env.neon`,
  which is gitignored and deliberately separate so day-to-day work can never
  run against production.
- Apply migrations to Neon with `pnpm db:migrate:prod`. `scripts/prisma-prod.mjs`
  refuses `migrate dev` against the cloud — that command can drop the database.
- **`pnpm db:migrate` does not work as written, and the failure is misleading.**
  It dies with `type "GradeLevel" already exists`, naming migration 0001, which
  reads like a corrupt migration history. The real database is fine —
  `prisma migrate status` says "up to date" throughout. The failure is in the
  SHADOW database Prisma builds to diff the schema: `DATABASE_URL` points at
  `template1`, which Postgres uses as the template for every newly created
  database, so the shadow is born carrying the whole existing schema and then
  replaying migration 0001 collides with itself. `SHADOW_DATABASE_URL` in `.env`
  is an empty string, so nothing redirects it.

  `prisma dev` already publishes a dedicated shadow server one port up from the
  main one. Until `.env` is fixed — the guard hook blocks writing to it, so a
  human has to — pass it per command:

  ```
  SHADOW_DATABASE_URL="postgres://postgres:postgres@localhost:51215/template1?sslmode=disable" \
    pnpm exec prisma migrate dev --create-only --name <name>
  ```

  Two more things that cost time on 2026-08-27: `prisma migrate dev` HUNG after
  successfully applying the migration and had to be killed, leaving the client
  ungenerated — if tests suddenly fail with Prisma *validation* errors on a
  column you just added, run `pnpm exec prisma generate`. And to hand-edit a
  migration (ADR-0017 needs a CHECK constraint Prisma cannot express), create it
  with `--create-only`, edit, then apply — the guard rightly blocks editing a
  migration that has already run.

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

Never `git add` a directory. Stage explicit file paths instead — the guard hook
now blocks directories, `.` and `-A` outright.

A broad `git add app/docs` in commit `0cb4c99` swept up an architect agent's
in-flight ADR work and committed it under an unrelated message about product
research. Nothing was lost, but the history now attributes ADR-0008 and three
ADR revisions to a commit that claims to be about something else — and a commit
message that lies is worse than no commit message.

It then happened a second time, in `fbc0821`, *after* this rule was written
here — a frontend commit swallowed the backend track's half-written consent
routes. Writing a rule down is not enforcement. It is now a check in
`guard.mjs`, which is where a rule belongs once it has been broken twice.

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
