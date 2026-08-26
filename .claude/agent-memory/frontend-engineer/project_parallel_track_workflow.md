---
name: frontend-parallel-track-workflow
description: In this repo, frontend-engineer and backend-engineer build the same milestone concurrently against a fixed API contract in the architect's plan doc — backend files frontend depends on may not exist yet at start, and land mid-session.
metadata:
  type: project
---

Repo: `/workspaces/Agents/app` (a Next.js 16 + Prisma + Auth.js v5 app,
COPPA-constrained parental-consent/tutoring product). The architect's
approved plan under `docs/plans/` splits work into a Shared track (S1-S9,
lands first), a Backend track (B1-B24), and a Frontend track (F1-F17), listed
file-by-file with an explicit "do not touch" boundary
(`app/api/`, `lib/auth/`, `lib/email/`, `lib/api/handler.ts`, `proxy.ts` are
backend's).

**Why this matters:** frontend-engineer is often started before backend has
written the files frontend needs to import (e.g. `lib/auth/actions.ts`,
`lib/auth/dal.ts`). This is expected, not a plan defect — the instruction is
literally "build against the fixed contract even if the backend isn't done."

**How to apply:**
- Read plan §3 (API contract) and §7 (config) for exact shapes; don't guess.
- Write frontend code that imports the documented module paths even if they
  don't exist yet on disk.
- Poll briefly (a short `sleep` + `find`/typecheck, a few times, not a long
  retry loop) rather than blocking indefinitely — backend files tend to land
  within a couple of minutes of each other in the same session.
- Once a backend file lands, read it before assuming your usage matches its
  actual exported signature — the contract table often only pins the
  input/output shape, not the literal calling convention (see
  [[feedback-server-action-adapters]]).
- Final `pnpm typecheck`/`pnpm lint`/`pnpm test` failures that trace only to
  backend-owned files (and change error signature between polls, indicating
  active editing) are that track's responsibility to land, not something to
  fix by touching those files.
