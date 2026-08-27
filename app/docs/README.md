# Knowledge base

Everything written down about this project lives here. The goal is that someone
returning to this repo in a year can reconstruct not just *what* was built but
*why* — without reading a chat transcript.

## Where things go

| Folder | Holds | Written by | Naming |
|---|---|---|---|
| `specs/` | What we are building and how we will know it works | product-spec agent | `<feature-slug>.md` |
| `adr/` | Why we chose one technical approach over another | architect agent | `NNNN-<decision-slug>.md` |
| `research/` | What we learned about an external library or API | researcher agent | `<topic-slug>.md` |
| `plans/` | How a milestone gets built — schema, API contract, file order | architect agent | `<milestone-slug>.md` |
| `retros/` | What the pipeline got wrong in a milestone, and what changed | the coordinator | `<milestone>.md` |
| `runbook.md` | How to run, migrate, and deploy the thing | docs-writer agent | single file |
| `security-program.md` | §312.8 written information security program and vendor assessment | **owner — not yet written; M0 AC 51/52** | single file |

`specs/`, `adr/`, and `research/` each have a `TEMPLATE.md`. Copy it — do not
invent a new shape. Consistent structure is what makes these greppable and
skimmable later.

The distinction between `adr/` and `plans/` matters: an ADR records *why* one
approach beat the alternatives and is immutable once accepted; a plan records
*how* a milestone gets built and is expected to go stale the moment the code
lands. Do not put a decision in a plan — it will be lost when the plan is.

## The rules

1. **One file per subject.** One spec per feature, one ADR per decision, one
   research file per topic. Never append a second feature to an existing spec.
2. **Date everything.** Every document carries an absolute date in its header.
   "Last week" is meaningless to a future reader.
3. **ADRs are immutable once Accepted.** Supersede them with a new ADR; never
   edit a decision to match what actually happened. The wrong turn is the
   valuable part. See ADR-0001. A **Proposed** ADR may be revised in place, but
   only with a dated revision note saying what changed and why — see ADR-0007.
4. **Record rejected options.** An ADR without an "Alternatives considered"
   section is a note, not a decision — and the rejected option gets retried.
5. **Research must cite sources.** A finding with no URL cannot be re-verified
   when the library changes. Say plainly what you could not confirm.
6. **Write it down when it is decided,** not at the end. A decision that lives
   only in a session transcript is gone when the session ends.
7. **One number, one home.** A retention window, a size cap or a timeout written
   into two documents will drift. M0 owns every retention window; M1 points at
   it. `lib/config.ts` owns every value in code.

## Reading order for a new contributor

1. `~/.claude/CLAUDE.md` — the project constitution (stack, workflow, Never list)
2. `CLAUDE.md` at the repo root — project-specific quirks
3. `docs/runbook.md` — how to actually run it
4. `docs/adr/` in numeric order — how it came to look like this
5. `docs/specs/` — what each feature is supposed to do

Anyone touching the consent, notice, retention or deletion paths should read
`research/coppa-childrens-privacy.md` **first**, then ADR-0007 and ADR-0008.
The ordering of that flow — age gate, then notice, then consent, then anything
about the child — is load-bearing and looks wrong until you know why.

## Index

Keep this current. A knowledge base nobody can navigate is a folder of files.

### Specs
- [m0-accounts-and-profiles.md](specs/m0-accounts-and-profiles.md) — Accounts, student profiles, parental consent, storage plumbing (Draft, revised 2026-08-26, 52 AC)
- [m1-upload-and-extract.md](specs/m1-upload-and-extract.md) — Upload schoolwork and extract its problems (Draft, revised 2026-08-26 — retention and profile status now point at M0; no AC renumbered)

### ADRs
- [ADR-0001](adr/0001-record-architecture-decisions.md) — Record architecture decisions (Accepted)
- [ADR-0002](adr/0002-passwordless-auth-with-authjs-and-database-sessions.md) — Passwordless email sign-in with Auth.js v5 and database sessions (Proposed)
- [ADR-0003](adr/0003-private-vercel-blob-with-client-direct-upload.md) — Private Vercel Blob store with client-direct upload behind a storage port (Proposed)
- [ADR-0004](adr/0004-client-side-heic-conversion-with-lazy-loaded-heic-to.md) — Convert HEIC to JPEG in the browser, with a lazily loaded `heic-to` (Proposed)
- [ADR-0005](adr/0005-extracted-problem-model-and-structured-output-contract.md) — Extracted problems are a zod-validated structured output storing LaTeX (Proposed)
- [ADR-0006](adr/0006-route-handlers-for-mutations-not-server-actions.md) — All mutations are route handlers; server actions are used only for Auth.js (Proposed)
- [ADR-0007](adr/0007-deletion-order-append-only-consent-and-store-enumerating-reconciliation.md) — Blob-first deletion, append-only consent, and a store-enumerating reconciler (Proposed)
- [ADR-0008](adr/0008-swappable-verifiable-parental-consent-method.md) — Verifiable parental consent is a swappable, recorded method behind one interface (Proposed)
- [ADR-0009](adr/0009-bundled-common-core-taxonomy-with-closed-slate-skill-selection.md) — A bundled Common Core subset, and the model picks from a closed slate (Proposed)
- [ADR-0010](adr/0010-mastery-as-a-monotonic-ratchet-over-per-skill-counters.md) — Mastery is a monotonic ratchet over per-skill counters, and review scheduling is a separate axis (Proposed)
- [ADR-0011](adr/0011-two-stage-answer-grading-with-server-only-answer-keys.md) — Grade with a deterministic normaliser first and the model second, and keep answer keys in their own table (Proposed)
- [ADR-0012](adr/0012-bounded-chat-sessions-with-a-snapshotted-learner-context.md) — Chat sessions are bounded at open, and the learner context is snapshotted onto the session row (Proposed)
- [ADR-0013](adr/0013-ndjson-chat-streaming-with-client-supplied-turn-keys.md) — Chat streams as NDJSON from a route handler, and a turn is idempotent on a client-supplied key (Proposed)
- [ADR-0014](adr/0014-lessonscript-as-one-versioned-validated-json-document.md) — A LessonScript is one validated JSON document on a version row, over a closed primitive vocabulary and a normalised canvas (Proposed)
- [ADR-0015](adr/0015-per-profile-narration-cache-instead-of-a-global-content-address.md) — Narration audio is cached per student profile, not globally content-addressed (Proposed)

### Plans
- [m0-m1-implementation.md](plans/m0-m1-implementation.md) — Schema, API contract, component tree, build order, and the storage spike
- [m2-m7-implementation.md](plans/m2-m7-implementation.md) — Schema for all six remaining milestones; full contract for M2-M3, shape only beyond (revised 2026-08-26 against the 52-AC M0 spec)

### Retros
- [m0-m3.md](retros/m0-m3.md) — Nineteen lessons across M0-M3, and what changed because of each. A running document: each milestone's retro is appended and the file is renamed.

### Research
- [anthropic-api.md](research/anthropic-api.md) — Claude API: vision, PDF, structured output, streaming, caching, pricing
- [file-upload-storage.md](research/file-upload-storage.md) — Where uploaded schoolwork lives; why client-direct upload is mandatory
- [vercel-blob-verified.md](research/vercel-blob-verified.md) — **Supersedes the storage signatures above**, read from the installed types
- [elevenlabs-tts.md](research/elevenlabs-tts.md) — Narration, character-level timing data, and consent-gated voice cloning
- [coppa-childrens-privacy.md](research/coppa-childrens-privacy.md) — **Verifiable parental consent, retention, and BIPA.** Read before touching the consent flow
- [coppa-312-5-primary-text.md](research/coppa-312-5-primary-text.md) — **The nine consent methods, quoted from the regulation.** The only fetched-primary-source file we have on this
- [vpc-verification-vendors.md](research/vpc-verification-vendors.md) — Paid identity vendors, BIPA exposure, and why a vendor avoids billing. Its subsection lettering is inferred, not read — confirm against eCFR before relying on it
- [tutoring-product-patterns.md](research/tutoring-product-patterns.md) — What the category does, which patterns to adopt, and which to deliberately reject
- [agentic-architecture.md](research/agentic-architecture.md) — How our own agent pipeline should be built; loop design, verification, and what not to adopt
- [claude-code-harness.md](research/claude-code-harness.md) — Hooks, subagent frontmatter, and which native features we were not using
