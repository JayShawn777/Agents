@AGENTS.md

# app

Stack, workflow, conventions, and the Never list are inherited from
`~/.claude/CLAUDE.md`. Only project-specific facts belong here.

## What this is

**An AI tutor app.** A student uploads a photo or PDF of their schoolwork; the
app reads it, generates similar practice, tutors them through it in chat,
explains with interactive whiteboard lessons narrated by a chosen voice, and
adapts to that student over time.

## Where the build is (2026-08-28)

**M0, M1, M2 and M2.5 built. M3 half built. 655 tests, 2 live tests skipped by
default. All gates green and stable.**

**The vision path is verified.** On 2026-08-28 a real worksheet went to the real
model for the first time: 35 of 35 problems, every addend pair correct, labels
in order, 0.97 confidence. See `tests/unit/live/`.

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
| **M2.5** checkpoints (quizzes) | **done and reviewed** 2026-08-27 — all 7 slices, spec, plan, ADRs 0016/0017/0018 |
| **M3** chat tutor | **slices 1-3 + the system prompt built** 2026-08-28 — schema and binding CHECK, the CHAT_TRANSCRIPT retention rule and job, the twelve CHAT_* tunables, ADR-0012's context renderer, and TUTOR_SYSTEM_PROMPT. **Nothing writes a chat row yet** — the streaming route is next. |
| **M4–M7** | specs written, architecture in `docs/plans/m2-m7-implementation.md`, ADRs 0009–0015. Not built. |
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

2. **M2.5 is reviewed** (2026-08-27). Two findings, both fixed.

   The one worth remembering: **checkpoints were appearing in the student
   page's "Practice" list**, because that query filtered by profile and not by
   `kind`. Mislabelling was the small half. The real problem was that every
   COMPLETE checkpoint became one click from every other, which is a browsable
   score history — spec AC 13 forbids showing a value lower than one previously
   rendered, and two old results a click apart is that, assembled by hand
   instead of by us. The list now filters `kind: "PRACTICE"` IN THE QUERY, so
   it is structurally impossible rather than remembered, and an unfinished
   check-in is resumable from the Check-in section while a finished one is not
   re-openable from there.

   The second: ADR-0017 claims "checkpoints are removed only when the student
   profile is". The half that an extraction delete cannot reach one was tested;
   the half that profile deletion DOES reach one was not. A checkpoint has no
   `extractionId`, so any deletion path walking uploads and extractions misses
   it by construction — it now has an integration test asserting the set, its
   problems, its answer keys and its attempts are all gone.

   Verified clean: the CHECK constraint is live in the database (proven by the
   integration tests, not just present in the migration file), `lib/practice/
   finalize.ts` is the only writer of `PracticeAnswerKey` for both generators,
   both new routes carry ownership scoping and the create route the ACTIVE
   gate, and `CheckpointResult` is handed one summary with no history so a
   comparison is unreachable rather than merely absent.

3. **The credentials work, and one detail cost time.** `ANTHROPIC_API_KEY` is
   set (2026-08-28). It is an **identity-linked key**, which the API rejects
   with a **400, not a 401** — `anthropic-workspace-id is required when
   authenticating with an identity-linked API key` — so `ANTHROPIC_WORKSPACE_ID`
   is also set and `lib/ai/client.ts` sends it as a default header, but ONLY
   when present, so a classic workspace-scoped key still works. A 400 that reads
   like a malformed body but is really an auth-shape problem is worth
   recognising on sight.

   **`RUN_LIVE_AI=1` is the convention for tests that need the real API**
   (ADR-0012 §4). They live in `tests/unit/live/` and skip otherwise, so a
   normal `pnpm test` costs nothing. `.scratch/` is gitignored and holds test
   inputs — currently a copyrighted third-party worksheet, which must stay out
   of the history.

4. **NEXT: M3's streaming route** (plan §3.4's contract, ADR-0013). It is the
   biggest single piece left in the milestone and everything else waits on it:
   NDJSON framing, client-supplied turn keys for idempotency, abort-time partial
   persistence (AC 12 — persist the partial and mark it, or persist nothing;
   one of the two, consistently, never a duplicate turn on reconnect), the
   `stop_reason` handling AC 13 and AC 18 need, and AC 19's idle timeout.

   It is also the first place **§9.1's measurements become takeable** — you
   cannot time a first token without a stream. `CHAT_FIRST_TOKEN_BUDGET_MS`
   (3000) and `CHAT_IDLE_TIMEOUT_MS` (20000) are still guesses and say so in
   their own doc comments.

   Then the UI, **with the entry point as its own named slice**, per the M2.5
   retro.

   Already built for it: `lib/chat/context.ts` (ADR-0012's pure, byte-stable
   renderer plus `hashContext`), `lib/chat/prompt.ts` (`TUTOR_SYSTEM_PROMPT` at
   a measured 1,742 tokens against a 1,024 minimum, `buildProblemContextBlock`,
   `REVEAL_OPERATOR_INSTRUCTION`, `DISTRESS_SAFETY_MESSAGE`), and the twelve
   `CHAT_*` tunables. The request shape they assemble into is ADR-0012 §3.

   Both hand-written CHECK constraints so far live only in migrations and are
   invisible in `schema.prisma`; each has an integration test that is its real
   documentation. The plan's §1.2 SQL for the M3 one was snake_case and would
   not have applied — Prisma generates camelCase.

5. **Two things need the owner, not an engineer.**
   - **`DISTRESS_SAFETY_MESSAGE` (AC 21) is an engineer-written DRAFT.** It is
     what a child in distress actually reads. ADR-0012's follow-up says this
     copy needs someone qualified, and the owner still has to answer **whether
     the account holder is notified when it fires** — notifying has real value
     and real risk, since a child who learns the tutor reports them stops
     telling it anything true.
   - **ADR-0012 is still `Status: Proposed`.** M3's session bounds, the
     snapshotted context and the whole cache design rest on it, and the
     streaming route is about to sit on top.

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

**Foreign language, as of 2026-08-27:** the plumbing is done and inert. The
extraction model reports a language, `lib/extraction/language.ts` keeps it only
for a `FOREIGN_LANGUAGE` problem and only if it is in `SUPPORTED_LANGUAGES` —
which is EMPTY on purpose, so every value resolves to null today. That is the
intended state. Turning it on is a data-only change once ACTFL skills are
bundled, and a test asserts the allowlist is still empty so that populating it
without the taxonomy work cannot pass silently.

The skills themselves are still missing:
ACTFL is organised by proficiency rather than grade, so bundling it means
deciding a mapping ACTFL does not publish.
[ADR-0016](docs/adr/0016-foreign-language-is-proficiency-banded-not-grade-banded.md)
settles how — proficiency-banded, with the anchor derived from existing
`SkillMastery` rows by the caller so `candidateSlate` stays pure — but no ACTFL
JSON is bundled yet. A test asserts the subject is non-gradable so that adding
it has to be deliberate.

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

### What is verified now, and what still is not

**The vision path is verified** (2026-08-28), and this section used to say the
opposite. One real worksheet — a printed Addition Doubles 10-20 sheet, 1159x1500
webp — went to the real model through the production prompt, schema, model and
effort: **35 of 35 problems, every addend pair correct**, labels 1-35 in order
with no gaps or duplicates, 0.97 confidence throughout, zero student answers on
a blank sheet, and the vertical layout preserved as LaTeX rather than flattened.
It read the repeats correctly (three separate 14+14s, 18+18 twice in a row),
which is what catches a model pattern-matching instead of reading. 36 seconds,
4,081 input / 4,391 output tokens.

`tests/unit/live/extraction.live.test.ts` is that run, kept. It imports the
prompt, schema, model and effort from production rather than restating them, so
it cannot drift from what actually runs.

**What that does NOT prove**, and nobody should claim it does:

- Only a clean, high-contrast, printed **math** worksheet. Nothing yet about
  handwriting, an angled phone photo, or a reading passage. The most
  informative next test is a **non-math page** — the "it very nearly shipped as
  a math app" incident came from exactly that blind spot.
- Nothing downstream. `SLATE_EMPTY`, skill resolution, practice generation and
  grading all still stand on their own mocks.
- **A student still cannot report a bad question.** Extraction accuracy is now
  sampled at n=1; generation quality is still unmeasured.

Storage runs on a local filesystem adapter (`STORAGE_DRIVER=local`); the Vercel
Blob implementation is unbuilt and its placeholder throws.

Start at [docs/README.md](docs/README.md); read
[docs/retros/m0-m2.md](docs/retros/m0-m2.md) before running the pipeline —
it now runs through M2.5.

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
