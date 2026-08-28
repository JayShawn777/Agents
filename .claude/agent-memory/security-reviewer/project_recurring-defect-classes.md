---
name: recurring-defect-classes
description: The four hole classes this tutor app has actually shipped (per-milestone), and where to look for each first in any future security review.
metadata:
  type: project
---

Across M0-M4 reviews, this codebase has repeatedly produced the same four defect
classes. Check these first, in this order, before breadth.

1. **A mutation missing the Owner+ACTIVE consent gate.** M2: the practice-retry
   route could generate new content for a profile whose parent had WITHDRAWN
   consent, and had no test file at all.
2. **A WRITE reached on a deliberately Owner-only READ path.** M3:
   `closeIfPastBounds` on a GET. M4 repeats the shape with `reapIfStale` on
   `GET /api/lessons/[lessonId]` — there the gate holds, as an inline
   `status === "ACTIVE"` ternary in the handler rather than `requireState`,
   because the read itself must stay available after withdrawal.
3. **An authorization helper that fails OPEN when a route omits an optional
   field.** Correct on every configured route, one line from disabled.
   `withAuth` now throws at module load for the two known shapes of this
   (`requireState`/`requireFlow` without `resolveResource`; `publicRateLimit`
   without `mode: "public"`).
4. **Uncapped model spend.** Every generation cap in this app is a read-then-write
   count with no serialization, and there is no `middleware.ts` and no IP-level
   limiter anywhere in the repo — so caps bound sequential callers only.

**Why:** the app tutors MINORS and COPPA applies, so a write reached after
consent withdrawal is a compliance failure, not just a bug; and authoring runs
cost 12-59s of Anthropic Opus time each, so a cap bypass is a direct financial
DoS.

**How to apply:** on any new milestone, enumerate mutations and read paths
separately, and for each read path grep the handler body for a `db.*.update`/
`create`/`updateMany` reached past the gate. Treat any cap implemented as
"count rows, then insert" as bypassable by concurrency unless a unique
constraint or transaction serializes it. See [[m4-known-open-issues]].
