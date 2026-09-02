---
name: m5-generation-pipeline-findings
description: "M5 lib/narration findings — ALL FOUR FIXED 2026-09-02 (pool drain, cueFormatVersion cache hits, ragged alignment, P2002 blob clobber). Kept for the technique that found them."
metadata:
  type: project
---

Reviewed 2026-09-02 against commit fb7613b. All four reproduced with throwaway
probes under `tests/unit/lib/narration/` (deleted after running).

1. **`mapWithConcurrency` keeps draining after a failure.** Its own docstring
   claims only "siblings already in flight are not cancelled". Reality: workers
   loop on a shared cursor, so after `Promise.all` rejects, the surviving worker
   pulls every remaining item. Probe: 12-step script failing on step 1 →
   `runNarrationGeneration` returned FAILED after 2 vendor calls, then the pool
   made 12 calls and wrote 11 blobs + 11 asset rows. `charactersBilled` stayed
   `null` (the FAILED path never records it), so that spend is invisible to the
   AC 21 budget.
2. **Cache hits ignore `cueFormatVersion`.** `lookupNarrationAsset` selects it
   and `resolveStepAsset` discards it, while the run stamps
   `CUE_FORMAT_VERSION` on the `LessonNarration` row. Bumping the constant
   yields lessons stamped "2" whose steps point at "1" assets.
3. **Ragged alignment arrays are not rejected.** `deriveNarrationCues` only
   checks `characters.join("") === text`; the two times arrays may be shorter.
   Probe: run finished READY with persisted cues `{s: null, e: null}` that fail
   the module's own `NarrationCuesSchema`, and every step `durationMs` wrong.
   Nothing validates the derivation's output before it is cached forever.
4. **P2002 loser overwrites the winner's blob.** `narrationAssetPathname` is
   derived from (profile, cacheKey), so both racers write the same path;
   `LocalFsStorage.put` overwrites. Probe: surviving row described 1200 ms of
   audio while the bytes on disk were the loser's. The docstring's "the loser's
   blob remains at its own path, unreferenced" is false.

**Why:** these are the M5 equivalents of the M4 review's "claim in a comment,
absent in code" class — three of the four are contradicted by a comment sitting
directly above the code.

**How to apply:** when reviewing any future concurrency pool in this repo, run
a probe that fails one item and counts calls AFTER the top-level promise
settles. See also [[m5-narration-cap-bypass]] (security-reviewer) for the
retry/upsert side of the same billing gap.
