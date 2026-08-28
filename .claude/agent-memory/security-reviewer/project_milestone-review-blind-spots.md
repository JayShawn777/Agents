---
name: milestone-review-blind-spots
description: Recurring gap classes in this tutor app's milestone reviews — check RETENTION_POLICY/notice coverage and e2e DB fixtures on every new milestone
metadata:
  type: project
---

Every milestone in this repo that adds Prisma models must also add a
`RETENTION_POLICY` entry in `app/lib/config.ts` and a step in
`app/lib/jobs/enforce-retention.ts`. M3 did this (`CHAT_TRANSCRIPT`); M4 did not
(Lesson / LessonScriptVersion / LessonFlag), so lesson data derived from a
child's schoolwork is retained indefinitely and `app/app/retention/page.tsx` —
the parent-facing COPPA disclosure, rendered directly from that array — says
nothing about it.

**Why:** `tests/unit/lib/jobs/retention-policy-coverage.test.ts` only asserts
policy↔job agreement, so a model with *no* policy entry passes silently. Deletion
cascades are separately well covered by integration tests, which makes it easy to
tick "COPPA deletion" and miss "COPPA retention + notice".

**How to apply:** on any milestone review, diff `prisma/schema.prisma` for new
models, then grep `RETENTION_POLICY` and `/retention` for each. Also check any new
`tests/e2e/fixtures/*.mjs`: they connect with the raw `DATABASE_URL` from `.env`
via `pg` and mint real `Session` rows, and this repo has no guard asserting the
target is a local database.

Related: [[security-review-scope-conventions]]
