# Spec: Accounts, student profiles, and parental consent

- **Status:** Draft
- **Date:** 2026-08-26
- **Author:** product-spec agent
- **Milestone:** M0
- **ADRs:** n/a — none written yet. The architect must produce ADRs for (a) the
  auth provider choice and (b) the blob storage choice before this is built;
  `docs/research/file-upload-storage.md` recommends Vercel private Blob but that
  is a recommendation, not a decision.

## Problem

A parent hears the app can help with their child's homework, opens it, and has
nowhere to put anything. There is no way to say who they are, no way to say who
the child is, what grade they are in, or which subjects they are struggling
with. Everything the product does later — practice tailored to a grade level, a
tutor that remembers this particular student, a voice the child picked — depends
on knowing which student is on the other side of the screen, and none of that
knowledge has anywhere to live.

Worse, the app cannot legally accept a photo of a nine-year-old's math homework
until an adult has said it may. Today there is no adult, no child, and no record
of permission. Nothing else in the plan can ship until there is.

## Goal

An adult can create an account, add one or more student profiles with a grade
level, subjects and a chosen avatar, record parental consent for any student
under 18, and the app has an authenticated, authorized, private place to put a
file — so M1 can accept an upload.

## Non-goals

Things a reader will reasonably assume are in here and are not:

- **No file upload UI.** M0 builds the storage *plumbing* — the private store,
  the authorization boundary that mints an upload token, the database record
  shape, the deletion and orphan-cleanup paths. The upload screen, the file
  picker, the progress bar and HEIC conversion are all M1.
- **No AI of any kind.** No Anthropic SDK, no key, no vision call. Nothing in M0
  reads a piece of schoolwork.
- **No practice problem generation** (M2), **no chat tutor** (M3), **no
  whiteboard** (M4), **no narration or voice selection** (M5/M6), **no mastery
  or progress tracking** (M7).
- **No custom avatar upload.** Avatars are a fixed, app-bundled preset set. A
  child-uploaded avatar photo is a picture of a minor's face and a materially
  different privacy problem; it is not in this milestone and may never be.
- **No parent voice recording or consent-to-clone.** M6 needs a *different*
  consent artifact (a recorded statement). M0's consent record covers data
  processing only, and its schema must be versioned so M6 can add a scope
  without rewriting rows.
- **No student-facing login.** The account holder is an adult. A student profile
  is a profile, not a credential — there is no child username and no child
  password in M0.
- **No teacher, tutor, classroom, school or organization accounts.** One adult
  owner, N student profiles. No sharing, no invites, no multi-adult households.
- **No billing, plans, subscriptions or usage limits.**
- **No password-based sign-in, no social sign-in, no MFA** — see the
  assumptions listed at the end of **Data touched**.
- **No admin console or internal moderation tooling.**
- **No email verification flow separate from sign-in** — the sign-in link
  proves control of the address.

## User stories

- As a parent, I want to create an account with my email, so that I can set my
  child up in the app without inventing another password.
- As a parent, I want to add a profile for my child with their grade level and
  the subjects they need help with, so that the app tutors at the right level.
- As a parent with two children, I want a separate profile for each, so that one
  child's work and progress never shows up under the other's name.
- As a student, I want to pick an avatar from a set of characters, so that the
  app feels like mine.
- As a parent, I want to be told plainly what data the app will collect about my
  child and to actively grant permission, so that I am not surprised later.
- As a parent, I want to withdraw that permission and delete everything, so that
  I am not locked into a decision I made once.
- As an adult learning on my own, I want to use the app without a
  parental-consent step, so that I am not treated as a child.
- As a security reviewer, I want a child's uploaded file to be unreachable
  without an authenticated, authorized request, so that a leaked or guessed URL
  does not expose a minor's schoolwork.

## Acceptance criteria

### Authentication

1. **Given** a signed-out visitor, **when** they request `/dashboard`, **then**
   they are redirected to `/sign-in` and no account data appears in the
   response body.
2. **Given** a visitor on `/sign-in`, **when** they submit a syntactically valid
   email address, **then** a sign-in email is dispatched to exactly that address
   and the page shows a "check your email" state that does not reveal whether an
   account already existed for that address.
3. **Given** a valid, unused sign-in link, **when** it is opened, **then** a
   session is established and the session cookie is `HttpOnly`, `SameSite=Lax`,
   and `Secure` when served over HTTPS.
4. **Given** a sign-in link that has already been used once, or that is older
   than its expiry, **when** it is opened, **then** no session is created and an
   error state is shown.
5. **Given** a signed-in user, **when** they sign out, **then** the session is
   invalidated server-side and a subsequent request to `/dashboard` with the old
   cookie redirects to `/sign-in`.
6. **Given** the sign-up form, **when** the visitor does not affirm that they are
   18 or older, **then** the account is not created and no `User` row is written.

### Student profiles

7. **Given** a newly created account, **when** the owner opens `/dashboard`,
   **then** zero student profiles are listed and an "add a student" call to
   action is present.
8. **Given** the add-profile form, **when** the owner submits a display name, a
   grade level, at least one subject and an avatar, **then** a student profile is
   created and appears in the dashboard list with exactly those values.
9. **Given** the add-profile form, **when** the display name is empty or longer
   than 40 characters, **then** a field-level validation error is shown and no
   profile row is created.
10. **Given** a direct POST to the profile-creation endpoint carrying a grade
    level that is not in the allowed set, **then** the response is HTTP 400 with
    the project's typed error shape and no profile row is created.
11. **Given** a direct POST carrying zero subjects, more than eight subjects, or
    a subject outside the allowed set, **then** the response is HTTP 400 and no
    profile row is created.
12. **Given** the avatar picker, **when** the page is rendered, **then** the
    preset avatar options are shown, no file-input control for an avatar exists
    anywhere in the DOM, and a direct POST carrying an avatar identifier outside
    the preset set returns HTTP 400.
13. **Given** an existing profile, **when** the owner edits the display name,
    grade level, subjects or avatar and saves, **then** the changes persist
    across a page reload.
14. **Given** an existing profile, **when** the owner deletes it and confirms,
    **then** it disappears from the list and a direct request for that profile
    returns HTTP 404.
15. **Given** two accounts A and B each with a profile, **when** account A
    requests, edits or deletes account B's profile by its identifier, **then**
    the response is HTTP 404 and account B's row is unchanged.
16. **Given** an account with three profiles, **when** the dashboard is
    rendered, **then** exactly those three profiles are listed and no profile
    belonging to another account appears in the response payload.

### Parental consent

17. **Given** the add-profile form, **when** the owner selects a grade level or
    age band that indicates the student is under 18, **then** the profile is
    created with status `CONSENT_REQUIRED` and the dashboard shows it as "action
    needed".
18. **Given** a profile in status `CONSENT_REQUIRED`, **when** the owner opens
    the consent flow, **then** the screen states in plain language what data is
    collected (uploaded schoolwork, extracted problem text, the student's
    display name and grade), who processes it, and how long it is kept.
19. **Given** the consent flow, **when** the owner supplies their full name and
    relationship to the student and affirms consent, **then** a
    `ParentalConsent` record is written containing: consenting adult's name,
    relationship, the student profile id, the consent scope list, a consent text
    version identifier, a UTC timestamp, the request IP address and user agent.
20. **Given** a completed consent record, **when** the dashboard is reloaded,
    **then** the profile status is `ACTIVE`.
21. **Given** the consent flow, **when** the owner declines or abandons it,
    **then** the profile remains `CONSENT_REQUIRED` and no `ParentalConsent`
    record is written.
22. **Given** a profile marked as an adult learner (18+), **when** it is
    created, **then** its status is `ACTIVE` immediately and no consent flow is
    presented.
23. **Given** an `ACTIVE` under-18 profile, **when** the owner withdraws
    consent, **then** a new consent record with `withdrawnAt` set is appended,
    the prior record's fields are unchanged in the database, and the profile
    returns to `CONSENT_REQUIRED`.
24. **Given** a profile that has returned to `CONSENT_REQUIRED` after
    withdrawal, **when** an upload token is requested for it, **then** the
    request is denied (see AC 30).

### Storage plumbing (consumed by M1)

25. **Given** an unauthenticated request to the upload-authorization route,
    **when** it is made, **then** the response is HTTP 401 and no storage token
    is present anywhere in the response body.
26. **Given** an authenticated owner of account A, **when** they request an
    upload token naming a student profile belonging to account B, **then** the
    response is HTTP 403 and no storage token is issued.
27. **Given** a valid token request for an `ACTIVE` profile, **when** the token
    is issued, **then** the enforced constraints are: private access, an
    allowed content-type list of exactly `image/jpeg`, `image/png`,
    `image/webp`, `application/pdf`, and a maximum size of 20 MB.
28. **Given** a client that ignores those constraints, **when** it attempts to
    store a 25 MB object or an object with content type `text/plain` using the
    issued token, **then** the storage layer rejects the write and no object is
    created.
29. **Given** a stored object, **when** its database record is inspected,
    **then** the record holds the storage *pathname* and not a fully-qualified
    URL, and the pathname is namespaced by the student profile id.
30. **Given** an under-18 profile in status `CONSENT_REQUIRED`, **when** an
    upload token is requested for it, **then** the response is HTTP 403 with the
    typed error shape and no token is issued.
31. **Given** a stored object's private URL, **when** it is fetched with no
    credentials, **then** the response status is not 200 and the object's bytes
    are not returned.
32. **Given** a signed read URL minted by the app, **when** its expiry is
    inspected, **then** it is no more than 5 minutes in the future; and **when**
    it is requested after expiry, **then** the response status is not 200.
33. **Given** a signed URL minted for a read operation, **when** it is replayed
    as a write to the same pathname, **then** the write is rejected.
34. **Given** an object in the store that has no referencing database row and
    was created more than 60 minutes ago, **when** the reconciliation job runs,
    **then** that object is deleted, and an object that does have a referencing
    row is left untouched.
35. **Given** a student profile with stored objects, **when** the profile is
    deleted, **then** every object under that profile's pathname namespace is
    deleted from the store and every referencing database row is removed, within
    the same operation or a job that completes within 24 hours.
36. **Given** an account deletion request, **when** it is confirmed, **then** the
    account enters a 30-day soft-deleted state during which sign-in is refused,
    and after the grace period all profiles, consent records, objects and
    database rows are purged; an audit entry recording the request timestamp and
    completion timestamp survives the purge.

## Out of scope for this milestone

Built later; the architect should leave room for them but must not design them
in now:

- **M1** — the upload screen, HEIC conversion, and extraction of problems from
  an uploaded file. M0 must expose the token-minting boundary and the file
  record shape M1 will consume, and nothing more.
- **M2** — practice generation, mastery model, skill taxonomy. Grade level and
  subjects captured here will feed it; do not model mastery yet.
- **M3** — chat tutor and conversation history. The profile will later carry a
  learner profile used as a cached prompt prefix; do not add that field now.
- **M4/M5/M6** — whiteboard, narration, tutor personas, consent-gated voice
  cloning. M6 will extend the consent record with a new scope and a recorded
  audio artifact; version the consent schema so that is an append, not a
  migration of existing rows.
- **M7** — adaptive loop.
- Multi-adult households, guardian invites, and account transfer.
- Data export / portability (a likely regulatory requirement, deliberately
  deferred and named here so it is not forgotten).
- Localization of the consent text.

## Open questions

- [ ] **Does client-side `upload()` with `access: 'private'` work end to end?**
  Nothing is installed in this repo, so every Vercel Blob signature in
  `docs/research/file-upload-storage.md` is documentation-derived and unverified.
  The research explicitly names this as load-bearing and unconfirmed. If private
  stores turn out to constrain browser uploads, the entire storage design here
  and all of M1 changes. Resolve with a timeboxed spike — install
  `@vercel/blob`, read `node_modules/@vercel/blob/dist/index.d.ts`, create a
  private store, and confirm an unauthenticated fetch of the private URL fails —
  **before** any of AC 25–36 is implemented. **BLOCKING.**
- [ ] **Is an in-app attestation sufficient verifiable parental consent under
  COPPA?** The flow specified in AC 17–23 is an attestation by a signed-in
  adult. COPPA's verifiable-parental-consent standard may require a stronger
  method (small credit-card charge, government ID check, signed form, or the
  "email plus" method) depending on how the data is used and disclosed. No legal
  review has happened. **Blocking for public launch with real minors;
  non-blocking for building M0**, provided the consent record carries a version
  identifier so a stronger method can be added as a new version.
- [ ] **Which auth provider?** `.env.example` already contains commented
  `AUTH_SECRET` / `AUTH_URL` entries, implying Auth.js, but nothing is
  installed and the project constitution forbids adding a major dependency
  without the owner's approval. Needs an ADR and an explicit approval.
  **BLOCKING.**
- [ ] **Approval for `@vercel/blob` as a dependency.** Same constitutional rule.
  **BLOCKING.**
- [ ] **How long must a consent record be retained after the family deletes
  their account?** AC 36 purges everything except an audit entry. A consent
  record is simultaneously the evidence that we were allowed to process a
  child's data and itself a record about that child. Keeping it conflicts with
  the deletion promise; destroying it conflicts with auditability. Needs the
  legal answer, not an engineering guess. Non-blocking for the build if the
  retention window is stored as configuration rather than hardcoded.
- [ ] Where is the reconciliation job in AC 34 triggered from — Vercel Cron, or
  on-demand at upload time? Affects nothing user-facing. Non-blocking.
- [ ] Should the grade-level list cover non-US school systems at launch?
  Non-blocking.

## Data touched

**Personal data written by this feature**

| Data | Subject | Sensitivity | Where |
|---|---|---|---|
| Email address | Adult account owner | Personal, identifying | Postgres (Neon) |
| Sign-in tokens / session records | Adult account owner | Credential material | Postgres |
| Display name | Student, frequently a minor | Personal, identifying | Postgres |
| Grade level, age band | Student, frequently a minor | Personal; implies age | Postgres |
| Subjects | Student | Low, but indicates academic difficulty | Postgres |
| Avatar selection | Student | Not personal — a preset identifier, not an image of the child | Postgres |
| Consenting adult's name and relationship | Adult | Personal, identifying | Postgres |
| Consent IP address and user agent | Adult | Personal; retained as consent evidence | Postgres |
| Blob object pathnames | Student (points at their schoolwork) | Reference to sensitive data | Postgres |

**Transmitted to third parties:** the account owner's email address goes to the
transactional email provider for sign-in links. **No student data is transmitted
to any third party in M0** — no AI vendor, no analytics. Uploaded file bytes do
not exist yet; the store is provisioned but empty.

**Never stored:** student email addresses, student passwords, date of birth to
day precision (an age band is sufficient and is what AC 17 keys off), any
photograph of the student, any voice recording.

**Retention.** Account and profile data are retained while the account is
active. Following a deletion request the account is soft-deleted for 30 days —
a recovery window against accidental or malicious deletion — and hard-purged
after (AC 36). Sign-in tokens expire on use or at their short TTL. Consent
records are retained as long as the account is active; retention after account
deletion is an open question above and must be stored as configuration.
**ASSUMPTION:** 30 days is the grace period; no regulator has specified one.

**Deletion.** Three paths, all specified above: delete a single student profile
(AC 35, cascades to that student's stored objects), withdraw consent (AC 23,
blocks further collection and returns the profile to a non-collecting state),
and delete the whole account (AC 36). All three must remove objects from blob
storage, not only database rows.

**The orphaned-blob problem.** If a client upload succeeds but the database
write fails, a file containing a minor's schoolwork sits in storage referenced
by nothing. It is invisible to every deletion path above, because every one of
them walks from a database row to a pathname. A parent who asks us to delete
everything would be told, truthfully and wrongly, that we had. AC 34 exists
solely for this: reconciliation must enumerate the *store* and delete objects
with no referencing row, rather than enumerating the database. This is a
compliance control, not housekeeping, and must not be dropped for scope.

**ASSUMPTIONS made in this spec** (each was a guess, none was stated by the
requester):

- Sign-in is passwordless email magic link. Chosen because `.env.example`
  references Auth.js and because a password is one more thing for a parent to
  lose; not confirmed.
- The account owner is always an adult and self-attests to being 18+ (AC 6).
- An adult can also be the learner, in which case they create an adult-learner
  profile for themselves (AC 22).
- Under-18 status is derived from the selected grade level plus an explicit age
  band, not from a full date of birth, to avoid collecting a precise DOB.
- Grade levels are an enumerated set covering US K–12 plus "adult learner".
- Subjects are a fixed enumerated set, multi-select, 1–8 selections.
- The preset avatar set is app-bundled artwork identified by a stable string id.
- Consent covers data processing only; voice cloning consent is a separate,
  later scope.
- The 20 MB and 5-minute figures in AC 27 and AC 32 are product decisions
  derived from the storage research's file-size range and its warning that
  signed URLs are bearer credentials; neither was specified by the requester.
