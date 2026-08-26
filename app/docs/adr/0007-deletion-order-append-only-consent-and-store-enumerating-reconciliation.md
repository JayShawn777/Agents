# ADR-0007: Blob-first deletion, append-only consent, and a store-enumerating reconciler

- **Status:** Proposed
- **Date:** 2026-08-26
- **Deciders:** Jaysh (pending)
- **Spec:** docs/specs/m0-accounts-and-profiles.md, docs/specs/m1-upload-and-extract.md

## Context

Both specs treat deletion as a compliance control rather than housekeeping, and
say so in unusually direct language: *"a parent who asks us to delete everything
would be told, truthfully and wrongly, that we had."*

Five deletion paths exist across M0 and M1, and every one of them must remove
stored objects, not merely database rows:

| Path | Criteria |
|---|---|
| Delete one upload | M1 AC 34 |
| Delete a student profile | M0 AC 35, M1 AC 35 |
| Delete the account (30-day grace, then purge) | M0 AC 36 |
| Source-file retention expiry | M1 AC 36 |
| Orphan reconciliation | M0 AC 34, M1 AC 16 |

Two structural problems make this non-obvious.

**First, Prisma/Postgres cascades delete rows, not blobs.** `onDelete: Cascade`
on `StudentProfile → Upload` is correct and necessary for referential integrity,
but the moment those rows vanish, the pathnames they held are gone and no code
can ever reach the objects again. A naive `db.studentProfile.delete()` therefore
*creates* orphans rather than cleaning up.

**Second, every deletion path walks from a database row to a pathname.** An
upload whose bytes stored successfully but whose database write failed has no
row. It is unreachable by all four of the row-driven paths above, permanently.
Both specs single this out as the reason AC 34 / M1 AC 16 must enumerate the
**store**, not the database.

Separately, M0 AC 23 requires that withdrawing consent **appends** a record with
`withdrawnAt` set while leaving the prior record's fields **unchanged**, and the
non-goals require the consent schema to be versioned so M6 can add a
voice-cloning scope "as an append, not a migration of existing rows". M0 AC 36
requires an audit entry that **survives the purge** of everything else.

## Decision

### 1. Delete blobs first, then rows. Always.

Every deletion path runs in this order:

1. Read the pathnames to be removed (within the ownership scope).
2. Mark the affected `Upload` rows `SOURCE_DELETED` and commit, so the UI is
   honest the instant deletion starts.
3. `storage.del(pathnames)`.
4. Delete the database rows, letting cascades handle descendants.

If step 3 fails, the rows still exist and the operation can be retried. If step
4 fails after step 3 succeeded, we are left with rows pointing at objects that
are gone — visible, harmless, and detectable — rather than objects that no row
points at. **We accept a dangling row over a dangling file**, because only one of
those is a child's schoolwork sitting somewhere we promised it was not.

### 2. The reconciler enumerates the store, not the database.

`GET /api/cron/reconcile-blobs` (Bearer `CRON_SECRET`) pages through
`storage.listAll()`, batches pathnames, and for each batch asks Postgres which
of them have an `Upload` row. Any pathname with **no row** and
`uploadedAt` older than `ORPHAN_THRESHOLD_MINUTES` (60) is deleted. An object
that does have a row is left untouched (AC 34, both halves). It also flips any
`Upload` still `PENDING` past the threshold to `FAILED` so the student sees a
failed upload with a retry (M1 AC 16), and prunes `UploadTokenGrant` rows older
than 24 hours.

The threshold exists because an in-flight upload legitimately has no row yet.
The direction of enumeration is the whole point: this is the only control that
can see an object the database has never heard of, and it must not be cut for
scope.

### 3. Consent records are append-only.

`ParentalConsent` rows are **never updated and never deleted** while the account
lives. Granting appends a row with `grantedAt` and `withdrawnAt: null`.
Withdrawing appends a **new** row carrying the same scopes with `withdrawnAt`
set (AC 23) — the prior row is byte-identical afterwards. Current state is
"the most recent row for this profile", derived, never stored on the row itself.
`StudentProfile.status` is the denormalised cache of that derivation and is
updated in the same transaction as the append.

Versioning has two independent axes so M6 is an append:

- `consentTextVersion: String` — which wording the adult actually agreed to.
  Changing the copy means a new version identifier, not an edit.
- `scopes: ConsentScope[]` — an array. M6 adds `VOICE_CLONING` to the enum and
  writes a new row with `[DATA_PROCESSING, VOICE_CLONING]`. No existing row is
  touched, no backfill runs, and a query for "who consented to voice cloning" is
  `scopes has VOICE_CLONING` on the latest non-withdrawn row.

### 4. Account deletion is soft, then purged by a job, and leaves an audit row.

`POST /api/account/deletion` sets `User.deletionRequestedAt`, deletes every
`Session` row for that user so live cookies die immediately, and writes
`AccountDeletionAudit { userId, requestedAt }`. Sign-in is refused while
`deletionRequestedAt` is set and the grace period has not elapsed (ADR-0002).

`GET /api/cron/purge-accounts` finds users past `ACCOUNT_GRACE_PERIOD_DAYS` (30),
and for each: enumerates every pathname under all of that user's profiles,
deletes the blobs, then deletes the `User` row — cascades take profiles, consent
records, uploads, extractions and problems with it — then stamps
`AccountDeletionAudit.completedAt`.

**`AccountDeletionAudit` has no foreign key to `User`.** It holds only the
opaque `userId` string and two timestamps: no email, no name, nothing about the
child. That is what lets it survive the purge (AC 36) without being the thing we
promised to destroy.

Consent-record retention after purge is a **legal** open question (M0 open
question 5). We do not guess: `CONSENT_RETENTION_AFTER_PURGE_DAYS` lives in
`lib/config.ts` and defaults to `0` (purged with everything else). Changing it
to a non-zero value must copy consent rows into a separate retention table, and
that is a decision for a later ADR once legal answers.

### 5. Source-file retention runs on the same shape.

`GET /api/cron/enforce-retention` finds `Upload` rows older than
`SOURCE_FILE_RETENTION_DAYS` (365) with status `STORED`, deletes their blobs,
and sets `status = SOURCE_DELETED` and `sourceDeletedAt`. **The row and its
extracted problems survive** — the text is what M2 and M7 build on, and the
photograph is the sensitive part (M1 AC 36).

## Alternatives considered

### Rows first, blobs second (the natural transaction ordering)
- **Pros:** The transaction is the source of truth; blob deletion is a
  fire-and-forget afterthought; simplest code.
- **Cons:** A failure between the two produces an orphan — a child's schoolwork
  with no row and therefore no deletion path — which is precisely the outcome
  both specs describe as a compliance defect.
- **Rejected because:** it makes the worst failure mode the likely one.

### Rely on `onDelete: Cascade` alone and let the reconciler clean up the blobs
- **Pros:** Least code. One `db.user.delete()` and the sweeper does the rest.
- **Cons:** Turns every deletion into a deliberate orphan and makes the parent's
  "delete everything" promise true only after the next cron run — up to 24 hours
  on Hobby, where crons run daily. AC 35's "within the same operation or a job
  that completes within 24 hours" would be met only by the letter.
- **Rejected because:** the reconciler is a backstop for failures, not the
  mechanism. If it is the mechanism, there is no backstop.

### Enumerate the database and delete blobs that are marked deleted (a tombstone table)
- **Pros:** Cheaper than listing a whole store; no provider `list()` pagination.
- **Cons:** A tombstone is written from a code path that knows the pathname —
  which is exactly the code path that failed in the orphan scenario. It cannot
  see an object we never recorded.
- **Rejected because:** it is the row-driven approach wearing a different hat and
  is blind to the one case that matters.

### Mutate the consent row on withdrawal (set `withdrawnAt` in place)
- **Pros:** One row per profile; trivial "is consent current?" query.
- **Cons:** AC 23 requires the prior record's fields to be **unchanged in the
  database**. An in-place update destroys the evidence that consent was validly
  obtained at a point in time, which is the entire purpose of the record. Adding
  M6's scope would then be a backfill of existing rows.
- **Rejected because:** it fails AC 23 literally and defeats the record's
  purpose.

### Hard-delete the account immediately, no grace period
- **Pros:** Honours the request instantly; no soft-deleted state to reason about;
  no purge job.
- **Cons:** No recovery window against an accidental or malicious deletion of a
  family's entire history. AC 36 specifies 30 days.
- **Rejected because:** the spec requires it, though the 30-day figure is a
  stated assumption with no regulator behind it — hence it is configuration.

### Soft-delete student profiles too (`deletedAt`) rather than hard-deleting
- **Pros:** Symmetry with account deletion; recoverable.
- **Cons:** AC 14 requires a direct request for a deleted profile to return 404
  and AC 35 requires the objects to be gone; a soft-deleted profile whose files
  are deleted is a husk. Every subsequent query would need a `deletedAt: null`
  filter, and one forgotten filter leaks a deleted child's data.
- **Rejected because:** an easily forgotten filter on children's data is a worse
  risk than the lost undo. Profile deletion is immediate and confirmed in the UI.

## Consequences

### Positive
- There is exactly one control that can find an object the database has never
  heard of, and it is specified, testable against a fake storage adapter, and
  named as a compliance control so a reviewer will not treat it as a nice-to-have.
- The consent table is an audit log, so "what did this adult agree to, and
  when?" is answerable historically and M6 is a pure append.
- Deletion promises are honest at every intermediate state: `SOURCE_DELETED` is
  written before the bytes go.
- Every tunable a lawyer might change — grace period, retention, consent
  retention — is one constant in one module, not a literal in a job.

### Negative / accepted trade-offs
- Deletion is multi-step and not atomic across two systems. There is no
  distributed transaction available; we choose the failure direction instead.
- The reconciler's cost grows with the size of the store, since it lists
  everything. Acceptable at M0/M1 scale; it will need prefix-partitioning by
  profile later.
- **Vercel Cron on the Hobby plan runs at most daily.** A 60-minute orphan
  threshold does not mean a 60-minute cleanup. AC 35's "within 24 hours" is met;
  a tighter window needs Pro. This is an infrastructure decision the owner
  should make knowingly.
- A dangling `Upload` row pointing at a deleted object is possible. It renders as
  "source file removed" and its preview URL 404s.
- "Current consent" is a derived query, so `StudentProfile.status` is a
  denormalisation that must be written in the same transaction as the consent
  append or the two drift.

### Follow-up required
- [ ] Legal answer on consent-record retention after account purge (M0 open
      question 5). Until then `CONSENT_RETENTION_AFTER_PURGE_DAYS = 0`.
- [ ] Decide the Vercel plan, because it sets the achievable cron frequency.
- [ ] Confirm in the plan §9 spike that `listAll()` exposes `uploadedAt` per
      object and supports cursor pagination — the reconciler depends on both.
- [ ] Verify with the provider whether deleting an object also purges CDN
      caches; the storage research explicitly did not cover this.
- [ ] One manual end-to-end deletion rehearsal on a preview deployment before
      any real family uses the product.

## Revisit when

The store grows past what a full `list()` can sweep in one cron invocation; or
legal returns an answer on consent retention; or a regulator specifies a grace
period other than 30 days; or a second storage provider is added and "enumerate
the store" means enumerating two.
