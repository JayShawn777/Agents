---
name: m5-route-surface-findings
description: "M5 route/auth findings — ALL THREE FIXED 2026-09-02 (dev fence now fails closed on NODE_ENV, the after() job re-reads consent, POST /api/students capped)."
metadata:
  type: project
---

Findings from the M5 routes/auth-surface review (2026-09-02), companion to
[[m5-narration-cap-bypass]].

**1. `app/api/dev/local-object/route.ts`'s fence defaults OPEN.** The fence is
`if (STORAGE_DRIVER !== "local") return 404`, but `resolveStorageDriver()`
(`lib/config.ts:167-177`) returns `"local"` for BOTH `undefined` and `""`. A
deployment that omits the env var serves the route. Verified with a throwaway
unit probe: driver deleted from env -> 200 + object bytes, `verifySession` and
`readBytes` both called. `tests/unit/app/api/dev/local-object-route.test.ts:72`
is *titled* "also fences off an unset STORAGE_DRIVER" but sets
`"something-unexpected"`, which throws at config import — it never exercises
unset or empty. Impact is bounded (session + `requireStudentProfile` ownership
of the id embedded in the pathname still apply, and the regex is airtight), but
the fence is not a fence.

**2. The narration `after()` job never re-reads consent state.**
`runNarrationGeneration` has no `status === "ACTIVE"` re-check, and
`withdrawConsent` only flips status without deleting. So a POST that passes the
gate at t=0 keeps calling the vendor and writing blobs for up to
`maxDuration = 300`s after a withdrawal or a §312.6 deletion. Same shape as M4's
`lib/lessons/author.ts`, so not an M5 regression. Blob-before-row means residue
survives a mid-run deletion until `reconcile-blobs` (hourly,
`ORPHAN_THRESHOLD_MINUTES = 60`) collects it — bounded at ~2h, not permanent.

**3. `POST /api/students` has no `rateLimit` and no per-user profile cap.**
Every per-profile cap in the app is therefore multiplied by an attacker-chosen
number. There is still no `middleware.ts` and no IP limiter anywhere in the repo.

**Why:** these are the M5 instances of [[recurring-defect-classes]] 3 (fail-open
helper) and 4 (uncapped spend). The GET reap gate (class 2) HELD this time.

**How to apply:** on the next milestone, grep any new fence for an env var that
`lib/config.ts` gives a permissive default, and read the *body* of any test whose
title claims to cover an unset/omitted value — this repo has now shipped one that
tested a different case than its name.
