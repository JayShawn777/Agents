---
name: deletion-service-retry-orphan-risk
description: FIXED (2026-08-27) — deleteStudentData's step 1 no longer filters by SOURCE_DELETED, so retry after STORAGE_FAILURE no longer orphans blobs.
metadata:
  type: project
---

**Status: fixed, 2026-08-27.** The fix below did NOT need a schema change or
a reordering, contrary to what this memory originally concluded — there was
a third option neither entry considered.

`deleteStudentData` (`lib/deletion/service.ts`, B13) marks every non-
`SOURCE_DELETED` `Upload` row `SOURCE_DELETED` and commits **before** calling
`storage.del()` (ADR-0007 §1: "so the UI is honest the instant deletion
starts"). If `storage.del()` then throws, the function returns
`{ ok: false, code: "STORAGE_FAILURE" }`, and its own docstring and test
(`tests/unit/lib/deletion/service.test.ts`, the test literally named
"...(retry-safe)") both assert the caller can safely call it again.

**That is not true across two separate invocations.** A retry's step-1 query
(`db.upload.findMany({ where: { status: { not: "SOURCE_DELETED" } } })`) finds
NOTHING, because every affected row was already marked `SOURCE_DELETED` in
the failed attempt. The retry then skips the entire blob-deletion block
(`if (pathnames.length > 0)` is false) and proceeds straight to deleting the
`StudentProfile` row, which cascades away the `Upload` rows whose blobs were
**never actually confirmed deleted**. Row gone, object still in the store,
nothing left pointing at it — an actual orphan, the exact failure mode
ADR-0007 exists to prevent, not the accepted "dangling row" trade-off its
comments describe.

**Where this actually bites:** `lib/jobs/purge-closed-accounts.ts` (B22) is
the one caller that can genuinely retry across separate runs — a daily cron,
by design, on a profile that hit `STORAGE_FAILURE` yesterday. The two
interactive routes (`DELETE /api/students/[id]`, `POST
.../data-deletion`) only retry if the SAME user manually resubmits, which is
possible but not scheduled the way a cron job is.

**The actual fix (no schema change, no reordering):** the root cause was
never "which column" or "which order" — it was that step 1's READ used the
same `status: { not: "SOURCE_DELETED" }` filter as step 2's WRITE, so one
flag was doing two jobs (`"attempted"` vs. `"confirmed gone"`). The fix:
step 1 now reads EVERY `Upload` row for the profile, unfiltered by `status`,
because the full pathname set is always re-derivable from `studentProfileId`
while the `StudentProfile` row still exists. Step 2 still marks only the
not-yet-`SOURCE_DELETED` rows (unchanged), and step 3's `storage.del()` still
runs before any row destruction (unchanged) — ADR-0007 §1's ordering and its
"honest mid-deletion reader" property are both fully preserved, and
`enforce-retention`'s reversed ordering (see its own docstring) is untouched
and still consistent with this. This relies on `StoragePort.del()` being
idempotent for an already-gone object, which the port's contract already
assumes (`enforce-retention` relies on the same idempotency).

**How to apply:** if this bug resurfaces (e.g. someone reintroduces the
status filter on step 1's `findMany` "to be more efficient"), reject that —
it reintroduces exactly this orphan. The regression test is
`tests/unit/lib/deletion/service.test.ts`, describe block "retry after
STORAGE_FAILURE must not orphan blobs (regression)" — it uses a STATEFUL fake
`Upload` table (not a fixed-array stub) specifically because a naive stub
returns the same rows regardless of the `where` filter and cannot catch this
class of bug. [[deletion-service-status]] is the broader status memory this
one is linked from.
