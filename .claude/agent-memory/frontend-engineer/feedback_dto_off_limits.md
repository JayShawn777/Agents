---
name: feedback-dto-off-limits
description: When lib/schemas/* is listed as off-limits for a task, type a route handler's response locally next to its one consumer instead of adding it to lib/schemas/dto.ts.
metadata:
  type: feedback
---

Some task briefs in this repo grant frontend-engineer a route (e.g. an
already-built `/api/account/closure`) but explicitly forbid editing
`lib/schemas/*` for that task, even though `lib/schemas/dto.ts` is where
shared response envelopes normally live (see the "response envelopes"
section of that file) and the project rule is "type API responses from
shared types, never redeclare a shape inline."

**Why:** `lib/schemas/*` holds the fixed API contract both tracks read
from; a task that scopes frontend-engineer away from it is protecting that
contract from a one-off addition made under time pressure by the track
that doesn't own it, not asking the type to go undeclared.

**How to apply:** when a response shape isn't already exported from
`lib/schemas/dto.ts` and that file is off-limits, declare a small local
type in the one client component that calls the endpoint (e.g.
`AccountClosureResult` in `components/settings/close-account-dialog.tsx`,
typing `POST /api/account/closure`'s `{ closureRequestedAt, purgeAfter,
recoveryWindowDays }`), with a comment explaining why it isn't in
`dto.ts`. This satisfies "no inline redeclaration" in spirit (one
definition, not duplicated per call site) without touching the
off-limits file. Don't ask to add it to `dto.ts` unless the task explicitly
reopens that file — treat the constraint as intentional scoping, not an
oversight, per [[frontend-parallel-track-workflow]].
