---
name: m5-data-lifecycle-findings
description: "M5 lifecycle findings — THREE FIXED 2026-09-02 (purge race, sidecar blind spot, BLOB_CLAIMANTS test). The §312.4 vendor-notice one is OPEN and is an owner decision."
metadata:
  type: project
---

Findings from the M5 narration data-lifecycle review, 2026-09-02. Recorded so a
later session can check each against current code rather than re-deriving it.

1. **The §312.4 direct notice does not name the TTS vendor.**
   `lib/notice/copy.ts` `DIRECT_NOTICE_COPY.thirdParties` lists Anthropic,
   Vercel, Neon and the email provider only; `app/privacy/page.tsx` lists the
   same four. `lib/narration/provider.ts` POSTs a step's narration text — a
   sentence describing a specific child's homework — to ElevenLabs.
   `DIRECT_NOTICE_VERSION` was last bumped 2026-08-26.1, before M5.
   ADR-0015's own follow-up calls naming the vendor "a hard precondition"
   before the first narration request.
2. **`purgeUnreferencedNarration` CAN over-delete**, despite its docstring
   saying it cannot. `findMany({steps:{none:{}}})` and the `deleteMany` are
   two statements with no transaction; a narration run whose final
   transaction commits in that gap has its brand-new steps cascade-deleted
   (`LessonNarrationStep.assetId onDelete: Cascade`) and its blob deleted,
   leaving a `READY` narration with `stepCount: N` and zero steps.
   Reproduced against real Postgres by replaying the interleaving.
3. **A `LocalFsStorage` object whose meta sidecar is missing is invisible
   forever.** `put()` writes `objects/<p>` then `meta/<p>.json`; `listAll()`
   skips any object with no sidecar, so a crash between the two writes hides
   the object from `reconcile-blobs`, the one control that enumerates the
   store. Reproduced with a temp root.
4. **`BLOB_CLAIMANTS` (`lib/jobs/reconcile-blobs.ts`) has no
   completeness test**, unlike `PROFILE_BLOB_SOURCES`. Missing registration
   fails toward *deleting* a live blob, and the blob-sources schema test only
   catches models with BOTH `pathname` and `studentProfileId` — an
   account-scoped blob (M6's voice sample) is caught by neither.

**Why:** these are the lifecycle half of COPPA for this app — the audio is
generated from a child's schoolwork, and both directions (blob outliving the
child, and audio deleted while still in use) are compliance-visible.

**How to apply:** re-check 1 by grepping `thirdParties` for the vendor name and
whether `DIRECT_NOTICE_VERSION` moved; 2 by whether purge's two statements are
in one transaction or the query excludes recent rows; 3 by whether `put()`
writes the sidecar first or `listAll()` yields sidecar-less objects; 4 by
whether a test reads `schema.prisma` for `BLOB_CLAIMANTS`.
See [[recurring-defect-classes]] and [[milestone-review-blind-spots]].

**Test-run note:** `tests/integration/*` against the local `prisma dev` database
fails intermittently with `Code: 08P01 ... prepared statement "" requires 0
parameters`. It is a pooler/protocol flake, not a real failure — re-run the
same file alone and it passes.
