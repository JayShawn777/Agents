---
name: new-feature
description: Full feature pipeline — spec, architecture, MANDATORY approval stop, parallel implementation, QA, code review, security review, docs, conventional commit. Use when the user says "new feature:", "add feature", "build me", or describes new functionality to build.
---

# New Feature Pipeline

Runs a feature from request to commit through the agent chain in CLAUDE.md.
Execute the phases IN ORDER. Do not skip, merge, or reorder them.

## Phase 0 — Plan mode

Enter plan mode before anything else. Restate the request in one sentence. If it
is trivial (a typo, a copy tweak, a one-line fix), say so and exit this skill —
the full pipeline is for non-trivial work.

## Phase 1 — Spec

Delegate to the **product-spec** agent. Pass the user's request verbatim.

It writes `docs/specs/<slug>.md`. If it returns blocking open questions, ask the
user now — do not guess your way into Phase 2.

## Phase 2 — Research (conditional)

If the feature involves a library not already in `package.json`, or an installed
one whose current usage you cannot find, delegate to the **researcher** agent
FIRST. Skip this phase otherwise, and say that you skipped it.

## Phase 3 — Architecture

Delegate to the **architect** agent. Pass the spec path.

It returns the data model, the **fixed API contract**, the component tree, and the
file-by-file implementation order, and writes any ADRs. The API contract is what
makes Phase 5 parallel-safe — if it is vague, send it back before continuing.

## Phase 4 — STOP FOR APPROVAL 🛑

**MANDATORY. This gate is never skipped, never assumed, and never self-approved.**

Present to the user:
- The spec summary and its acceptance criteria
- The architecture: data model, API contract, component tree, implementation order
- Any migration that destroys data
- Any new dependency (CLAUDE.md forbids adding one without approval)
- The open risks

Then STOP and wait for an explicit approval message.

- Silence is not approval. A question is not approval. "Looks good" IS approval.
- If the user requests changes, revise via the architect and present again.
- Do not write a single line of application code before approval lands.

## Phase 5 — Parallel implementation

Only after approval. Launch **backend-engineer** and **frontend-engineer** as
subagents **in a single message so they run concurrently**.

Give each: the spec path, the architecture plan, the fixed API contract, and its
own file scope. The scopes must not overlap — backend owns `app/api/**`, server
actions, and Prisma; frontend owns pages, `components/**`, and styling.

If the architect flagged shared/blocking work (types, schema, migration), do that
FIRST in the main thread, then fan out.

If either agent reports BLOCKED or a deviation from the plan, stop and resolve it
before Phase 6.

## Phase 6 — QA

Delegate to the **qa-tester** agent with the spec path. It writes and runs Vitest
and Playwright tests for every acceptance criterion.

On FAIL: route each failure back to the owning engineer agent, then re-run QA.
Loop until green. Never accept a green suite that was made green by weakening a
test — CLAUDE.md forbids it and so does the agent.

## Phase 7 — Code review

Delegate to the **code-reviewer** agent. Fix every BLOCKER and MAJOR via the
owning engineer agent, then re-review. MINOR and NIT are the user's call.

## Phase 8 — Security review

Delegate to the **security-reviewer** agent. Every CRITICAL and HIGH must be fixed
and re-verified. A CRITICAL finding blocks the commit outright.

## Phase 9 — Docs

Delegate to the **docs-writer** agent. It updates the README, `docs/api.md`, the
changelog, and the runbook to match what was actually built.

## Phase 10 — Verify and commit

Run all four gates yourself. Do not delegate this, and do not trust an earlier
agent's claim that they passed:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e
```

All four must pass. Then commit with a conventional message (see the
`commit-and-pr` skill):

```
feat(<scope>): <imperative summary>

<what changed and why>

Spec: docs/specs/<slug>.md
ADR: docs/adr/<file>.md
```

Do not push and do not open a PR unless the user asks.

## Final report

```
## Feature complete: <name>

Spec: docs/specs/<slug>.md    ADR: docs/adr/<file>.md
Files: <n> changed
Tests: <n> unit, <n> e2e — all passing
Review: <n> blockers fixed    Security: <n> critical fixed
Commit: <sha> <message>

Deferred: <MINOR/NIT findings left, or "None">
```
