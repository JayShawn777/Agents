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
| `runbook.md` | How to run, migrate, and deploy the thing | docs-writer agent | single file |

Each folder has a `TEMPLATE.md`. Copy it — do not invent a new shape. Consistent
structure is what makes these greppable and skimmable later.

## The rules

1. **One file per subject.** One spec per feature, one ADR per decision, one
   research file per topic. Never append a second feature to an existing spec.
2. **Date everything.** Every document carries an absolute date in its header.
   "Last week" is meaningless to a future reader.
3. **ADRs are immutable once Accepted.** Supersede them with a new ADR; never
   edit a decision to match what actually happened. The wrong turn is the
   valuable part. See ADR-0001.
4. **Record rejected options.** An ADR without an "Alternatives considered"
   section is a note, not a decision — and the rejected option gets retried.
5. **Research must cite sources.** A finding with no URL cannot be re-verified
   when the library changes. Say plainly what you could not confirm.
6. **Write it down when it is decided,** not at the end. A decision that lives
   only in a session transcript is gone when the session ends.

## Reading order for a new contributor

1. `~/.claude/CLAUDE.md` — the project constitution (stack, workflow, Never list)
2. `CLAUDE.md` at the repo root — project-specific quirks
3. `docs/runbook.md` — how to actually run it
4. `docs/adr/` in numeric order — how it came to look like this
5. `docs/specs/` — what each feature is supposed to do

## Index

Keep this current. A knowledge base nobody can navigate is a folder of files.

### Specs
_None yet._

### ADRs
- [ADR-0001](adr/0001-record-architecture-decisions.md) — Record architecture decisions (Accepted)

### Research
- [anthropic-api.md](research/anthropic-api.md) — Claude API: vision, PDF, structured output, streaming, caching, pricing
- [file-upload-storage.md](research/file-upload-storage.md) — Where uploaded schoolwork lives; why client-direct upload is mandatory
