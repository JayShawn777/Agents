---
name: narration-purge-fully-wired
description: All three NarrationAsset purge/coverage paths are now wired (delete-upload, deleteStudentData, single-problem DELETE) — nothing left "NOT WIRED" as of 2026-09-01.
metadata:
  type: project
---

`lib/narration/purge.ts`'s `purgeUnreferencedNarration(studentProfileId, storage)`
is now called from all three places M5 §7.3 names: `lib/uploads/delete-upload.ts`
(pre-existing), `deleteStudentData` (covered structurally via
`PROFILE_BLOB_SOURCES`, not this sweep), and — as of 2026-09-01 —
`app/api/extractions/[extractionId]/problems/[problemId]/route.ts`'s DELETE
handler (single extracted-problem delete). The purge.ts docstring's "WHERE IT
IS ACTUALLY CALLED FROM" section is the source of truth; keep it current
whenever a new lesson-cascading delete path is added, per its own warning
about retro lesson 23 (a doc claiming code exists that doesn't).

**Why:** deleting one extracted problem cascades its `Lesson` and
`LessonNarration`/`LessonNarrationStep` rows, but `NarrationAsset` is
profile-scoped (ADR-0015) and does not cascade from a lesson — without the
sweep, audio blobs only got cleaned up by the hourly reconciler orphan sweep,
up to an hour after the child's data was otherwise gone (AC 20 wants better
than eventually).

**How to apply:** the pattern to copy is always `lib/uploads/delete-upload.ts`'s
step 4 exactly — call the purge AFTER the row delete/cascade has committed,
inside a try/catch that only `console.error`s on failure and never fails the
response. The row deletion is the thing that must succeed; the sweep is
best-effort cleanup. To get `studentProfileId` into a route whose resolved
resource (e.g. `ExtractedProblem`) doesn't carry it directly, stitch it onto
the resolved resource type in `resolveOwnedProblem`/equivalent from the same
already-loaded parent (e.g. `extraction.upload.studentProfileId`) rather than
issuing a second query — `requireExtraction` etc. are wrapped in React
`cache()` per request anyway, so a second call would be free, but stitching
it on avoids a second round through the DAL type entirely.

Regression test technique used and worth repeating: before wiring, `git
stash` the route file, run the new "sweep is called" / "purge failure
doesn't fail the delete" tests against the OLD code, confirm both go red,
then `git stash pop` and confirm green. Caught a real gap (the tests failed
exactly the way you'd expect against the unfixed route).
