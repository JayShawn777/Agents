# ADR-0007: Blob-first deletion, append-only consent, and a store-enumerating reconciler

- **Status:** Accepted
- **Date:** 2026-08-26
- **Revised:** 2026-08-26 (see "Revision note")
- **Deciders:** Jaysh
- **Accepted:** 2026-08-28
- **Spec:** docs/specs/m0-accounts-and-profiles.md, docs/specs/m1-upload-and-extract.md

## Revision note — 2026-08-26

This ADR was written against the previous M0 draft (36 AC) and is revised in
place because it is **Proposed, not Accepted**. Nothing here has been built. The
revision is forced by the M0 spec revision of the same date, which was itself
forced by `docs/research/coppa-childrens-privacy.md`.

What changed, and why:

1. **Deletion is now three paths, not one.** The old §4 described a single
   account-deletion path with a 30-day grace period, and the old AC 36 was the
   only deletion the ADR treated as a first-class user action. The revised spec
   splits it: **account closure** keeps the 30-day recovery window (AC 47), a
   **parental §312.6 deletion request** has *no* recovery window and is
   explicitly forbidden from being routed through closure (AC 48), and that
   deletion path must be **reachable from the student profile without closing
   the account** (AC 49). The reason is the Amazon Alexa fact pattern: a grace
   period on an account *the holder chose to close* is defensible; the same
   grace period applied to a parent saying "delete my child's data" is what drew
   a $25M penalty.
2. **The status vocabulary changed.** `CONSENT_REQUIRED` is gone. The states are
   `NOTICE_PENDING` → `CONSENT_PENDING` → `ACTIVE`, plus `CONSENT_WITHDRAWN`.
   Every reference in this ADR is updated. Withdrawal now lands in
   `CONSENT_WITHDRAWN`, not back in a pre-consent state, because a withdrawn
   profile has a history a never-consented profile does not.
3. **Append-only gains exactly one exception,** and it is written down here
   rather than discovered later: `ParentalConsent.verifiedAt` is a one-time,
   monotonic `null → timestamp` stamp (AC 19). Every other field remains
   immutable after insert. See §3.
4. **A fifth and sixth deletion path are now first-class:** the pre-consent
   purge (AC 22) and the tiered retention sweep (AC 45). Source files now expire
   **14 days after successful extraction**, not 12 months from upload, which
   changes what the retention job keys off — see §5.
5. **Post-deletion consent retention is no longer "probably zero".** AC 50
   specifies a pseudonymised audit artifact. §6 is new.
6. **`AccountDeletionAudit` is generalised to `DeletionAudit`** with a `kind`,
   because there are now three distinct deletion events to prove we performed,
   not one.

The original decisions on **blob-first ordering** (§1) and the
**store-enumerating reconciler** (§2) are unchanged. Nothing in the spec
revision touched them.

## Context

Both specs treat deletion as a compliance control rather than housekeeping, and
say so in unusually direct language: *"a parent who asks us to delete everything
would be told, truthfully and wrongly, that we had."*

**Six** deletion paths now exist across M0 and M1, and every one of them must
remove stored objects, not merely database rows:

| Path | Criteria | Grace period |
|---|---|---|
| Pre-consent purge of a profile that never reached `ACTIVE` | M0 AC 22 | none — the window *is* the grace period |
| Tiered retention expiry (source files, audit artifacts) | M0 AC 45 · M1 AC 36 | none |
| Delete one upload | M1 AC 34 | none |
| Delete a student profile | M0 AC 31, AC 46 · M1 AC 35 | none |
| **Parental §312.6 deletion request** | M0 AC 48, AC 49 | **none, and explicitly may not borrow one** |
| **Account closure** | M0 AC 47 | **30 days, disclosed** |
| Orphan reconciliation | M0 AC 43 · M1 AC 16 | 60-minute threshold |

Three structural problems make this non-obvious.

**First, Prisma/Postgres cascades delete rows, not blobs.** `onDelete: Cascade`
on `StudentProfile → Upload` is correct and necessary for referential integrity,
but the moment those rows vanish, the pathnames they held are gone and no code
can ever reach the objects again. A naive `db.studentProfile.delete()` therefore
*creates* orphans rather than cleaning up.

**Second, every row-driven deletion path walks from a database row to a
pathname.** An upload whose bytes stored successfully but whose database write
failed has no row. It is unreachable by all of the row-driven paths above,
permanently. Both specs single this out as the reason AC 43 / M1 AC 16 must
enumerate the **store**, not the database.

**Third, two of the paths look identical in code and must not look identical to
a parent.** Deleting a student profile and honouring a §312.6 deletion request
perform the same destruction. They differ in what the confirmation screen
promises, in what evidence we must be able to produce afterwards, and in the
fact that one of them is a legal obligation with a promptness expectation. If
they share an implementation without recording which one happened, we cannot
later prove we honoured the request.

Separately, M0 AC 24 requires that withdrawing consent **appends** a record with
`withdrawnAt` set while leaving the prior record's fields **unchanged**; AC 19
requires `verifiedAt` to be stamped after `submittedAt` on the record that
already exists; the non-goals require the consent schema to be versioned so M6
can add a voice-cloning scope "as an append, not a migration of existing rows";
and AC 47 requires an audit entry that **survives the purge** of everything else.

## Decision

### 1. Delete blobs first, then rows. Always. (unchanged)

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

### 2. The reconciler enumerates the store, not the database. (unchanged)

`GET /api/cron/reconcile-blobs` (Bearer `CRON_SECRET`) pages through
`storage.listAll()`, batches pathnames, and for each batch asks Postgres which
of them have an `Upload` row. Any pathname with **no row** and `uploadedAt`
older than `ORPHAN_THRESHOLD_MINUTES` (60) is deleted. An object that does have
a row is left untouched (AC 43, both halves). It also flips any `Upload` still
`PENDING` past the threshold to `FAILED` so the student sees a failed upload
with a retry (M1 AC 16), and prunes `UploadTokenGrant` rows older than 24 hours.

The threshold exists because an in-flight upload legitimately has no row yet.
The direction of enumeration is the whole point: this is the only control that
can see an object the database has never heard of, and it must not be cut for
scope.

### 3. Consent records are append-only, with exactly one permitted mutation.

`ParentalConsent` rows are **never deleted while the account lives**, and are
**never updated except by the single `verifiedAt` stamp described below**.

- **Submitting** consent appends a row with `submittedAt`, `method`,
  `methodEvidence` (nullable until the method produces it), `consentTextVersion`,
  `noticeVersion`, `verifiedAt: null`, `withdrawnAt: null`. The profile moves to
  `CONSENT_PENDING` (AC 18).
- **Corroborating** the method performs the one permitted mutation:
  `UPDATE parental_consent SET verified_at = $1, method_evidence = $2
   WHERE id = $3 AND verified_at IS NULL`. The `verified_at IS NULL` predicate
  makes it idempotent and makes double delivery of a provider callback harmless.
  A zero-row result is a no-op, never an error the parent sees twice. Only after
  this update, in the same transaction, does the profile become `ACTIVE`
  (AC 19).
  `verifiedAt` is computed as `max(now, submittedAt + 1ms)` so that AC 19's
  "distinct from and no earlier than `submittedAt`" holds even for a method
  whose corroboration returns inside the same millisecond.
- **Withdrawing** appends a **new** row that copies `method`,
  `consentTextVersion`, `noticeVersion` and `scopes` from the row it supersedes,
  sets `withdrawnAt`, sets `supersedesConsentId`, and leaves `verifiedAt` null.
  The prior row is byte-identical afterwards (AC 24). The profile becomes
  `CONSENT_WITHDRAWN`.

Current state is derived from **the most recent row for this profile**:
consent is live iff that row has `verifiedAt != null` and `withdrawnAt == null`.
`StudentProfile.status` is the denormalised cache of that derivation and is
written in the same transaction as every append and the one stamp.

Why `verifiedAt` is a mutation rather than a second appended row: AC 17 and
AC 19 describe **one record** that contains both `submittedAt` and `verifiedAt`
and require the second to be later than the first *on that record*. Splitting
them across two rows would make "inspect the record" ambiguous and would make
every consumer join. The narrow conditional update is the smaller compromise,
and it is the only `UPDATE` this table ever receives — a rule a reviewer can
enforce with one grep.

Versioning has three independent axes so M6 remains an append:

- `consentTextVersion: String` — which wording the adult agreed to.
- `noticeVersion: String` — which §312.4 direct notice was served (AC 14, AC 17),
  denormalised onto the consent row so it survives independently of the
  `DirectNotice` row's own retention.
- `scopes: ConsentScope[]` — M6 adds `VOICE_CLONING` to the enum and writes a new
  row. No existing row is touched, no backfill runs.

The `method` column is a fourth axis and is the subject of **ADR-0008**. It is
recorded on the row, never inferred from configuration at read time, which is
what lets the configured method change without invalidating history (AC 16).

### 4. Three deletion paths, three timelines, one shared destructor.

There is exactly one function that destroys a student's data:

```
deleteStudentData(studentProfileId, kind: DeletionKind): Promise<void>
```

It runs the §1 order, writes a `DeletionAudit` row carrying `kind`, and
pseudonymises consent records per §6. Every caller below uses it. The
differences between the paths are **which rows are in scope, what the
confirmation copy promises, and whether anything is queued** — never the
destruction itself.

**(a) Delete a student profile — `DELETE /api/students/[studentId]`.**
Immediate. Blobs, then rows, then cascades. The profile row goes too, so a
subsequent direct request is a 404 (AC 31). `kind = PROFILE_DELETED`.

**(b) Parental §312.6 deletion request — `POST /api/students/[studentId]/data-deletion`.**
Immediate, `kind = PARENTAL_DELETION_REQUEST`. Same destruction as (a). It is a
**separate route with separate confirmation copy** stating that the deletion is
immediate and irreversible (AC 48), reachable from the student profile screen
(AC 49), and it is *never* implemented as "set a flag and let the closure job
handle it". The separate route exists for one reason beyond copy: the
`DeletionAudit.kind` is the only evidence we will have that a §312.6 request was
made and honoured promptly. Collapsing it into (a) destroys that evidence.

**Stated as a rule for the engineers: no code path may set
`User.closureRequestedAt` in response to a request to delete a child's data, and
no code path may satisfy a `PARENTAL_DELETION_REQUEST` by waiting for a cron
run.** Deletion happens in the request that confirms it; only blob deletion may
fall to a retry, and it is bounded at 24 hours (AC 48).

**(c) Account closure — `POST /api/account/closure`.**
Soft. Sets `User.closureRequestedAt`, deletes every `Session` row so live
cookies die immediately, writes `DeletionAudit { kind: ACCOUNT_CLOSURE,
requestedAt }`. Sign-in is refused while `closureRequestedAt` is set and
`ACCOUNT_CLOSURE_RECOVERY_DAYS` (30) has not elapsed (ADR-0002). The
confirmation screen states the length of the window and its purpose, because
AC 47 requires the disclosure and because an undisclosed soft delete is the
thing §312.10 asks us to write down.
`GET /api/cron/purge-closed-accounts` finds users past the window, calls
`deleteStudentData` for each of their profiles, deletes the `User` row, and
stamps `DeletionAudit.completedAt`.

The endpoint is named `/api/account/closure`, **not** `/api/account/deletion`,
deliberately. The old name is the ambiguity AC 48 exists to forbid; a route
called "deletion" that returns a 30-day timer is exactly the confusion the FTC
penalised.

**`DeletionAudit` has no foreign key to `User` or `StudentProfile`.** It holds an
opaque `subjectRef` string, a `kind`, and two timestamps: no email, no name,
nothing about the child. That is what lets it survive the purge it exists to
record (AC 47) without being the thing we promised to destroy.

### 5. Pre-consent purge and tiered retention run on the same shape.

**`GET /api/cron/purge-pre-consent`** finds `StudentProfile` rows where
`status != ACTIVE`, `status != CONSENT_WITHDRAWN` and
`createdAt < now - PRE_CONSENT_PURGE_DAYS` (14, configuration — AC 22, AC 23),
and deletes each with `kind = PRE_CONSENT_PURGE`: the profile, its age band, its
`DirectNotice` rows, its unverified `ParentalConsent` rows, its
`ConsentVerificationChallenge` rows, and any blob under its pathname prefix.
A profile that reached `ACTIVE` is never touched by this job, whatever its age
(AC 22, second half). The query filters on `status`, so shortening the window in
configuration immediately widens the sweep on the next run (AC 23).

`CONSENT_WITHDRAWN` is excluded because it is a post-consent state: the data was
lawfully collected and its deletion is governed by (a)/(b)/(c) above, not by the
pre-consent window.

**`GET /api/cron/enforce-retention`** walks `RETENTION_POLICY`, the single
exported table in `lib/config.ts` that also renders the published policy page
(AC 44). Each row names a category, a window constant and a job step, so the
page and the job cannot drift, and changing a window changes both (AC 45).
For source files the anchor is **`Upload.extractedAt`, not `Upload.createdAt`**:
the window is "14 days after *successful extraction*", so the column is stamped
when an `Extraction` reaches `COMPLETE`, `COMPLETE_EMPTY` or `CONFIRMED`.
Uploads whose extraction failed terminally are deleted on the next run with no
window at all, per the spec's retention table. **The row and its extracted
problems survive** — the text is what M2 and M7 build on, and the photograph is
the sensitive part (M1 AC 36).

### 6. Deletion pseudonymises consent instead of destroying the audit trail.

`ParentalConsent` cascades from `StudentProfile`, so every path in §4 and §5
would otherwise destroy the evidence that collection was lawful. Before the
cascade, `deleteStudentData` writes one `ConsentAuditArtifact` per consent row:
`consentTextVersion`, `noticeVersion`, `method`, `submittedAt`, `verifiedAt`,
`withdrawnAt`, and `adultIdentityHash` — an HMAC-SHA256 of the account owner's
identifier under a server-held key, never the email itself and not reversible
without the key. It carries no `studentProfileId`, no name, no relationship, no
IP and no user agent (AC 50). It has no foreign keys, so it survives the purge,
and it carries `purgeAfter = now + CONSENT_AUDIT_RETENTION_DAYS` so the
retention job eventually removes it too.

**This is an ASSUMPTION, not law.** The research found no authoritative answer on
how long a consent record may be retained after deletion, and the spec marks
AC 50 as pending counsel. `CONSENT_AUDIT_RETENTION_DAYS` is therefore
configuration, and setting it to `0` degrades cleanly to "purged with everything
else" — the previous behaviour — without a schema change.

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
  on Hobby, where crons run daily. AC 46's "within the same operation or a job
  that completes within 24 hours" would be met only by the letter, and AC 48's
  "no recovery window" would be met not at all.
- **Rejected because:** the reconciler is a backstop for failures, not the
  mechanism. If it is the mechanism, there is no backstop.

### Enumerate the database and delete blobs that are marked deleted (a tombstone table)
- **Pros:** Cheaper than listing a whole store; no provider `list()` pagination.
- **Cons:** A tombstone is written from a code path that knows the pathname —
  which is exactly the code path that failed in the orphan scenario. It cannot
  see an object we never recorded.
- **Rejected because:** it is the row-driven approach wearing a different hat and
  is blind to the one case that matters.

### One deletion endpoint with a `reason` field, instead of two routes
- **Pros:** One route, one handler, one test. The destruction is identical
  anyway, so the second route is arguably ceremony.
- **Cons:** AC 48 requires confirmation copy that states the deletion is
  immediate and irreversible, and AC 49 requires the path to be reachable from
  the profile without closing the account. A shared route with a `reason` in the
  body makes the *client* responsible for saying which kind of request this was,
  which means our audit trail records what the browser claimed. It also makes it
  one careless refactor away from someone adding a `queued: true` branch.
- **Rejected because:** the evidentiary value of the distinction is the point,
  and a body field is the weakest possible place to keep it. Two routes calling
  one destructor costs about fifteen lines.

### Route the §312.6 deletion request through the account-closure soft delete
- **Pros:** One purge job. Symmetry. Recoverable if a parent changes their mind.
- **Cons:** This is the Amazon Alexa allegation almost exactly — undermining
  parents' deletion requests by not actually deleting. AC 48 forbids it in
  terms.
- **Rejected because:** it is the specific behaviour that drew a $25M penalty,
  and the spec now names it.

### Hard-delete the account immediately, no recovery window
- **Pros:** Honours the request instantly; no soft-deleted state to reason about;
  no purge job.
- **Cons:** No protection against an accidental or malicious closure of a
  family's entire history — including, notably, by a child who reached the
  parent's signed-in session.
- **Rejected because:** AC 47 specifies the window and requires it to be
  disclosed. The 30-day figure is a stated assumption with no regulator behind
  it, hence configuration. Note this is now defensible *only* because the
  §312.6 path exists beside it and is immediate.

### Mutate the consent row on withdrawal (set `withdrawnAt` in place)
- **Pros:** One row per profile; trivial "is consent current?" query.
- **Cons:** AC 24 requires the prior record's fields to be **unchanged in the
  database**. An in-place update destroys the evidence that consent was validly
  obtained at a point in time, which is the entire purpose of the record.
- **Rejected because:** it fails AC 24 literally and defeats the record's
  purpose.

### Append a second row to record verification instead of stamping `verifiedAt`
- **Pros:** Preserves a pure append-only invariant with no exceptions, which is
  easier to state and to review.
- **Cons:** AC 17 and AC 19 describe a single record carrying both timestamps,
  and AC 18 asks us to inspect *the record* and find `verifiedAt` null. Two rows
  make every read a join and make "the consent record" an ambiguous phrase in a
  document a regulator might read.
- **Rejected because:** the spec describes one record. The exception is narrow,
  conditional, idempotent, and the only `UPDATE` the table accepts.

### Soft-delete student profiles too (`deletedAt`) rather than hard-deleting
- **Pros:** Symmetry with account closure; recoverable.
- **Cons:** AC 31 requires a direct request for a deleted profile to return 404
  and AC 46 requires the objects to be gone; a soft-deleted profile whose files
  are deleted is a husk. Every subsequent query would need a `deletedAt: null`
  filter, and one forgotten filter leaks a deleted child's data. AC 48 forbids a
  recovery window on the §312.6 path outright.
- **Rejected because:** an easily forgotten filter on children's data is a worse
  risk than the lost undo.

### Purge pre-consent profiles by deleting only the fields, keeping the row
- **Pros:** Keeps a stub so the parent's abandoned flow can be resumed.
- **Cons:** AC 22 requires "that record, its age band, ... and any other data
  collected for the purpose of obtaining consent" to be deleted. An age band on
  a retained row keyed to an account is exactly the data the Microsoft/Xbox
  order targeted.
- **Rejected because:** the record itself is the thing to delete, and resuming an
  abandoned flow costs the parent one radio button.

## Consequences

### Positive
- There is exactly one control that can find an object the database has never
  heard of, and it is specified, testable against a fake storage adapter, and
  named as a compliance control so a reviewer will not treat it as a
  nice-to-have.
- "Delete my child's data" and "close my account" are different routes, with
  different copy, different audit kinds and different timelines, and the code
  cannot silently convert one into the other.
- The consent table is an audit log, so "what did this adult agree to, by what
  method, when was it corroborated, and when was it withdrawn?" is answerable
  historically, and M6 is a pure append.
- Deletion promises are honest at every intermediate state: `SOURCE_DELETED` is
  written before the bytes go.
- One `RETENTION_POLICY` table drives both the published page and the job, so
  the published policy cannot describe a window the code does not enforce.
- Every tunable a lawyer might change — recovery window, each retention tier,
  consent-audit window, pre-consent window — is one constant in one module.

### Negative / accepted trade-offs
- Deletion is multi-step and not atomic across two systems. There is no
  distributed transaction available; we choose the failure direction instead.
- **`verifiedAt` is a documented exception to append-only.** An invariant with an
  exception is weaker than one without. Mitigated by the `verified_at IS NULL`
  predicate, by confining the statement to `lib/consent/service.ts`, and by a
  reviewer grep for any other `parentalConsent.update`.
- The reconciler's cost grows with the size of the store, since it lists
  everything. Acceptable at M0/M1 scale; it will need prefix-partitioning by
  profile later.
- **Vercel Cron on the Hobby plan runs at most daily.** A 60-minute orphan
  threshold does not mean a 60-minute cleanup, and a 14-day pre-consent window
  is really "14 days plus up to one cron interval". AC 46/48's 24-hour bound is
  met; a tighter window needs Pro.
- A dangling `Upload` row pointing at a deleted object is possible. It renders as
  "source file removed" and its preview URL 404s.
- "Current consent" is a derived query, so `StudentProfile.status` is a
  denormalisation that must be written in the same transaction as the consent
  append or the two drift.
- A parent whose consent flow lapses past 14 days loses their partial progress
  with no warning. We accept it: the alternative is retaining a child's age band
  keyed to an account for longer than the FTC has accepted elsewhere. A
  reminder email before the purge is a product decision, not a design one.
- `ConsentAuditArtifact` is a table we may be told to drop entirely. It is
  isolated, has no relations, and its window defaults to configuration, so
  "drop it" is a config change plus one job step.

### Follow-up required
- [ ] Counsel on consent-record retention after deletion (M0 open questions).
      Until then `CONSENT_AUDIT_RETENTION_DAYS` is a guess and AC 50 is marked
      ASSUMPTION in the spec.
- [ ] `AUDIT_PSEUDONYM_KEY` must exist as a server-only secret before the first
      deletion runs; without it the artifact is either reversible or useless.
      Rotating it breaks correlation across artifacts — decide whether that is
      acceptable before rotating.
- [ ] Decide the Vercel plan, because it sets the achievable cron frequency.
- [ ] Confirm in the plan spike that `listAll()` exposes `uploadedAt` per object
      and supports cursor pagination — the reconciler depends on both.
- [ ] Verify with the provider whether deleting an object also purges CDN
      caches; the storage research explicitly did not cover this.
- [ ] **M1's spec still says 12 months from upload.** M0's tiered table
      supersedes it (14 days after successful extraction). M1 must be revised
      before it is built; that revision is not made here and is not made by this
      ADR.
- [ ] One manual end-to-end rehearsal of all three deletion paths on a preview
      deployment before any real family uses the product, including confirming
      that a §312.6 request leaves nothing behind that the closure job would
      have to finish.

## Revisit when

The store grows past what a full `list()` can sweep in one cron invocation; or
counsel returns an answer on consent retention; or a regulator specifies a
recovery window other than 30 days; or a second storage provider is added and
"enumerate the store" means enumerating two; or a milestone needs a second
`UPDATE` against `ParentalConsent`, which would mean this ADR's append-only rule
has stopped being true and should be superseded rather than eroded.
