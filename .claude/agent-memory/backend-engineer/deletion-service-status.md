---
name: deletion-service-status
description: State of ADR-0007's deletion architecture after B13/B14/B22/B23 — all three deleteStudentData callers now exist.
metadata:
  type: project
---

`lib/deletion/service.ts` (`deleteStudentData(studentProfileId, kind, storage)`)
now has all three of its callers wired up:

1. `DELETE /api/students/[studentId]` — `PROFILE_DELETED` (B14).
2. `POST /api/students/[studentId]/data-deletion` — `PARENTAL_DELETION_REQUEST` (B14).
3. `lib/jobs/purge-closed-accounts.ts`, run by `GET /api/cron/purge-closed-accounts`
   — `ACCOUNT_CLOSURE` (B22/B23, built). It calls `deleteStudentData` once per
   `StudentProfile` for every `User` whose `closureRequestedAt` is at least
   `ACCOUNT_CLOSURE_RECOVERY_DAYS` old, then — only if every profile succeeded —
   stamps `completedAt` on the **existing** account-level `DeletionAudit` row
   (`subjectRef: userId, kind: ACCOUNT_CLOSURE, completedAt: null`, written by
   `POST /api/account/closure` at request time) and deletes the `User` row.
   `deleteStudentData` itself still writes its own separate row keyed to
   `subjectRef: studentProfileId` — two audit rows at two granularities is
   correct, not a duplicate.

**Updated 2026-08-27 — see [[local-fs-storage-adapter]].** `lib/storage/get-storage.ts`
is no longer a placeholder for every driver: `STORAGE_DRIVER=local` (the
default, `lib/config.ts`) now returns a real, working `LocalFsStorage`
(`lib/storage/local-fs.ts`), so M1's upload/extraction work no longer needs
to wait on a Vercel account. Only the `STORAGE_DRIVER=vercel-blob` branch is
still the deliberate throwing placeholder, pending B15
(`lib/storage/vercel-blob.ts`). All five `lib/jobs/*.ts` modules (B22) and all
three `deleteStudentData` callers take a `StoragePort` as a parameter rather
than importing one, specifically so they're already fully unit-testable
against a fake (or now, the real local adapter) and so B15 only ever needs to
change `get-storage.ts`'s `vercel-blob` branch.

**Fixed 2026-08-27 — see [[deletion-service-retry-orphan-risk]].** Building
`purge-closed-accounts.ts` (B22) had surfaced a real correctness gap in the
already-shipped B13 code: retrying `deleteStudentData` after a
`STORAGE_FAILURE` could silently produce an actual orphan (object with no
future deletion path) rather than the "dangling row, retryable" state its own
docstring promised. Fixed without a schema change or a reordering — step 1's
read is no longer filtered by the same flag step 2 writes. Confirmed
`purge-pre-consent.ts` doesn't share the flaw (it enumerates blobs by store
prefix via `storage.listAll()`, never by a DB flag) and `enforce-retention.ts`
doesn't either (it already calls `storage.del()` before marking rows, for its
own documented reason).

**How to apply:** re-read `docs/adr/0007-*.md` §1, §4, §5 fresh before
touching any of this rather than trusting this summary. Verify
`lib/storage/get-storage.ts`, `lib/deletion/service.ts`, and the three caller
sites still look like this before relying on the description — check with
grep, don't assume.
