---
name: m5-narration-cap-bypass
description: "M5 cap bypass — FIXED 2026-09-02 by a per-attempt NarrationRunAttempt ledger. The rule it establishes: never window a cap on a row a retry reuses."
metadata:
  type: project
---

`app/api/lessons/[lessonId]/narration/route.ts` (endpoint 46) bounds paid
ElevenLabs spend with two rolling-window queries, both keyed on
`LessonNarration.createdAt`:

- `countNarrationRuns` — `count({ studentProfileId, createdAt: { gte: now-1h } })`
- `sumCharactersBilledInWindow` — `_sum.charactersBilled` over `createdAt gte now-24h`

AC 17's retry is the SAME POST, and `grantNarrationRun` `upsert`s on
`@@unique([versionId])` — so a retry never inserts a row and **never touches
`createdAt`**. `runNarrationGeneration` also SETS `charactersBilled` rather than
accumulating it, and does not write it at all on the FAILED path.

**Why:** proved against real Postgres 2026-09-02 with a throwaway
`tests/integration` probe: a row created 25h ago with `charactersBilled =
19_999`, retried three times via the route's exact upsert, still had
`createdAt` 25h old, still counted 0 runs in the hour window, still summed 0
characters in the day window, and ended with `charactersBilled = 2880` rather
than the true cumulative spend. Cache hits are free, so the way to force real
billing on each retry is to PATCH `personaId` between POSTs — the cache key is
`sha256(text \0 providerVoiceId \0 ttsModelId)`, so a new voice misses every
step.

**How to apply:** any future cap in this repo must window on a per-attempt
row/ledger, not on a mutable row that a retry reuses. Check
`NARRATION_RUNS_PER_HOUR` / `NARRATION_DAILY_BUDGET_CHARS` are still enforced
via `createdAt` before assuming this was fixed. Related:
[[recurring-defect-classes]] class 4 (uncapped model spend).
