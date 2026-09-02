---
name: m5-playback-findings
description: "M5 frontend findings — ALL THREE FIXED 2026-09-02 (onNarrationStale wired, narration-state.tsx now has 13 tests, mute proven by mutation)."
metadata:
  type: project
---

Confirmed during the M5 frontend/playback review (2026-09-02, commit fb7613b), by
mutation, not by reading:

1. **`onNarrationStale` is never passed in production.** `LessonPlayer` schedules
   the signed-URL refresh (`NARRATION_URL_REFRESH_MARGIN_MS`, 60s before a 5-min
   `SIGNED_URL_TTL_MS`), but `narration-state.tsx` — the only production caller of
   `LessonView` — omits the prop, so the effect returns early. Deleting the whole
   refresh effect left 83/83 in-scope tests green; no test passes the prop either.
   Audio for a lesson longer than 5 minutes goes dead with no error path
   (`<audio>` has no `onError`).
2. **`narration-state.tsx` has zero tests.** The poller (the M4 refresh-storm
   repeat risk) is uncovered. `retry()` never restarts the interval the FAILED
   branch stopped, so a retry never resolves without a reload.
3. **Mute is unproven.** Replacing `muted={isMuted}` with `muted={false}` kept all
   39 player tests green; the test named "mutes the audio element…" only asserts
   the initial unmuted state.

**Why:** these are the "claim vs code" and "green test that cannot see the thing"
patterns this project keeps re-producing (M4 layout fix, MASTERY_MIN_ATTEMPTS).
**How to apply:** on any M5 follow-up, check these three are actually closed
before believing a milestone gate; re-run the mutations rather than reading.
