# Spec: Accounts, student profiles, and parental consent

- **Status:** Draft
- **Date:** 2026-08-26
- **Author:** product-spec agent
- **Milestone:** M0
- **ADRs:** n/a — none written yet. The architect must produce ADRs for (a) the
  auth provider choice, (b) the blob storage choice, and (c) the verifiable
  parental consent method strategy before this is built;
  `docs/research/file-upload-storage.md` recommends Vercel private Blob but that
  is a recommendation, not a decision.

> **Revision note (2026-08-26).** This is a revision of the previous Draft,
> forced by `docs/research/coppa-childrens-privacy.md`. The previous draft
> treated an in-app checkbox attestation by the signed-in adult as verifiable
> parental consent. It is not: 16 CFR §312.5(b)(2) enumerates the accepted
> methods and every one of them independently corroborates the consenter — a
> self-asserted "I am the parent" field is none of them. The previous draft also
> created a student profile holding a child's name and grade *before* consent.
> The flow below therefore looks different on purpose: **neutral age gate →
> §312.4 direct notice → verifiable parental consent → only then collect profile
> fields.** Retention is tiered and published rather than a flat 12 months, the
> account-closure grace period is separated from a parent's §312.6 deletion
> request, and the §312.8 written security program now has an owner. Anyone
> tempted to simplify the ordering back should read the research first.
>
> **This spec is not legal advice and no lawyer has reviewed it.** The items
> marked **LAWYER** in Open questions are blocking for public launch with real
> children.

## Problem

A parent hears the app can help with their child's homework, opens it, and has
nowhere to put anything. There is no way to say who they are, no way to say who
the child is, what grade they are in, or which subjects they are struggling
with. Everything the product does later — practice tailored to a grade level, a
tutor that remembers this particular student, a voice the child picked — depends
on knowing which student is on the other side of the screen, and none of that
knowledge has anywhere to live.

Worse, the app cannot legally accept a photo of a nine-year-old's math homework
until a **verified** parent has said it may — and it cannot legally collect the
child's name and grade to ask the question with, either. Today there is no
adult, no child, no notice, and no record of permission. Nothing else in the
plan can ship until there is.

## Goal

An adult can create an account; a neutral age gate determines whether the
learner is a child before anything else about that learner is collected; a
parent receives the §312.4 direct notice and gives verifiable parental consent
by an enumerated §312.5(b)(2) method; only then are the student's display name,
grade, subjects and avatar collected — and the app has an authenticated,
authorized, private place to put a file, so M1 can accept an upload.

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
  consent artifact (a recorded statement, built to Illinois BIPA §15(b)). M0's
  consent record covers data processing only, and its schema must be versioned
  so M6 can add a scope without rewriting rows.
- **No age *estimation* or ID-scanning vendor at the age gate.** The gate is a
  neutral self-declared age band. Estimation and document checks belong to the
  consent *method*, not to the gate.
- **No student-facing login.** The account holder is an adult. A student profile
  is a profile, not a credential — there is no child username and no child
  password in M0.
- **No teacher, tutor, classroom, school or organization accounts.** One adult
  owner, N student profiles. No sharing, no invites, no multi-adult households.
  (This is also what keeps FERPA out of scope — see **Data touched**.)
- **No billing, plans, subscriptions or usage limits.** Note the dependency: if
  the payment-card consent method is chosen, billing becomes a prerequisite for
  M0 rather than a later milestone. See Open questions.
- **No password-based sign-in, no social sign-in, no MFA** — see the
  assumptions listed at the end of **Data touched**.
- **No admin console or internal moderation tooling.**
- **No email verification flow separate from sign-in** — the sign-in link
  proves control of the address. This is *not* the same thing as the
  confirmatory step in an email-plus consent method (AC 18).

## User stories

- As a parent, I want to create an account with my email, so that I can set my
  child up in the app without inventing another password.
- As a parent, I want to be asked how old my learner is before I am asked
  anything about them, so that a child's name and grade are not collected before
  I have agreed to anything.
- As a parent, I want to be told in plain language exactly what will be
  collected, who outside this company will see it, and how long it is kept,
  before it is collected, so that I am not surprised later.
- As a parent, I want to prove I am really the parent by a real method rather
  than ticking a box, so that nobody else can authorize the collection of my
  child's schoolwork.
- As a parent, I want to add a profile for my child with their grade level and
  the subjects they need help with, so that the app tutors at the right level.
- As a parent with two children, I want a separate profile for each, so that one
  child's work and progress never shows up under the other's name.
- As a student, I want to pick an avatar from a set of characters, so that the
  app feels like mine.
- As a parent, I want to withdraw permission and have my child's data deleted
  promptly, without it being turned into a 30-day countdown, so that "delete"
  means delete.
- As a parent who abandoned the consent flow, I want whatever you collected on
  the way to be thrown away, so that a half-finished signup does not become a
  permanent record about my child.
- As an adult learning on my own, I want to use the app without a
  parental-consent step, so that I am not treated as a child.
- As a security reviewer, I want a child's uploaded file to be unreachable
  without an authenticated, authorized request, so that a leaked or guessed URL
  does not expose a minor's schoolwork.

## Acceptance criteria

Profile status values used below: `NOTICE_PENDING` → `CONSENT_PENDING` →
`ACTIVE`, plus `CONSENT_WITHDRAWN`. (`CONSENT_REQUIRED` from the previous draft
is gone; it conflated "we have not given notice yet" with "notice given, consent
not verified", and the two now have different legal consequences.)

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
   (This is an age gate for the *account holder*. It carries no COPPA weight and
   is not consent.)

### Neutral age gate — before any information about the learner is collected

7. **Given** a newly created account, **when** the owner opens `/dashboard`,
   **then** zero student profiles are listed and an "add a student" call to
   action is present.
8. **Given** the owner starts "add a student", **when** the first step renders,
   **then** the only input offered is the learner's age band; no field for
   display name, grade level, subject or avatar exists anywhere in that step's
   DOM; no age band is preselected or marked as a default; and no copy on the
   step states or implies which selection unlocks more of the product.
9. **Given** the age gate, **when** the owner selects an under-18 band and
   submits, **then** a pending student record is created holding only the
   account id, the selected age band, a creation timestamp and status
   `NOTICE_PENDING`, and its display name, grade level, subjects and avatar
   fields are all empty in the database.
10. **Given** the age gate, **when** the owner selects the adult-learner (18+)
    band, **then** the profile-detail step is presented immediately, the created
    profile's status is `ACTIVE`, and neither a direct notice nor a consent step
    is shown.
11. **Given** a student record whose status is not `ACTIVE`, **when** a direct
    POST supplies a display name, grade level, subjects or avatar for it,
    **then** the response is HTTP 403 with the project's typed error shape and
    none of those values is persisted to any table.

### Direct notice to the parent (§312.4) — before consent, before collection

12. **Given** a student record in `NOTICE_PENDING`, **when** the owner proceeds,
    **then** a direct-notice screen is shown before any consent control is
    reachable, and it states: the specific items of personal information that
    will be collected from the child (uploaded schoolwork images and PDFs,
    extracted problem text, display name, grade level, subjects, avatar
    selection); how each is used; that the parent may review that information,
    refuse its further collection, and require its deletion, and how to do each;
    a link to the published retention policy (AC 43); and a link to the online
    privacy policy.
13. **Given** the direct-notice screen, **when** it is rendered, **then** it
    names each third party that receives the child's personal information and
    what each receives: **Anthropic** (reads the uploaded schoolwork and the
    extracted text), **Vercel** (stores the uploaded files), **Neon** (stores
    the database records), and the transactional email provider (the adult's
    email address only).
14. **Given** the direct notice is presented, **when** it is accepted or
    dismissed, **then** the same notice content is emailed to the account
    owner's address, and a notice record is written holding the notice **version
    identifier** and a UTC `sentAt`; **and when** the notice text is later
    changed, **then** it is served under a new version identifier and existing
    records still show the version that was actually served to them.
15. **Given** a student record with no notice record, **when** the consent step
    is requested or the consent endpoint is POSTed to directly, **then** the
    response is the typed error shape and no consent record is written.

### Verifiable parental consent (§312.5)

16. **Given** the deployed consent-method configuration names one supported
    §312.5(b)(2) method, **when** the configuration is changed to a different
    supported method, **then** new consent flows present the new method's steps,
    consent records written under the previous method remain readable, and
    profiles verified under the previous method remain `ACTIVE` with no data
    migration. (No method may be hard-coded into the profile, consent or upload
    code paths.)
17. **Given** a consent submission, **when** the record is inspected, **then** it
    contains: the consenting adult's name, their relationship to the student, the
    student record id, the consent scope list, the consent text version, the
    notice version from AC 14, the request IP address, the request user agent, a
    UTC `submittedAt`, a `method` drawn from an enumerated set of §312.5(b)(2)
    methods (`SIGNED_FORM`, `PAYMENT_CARD`, `TOLL_FREE_CALL`, `VIDEO_CALL`,
    `GOV_ID_CHECK`, `KBA`, `FMVPI`, `EMAIL_PLUS`, `TEXT_PLUS`), a
    `methodEvidence` value specific to that method (confirmation token,
    payment-processor transaction reference, vendor verification id, stored
    signed-form reference), and a `verifiedAt` field.
18. **Given** a consent submission where the method's corroborating step has not
    yet completed, **when** the record and the profile are inspected, **then**
    `verifiedAt` is null, the profile status is `CONSENT_PENDING`, and the
    profile is not `ACTIVE`.
19. **Given** a `CONSENT_PENDING` record, **when** the configured method's
    corroborating step completes (for `EMAIL_PLUS`, the confirmatory email's
    link is followed after the submission; for `PAYMENT_CARD`, the processor
    confirms a discrete transaction notified to the account holder; for a vendor
    method, the vendor returns a successful verification), **then** `verifiedAt`
    is set to a UTC timestamp that is distinct from and no earlier than
    `submittedAt`, and only then does the profile become `ACTIVE`.
20. **Given** a direct POST to the consent endpoint that supplies a name, a
    relationship and an affirmation of parenthood but no completed method
    evidence, **then** the response is the typed error shape, `verifiedAt`
    remains null, and the profile does not become `ACTIVE`.
21. **Given** the consent flow, **when** the owner declines it or abandons it,
    **then** no record with a non-null `verifiedAt` exists for that student, the
    student record stays in `NOTICE_PENDING` or `CONSENT_PENDING`, and no
    display name, grade level, subject or avatar value is persisted for it.
22. **Given** a student record that has not reached `ACTIVE` within the
    configured pre-consent retention window (**default 14 days**, read from
    configuration, not a literal), **when** the pre-consent purge job runs,
    **then** that record, its age band, any unverified consent record and any
    other data collected for the purpose of obtaining consent for it are
    deleted; **and** a record that did reach `ACTIVE` is left untouched.
23. **Given** the pre-consent retention window is reconfigured to a shorter
    value, **when** the purge job next runs, **then** records older than the new
    window are purged, demonstrating the window is configuration.
24. **Given** an `ACTIVE` under-18 profile, **when** the owner withdraws consent,
    **then** a new consent record with `withdrawnAt` set is appended, the prior
    record's fields are unchanged in the database, and the profile status becomes
    `CONSENT_WITHDRAWN`, which collects nothing further.

### Student profiles — collected only after consent is verified

25. **Given** a profile that is `ACTIVE`, **when** the owner submits a display
    name, a grade level, at least one subject and an avatar, **then** those
    values are stored and appear in the dashboard list exactly as submitted.
26. **Given** the profile-detail form, **when** the display name is empty or
    longer than 40 characters, **then** a field-level validation error is shown
    and no value is persisted.
27. **Given** a direct POST to the profile-detail endpoint carrying a grade level
    that is not in the allowed set, **then** the response is HTTP 400 with the
    typed error shape and nothing is persisted.
28. **Given** a direct POST carrying zero subjects, more than eight subjects, or
    a subject outside the allowed set, **then** the response is HTTP 400 and
    nothing is persisted.
29. **Given** the avatar picker, **when** the page is rendered, **then** the
    preset avatar options are shown, no file-input control for an avatar exists
    anywhere in the DOM, and a direct POST carrying an avatar identifier outside
    the preset set returns HTTP 400.
30. **Given** an existing profile, **when** the owner edits the display name,
    grade level, subjects or avatar and saves, **then** the changes persist
    across a page reload.
31. **Given** an existing profile, **when** the owner deletes it and confirms,
    **then** it disappears from the list and a direct request for that profile
    returns HTTP 404.
32. **Given** two accounts A and B each with a profile, **when** account A
    requests, edits or deletes account B's profile by its identifier, **then**
    the response is HTTP 404 and account B's row is unchanged.
33. **Given** an account with three profiles, **when** the dashboard is
    rendered, **then** exactly those three profiles are listed and no profile
    belonging to another account appears in the response payload.

### Storage plumbing (consumed by M1)

34. **Given** an unauthenticated request to the upload-authorization route,
    **when** it is made, **then** the response is HTTP 401 and no storage token
    is present anywhere in the response body.
35. **Given** an authenticated owner of account A, **when** they request an
    upload token naming a student profile belonging to account B, **then** the
    response is HTTP 403 and no storage token is issued.
36. **Given** a student record whose status is `NOTICE_PENDING`,
    `CONSENT_PENDING` or `CONSENT_WITHDRAWN`, **when** an upload token is
    requested for it, **then** the response is HTTP 403 with the typed error
    shape and no token is issued.
37. **Given** a valid token request for an `ACTIVE` profile, **when** the token
    is issued, **then** the enforced constraints are: private access, an
    allowed content-type list of exactly `image/jpeg`, `image/png`,
    `image/webp`, `application/pdf`, and a maximum size of 20 MB.
38. **Given** a client that ignores those constraints, **when** it attempts to
    store a 25 MB object or an object with content type `text/plain` using the
    issued token, **then** the storage layer rejects the write and no object is
    created.
39. **Given** a stored object, **when** its database record is inspected,
    **then** the record holds the storage *pathname* and not a fully-qualified
    URL, and the pathname is namespaced by the student profile id.
40. **Given** a stored object's private URL, **when** it is fetched with no
    credentials, **then** the response status is not 200 and the object's bytes
    are not returned.
41. **Given** a signed read URL minted by the app, **when** its expiry is
    inspected, **then** it is no more than 5 minutes in the future; and **when**
    it is requested after expiry, **then** the response status is not 200.
42. **Given** a signed URL minted for a read operation, **when** it is replayed
    as a write to the same pathname, **then** the write is rejected.
43. **Given** an object in the store that has no referencing database row and
    was created more than 60 minutes ago, **when** the reconciliation job runs,
    **then** that object is deleted, and an object that does have a referencing
    row is left untouched.

### Retention, deletion and the parent's §312.6 rights

44. **Given** a signed-out visitor, **when** they open the published retention
    policy URL, **then** the page renders without sign-in and lists every row of
    the retention table in **Data touched** — data category, purpose, stated
    business need, and deletion timeframe — and that page is linked from both
    the direct notice (AC 12) and the online privacy policy.
45. **Given** any retention window named in that table, **when** its
    configuration value is changed and the retention job is run, **then**
    records and stored objects in that category older than the new window are
    deleted and categories with other windows are unaffected. (Every window is
    configuration; no duration is a literal in application code.)
46. **Given** a student profile with stored objects, **when** the profile is
    deleted, **then** every object under that profile's pathname namespace is
    deleted from the store and every referencing database row is removed, within
    the same operation or a job that completes within 24 hours.
47. **Given** an **account closure** request, **when** it is confirmed, **then**
    the account enters a soft-deleted state for the configured recovery window
    (**default 30 days**) during which sign-in is refused; the confirmation
    screen states the length of that window and its purpose; and after the window
    all profiles, consent records, objects and database rows are purged, while an
    audit entry recording the request timestamp and completion timestamp
    survives the purge.
48. **Given** a **parental deletion request** for a student's personal
    information (§312.6), **when** it is confirmed, **then** the child's
    personal information is deleted with **no recovery window** — database rows
    at confirmation time and stored objects within 24 hours — the confirmation
    copy states that the deletion is immediate and irreversible, and the request
    is not converted into, queued behind, or satisfied by the account-closure
    soft-delete of AC 47.
49. **Given** a parental deletion request, **when** it completes, **then** the
    deletion path is reachable from the student profile without closing the
    account, and closing the account is not offered as the only way to delete a
    child's data.
50. **Given** a completed deletion under AC 47 or AC 48, **when** the consent
    records are inspected, **then** every child-identifying field is purged and
    only a pseudonymised audit artifact remains for the configured audit window
    — consent text version, notice version, `method`, `submittedAt`,
    `verifiedAt`, `withdrawnAt` and a one-way hash of the adult's identity.
    **ASSUMPTION**, pending the legal answer in Open questions.

### Compliance program (§312.8, §312.10) — documents, not code

51. **Given** the repository at the point M0 is declared done, **when**
    `docs/security-program.md` is opened, **then** it exists and contains: a
    named coordinating role responsible for the information security program, a
    dated risk assessment performed within the previous 12 months, a description
    of the safeguards and how they are tested, and a dated annual review entry
    within the previous 12 months.
52. **Given** the same document, **when** its vendor section is opened, **then**
    it contains a completed capability assessment for **Anthropic, Vercel, Neon
    and the transactional email provider**, each dated before the date any
    child's personal information is first sent to that vendor, recording the
    reasonable steps taken to determine that the vendor can maintain the
    confidentiality, security and integrity of children's personal information.

## Out of scope for this milestone

Built later; the architect should leave room for them but must not design them
in now:

- **M1** — the upload screen, HEIC conversion, and extraction of problems from
  an uploaded file. M0 must expose the token-minting boundary and the file
  record shape M1 will consume, and nothing more. **Note:** M1's flat 12-month
  source-file retention assumption is superseded by the tiered table below; M1's
  spec must be revised before it is built. That revision is not made here.
- **M2** — practice generation, mastery model, skill taxonomy. Grade level and
  subjects captured here will feed it; do not model mastery yet.
- **M3** — chat tutor and conversation history. The profile will later carry a
  learner profile used as a cached prompt prefix; do not add that field now.
- **M4/M5/M6** — whiteboard, narration, tutor personas, consent-gated voice
  cloning. M6 will extend the consent record with a new scope and a recorded
  audio artifact built to Illinois BIPA §15(b); version the consent schema so
  that is an append, not a migration of existing rows.
- **M7** — adaptive loop. Note that the "amass a profile on a specific
  individual" language in §312.2's internal-operations definition bears directly
  on M7; see Open questions.
- Multi-adult households, guardian invites, and account transfer.
- **The parent's §312.6(a)(1) *review* surface** — a read-only screen showing
  everything held about a student profile. This is a legal requirement, not a
  nice-to-have, and M0 does not build it. It is listed here so it is not
  forgotten and so the architect does not design it out. It is blocking for
  public launch, not for building M0, because M0 stores almost nothing yet;
  the moment M1 stores uploaded schoolwork it becomes urgent.
- Data export / portability as a *file*. The review right above can be satisfied
  by a screen.
- Localization of the consent text and the direct notice.
- Any school, district or classroom offering. That offering would change the
  legal analysis wholesale — school consent, state student-privacy statutes, and
  FERPA all switch on — and would need its own research and its own spec.

## Open questions

Items marked **LAWYER** need a qualified privacy attorney, not a product
decision. Items marked **PRODUCT** are ours to decide.

- [ ] **LAWYER — Is sending a child's schoolwork to Anthropic a "disclosure"
  under §312.2, or is Anthropic a "service provider providing support for the
  internal operations"?** This decides everything about cost and friction: if
  there is no disclosure, the near-free `EMAIL_PLUS` / `TEXT_PLUS` methods are
  available; if there is, we need `PAYMENT_CARD` or a vendor identity method.
  The internal-operations list is closed and its own text forbids using such
  data "to amass a profile on a specific individual", which is literally M7.
  Put it to counsel with the Anthropic commercial terms in hand. **Blocking for
  public launch with real children; non-blocking for building M0**, because
  AC 16 requires the method to be swappable.
- [ ] **PRODUCT — which method ships first, and what does it cost?** If
  `PAYMENT_CARD` is chosen, billing stops being a later milestone and becomes an
  M0 dependency (the Rule requires notification of a *discrete transaction*; a
  stored card is not enough). If a vendor method is chosen, someone must get
  actual quotes. Do not ship KBA as the only path — its failure modes fall on
  thin-credit-file, immigrant and young parents. **Blocking before M0 is
  declared done.**
- [ ] **LAWYER — are we "mixed audience" or "child-directed"?** The FTC's
  2026-02-25 age-verification enforcement policy statement, which is what makes
  the pre-consent age gate in AC 8–9 safe, names general-audience and
  mixed-audience operators. If we are found child-directed it may not shelter us
  at all. It is also a policy statement, not a rule — it does not bind state AGs.
  **Blocking for public launch.**
- [ ] **LAWYER — how long may a consent record be retained after deletion?**
  AC 50 proposes purging child-identifying fields and keeping a pseudonymised
  audit artifact. The research found no authoritative answer; this is our
  reasoning, not law. Non-blocking for the build because the window is
  configuration.
- [ ] **LAWYER + PRODUCT — what is the source-file retention window?** The table
  below says "14 days after successful extraction" as an ASSUMPTION. The
  business need is re-extraction after a failure and letting a parent see a
  recent upload; neither justifies months. **Knock-on effect on M1:** M1's AC 36
  and its Data-touched section both assume **12 months**, and its own open
  question flags the number as a guess. That assumption is superseded by this
  spec. M1 must be revised before it is built — deliberately not edited here.
- [ ] **PRODUCT, write it down — is children's data ever used to train,
  fine-tune, or evaluate any model?** Given Amazon Alexa ($25M, largely for
  exactly this), the defensible answer is an unambiguous no, contractually
  enforced against Anthropic and, later, ElevenLabs. Undecided is worse than
  either answer. **Blocking before any child data flows.**
- [ ] **PRODUCT — who is the named information-security coordinator (AC 51)?**
  On a small team this is a person, not a department. **Blocking for AC 51.**
- [ ] **Does client-side `upload()` with `access: 'private'` work end to end?**
  Nothing is installed in this repo, so every Vercel Blob signature in
  `docs/research/file-upload-storage.md` is documentation-derived and unverified.
  If private stores turn out to constrain browser uploads, the entire storage
  design here and all of M1 changes. Resolve with a timeboxed spike — install
  `@vercel/blob`, read `node_modules/@vercel/blob/dist/index.d.ts`, create a
  private store, and confirm an unauthenticated fetch of the private URL fails —
  **before** any of AC 34–43 is implemented. **BLOCKING.**
- [ ] **Which auth provider?** `.env.example` already contains commented
  `AUTH_SECRET` / `AUTH_URL` entries, implying Auth.js, but nothing is
  installed and the project constitution forbids adding a major dependency
  without the owner's approval. Needs an ADR and an explicit approval.
  **BLOCKING.**
- [ ] **Approval for `@vercel/blob` as a dependency.** Same constitutional rule.
  **BLOCKING.**
- [ ] **PRODUCT — is 14 days the right pre-consent purge window (AC 22)?** It is
  taken from the FTC's Microsoft/Xbox order, which is an order against another
  company rather than a rule of general application. It is the clearest
  available signal. Non-blocking; the window is configuration.
- [ ] Where is the reconciliation job in AC 43 triggered from — Vercel Cron, or
  on-demand at upload time? Affects nothing user-facing. Non-blocking.
- [ ] Should the grade-level list cover non-US school systems at launch?
  Non-blocking.

## Data touched

**Which law governs.** COPPA (16 CFR part 312, as amended 2025; full compliance
required since 2026-04-22) governs everything below. **FERPA does not apply to
this design** and will not until a school or district contracts with us and
exercises direct control over the records — there is no school in this
direct-to-consumer flow, and nothing here is an "education record maintained by
an educational agency". Claiming otherwise obscures the obligations that are
real. Illinois BIPA is the binding constraint on M6, not on M0.

**Personal data written by this feature**

| Data | Subject | Sensitivity | Where |
|---|---|---|---|
| Email address | Adult account owner | Personal, identifying | Postgres (Neon) |
| Sign-in tokens / session records | Adult account owner | Credential material | Postgres |
| Age band (pre-consent) | Learner | Personal; implies age. Collected solely to determine whether the learner is a child | Postgres |
| Display name | Student, frequently a minor | Personal, identifying | Postgres |
| Grade level | Student, frequently a minor | Personal; implies age | Postgres |
| Subjects | Student | Low, but indicates academic difficulty | Postgres |
| Avatar selection | Student | Not personal — a preset identifier, not an image of the child | Postgres |
| Direct-notice record (version, sentAt) | Adult | Low; compliance evidence | Postgres |
| Consent record: adult's name, relationship, method, methodEvidence, submittedAt, verifiedAt, IP, user agent | Adult (references the student id) | Personal; evidence of lawful basis | Postgres |
| Blob object pathnames | Student (points at their schoolwork) | Reference to sensitive data | Postgres |

**Transmitted to third parties in M0:** the account owner's email address goes
to the transactional email provider for sign-in links and, under an
`EMAIL_PLUS` method, for the direct notice and the confirmatory consent message.
If `TEXT_PLUS` is chosen, a phone number goes to an SMS provider; if
`PAYMENT_CARD` or a vendor identity method is chosen, the adult's payment or
identity data goes to that processor or vendor. **No student data is transmitted
to any third party in M0** — no AI vendor, no analytics. Uploaded file bytes do
not exist yet; the store is provisioned but empty. The direct notice must
nevertheless name Anthropic, Vercel and Neon, because it describes what will be
collected and disclosed once M1 ships (AC 13).

**Never stored:** student email addresses, student passwords, date of birth to
day precision (an age band is sufficient and is what AC 9 keys off), any
photograph of the student, any voice recording, any government ID image beyond
the vendor's own transient processing.

### Retention — the published policy (§312.10)

§312.10 requires a **written** retention policy stating, for each category, the
purpose of collection, the business need for retaining it, and a deletion
timeframe — and requires that policy to appear in the notice to parents, i.e.
published, not internal. AC 44 tests that it is actually reachable. Every window
is configuration (AC 45).

| Data category | Retention window | Stated business need |
|---|---|---|
| Age band collected before consent, and any other data collected for the purpose of obtaining consent, where consent is never verified | **14 days** from creation, then purged (AC 22) | Give the parent a reasonable period to complete consent; nothing justifies keeping it beyond that. **ASSUMPTION**, from the FTC's Microsoft/Xbox order |
| Uploaded schoolwork image or PDF (raw source, M1) | **14 days after successful extraction**; deleted immediately on extraction failure once retried or abandoned | Re-extraction after a failed or low-confidence pass, and letting a parent see a recent upload. Neither need survives the fortnight. **ASSUMPTION** — supersedes M1's 12 months |
| Extracted problem text | Life of the `ACTIVE` profile | It is the tutoring product; M2 and M7 build on it |
| Display name, grade level, subjects, avatar | Life of the `ACTIVE` profile | Account function and tutoring at the right level |
| Mastery / strengths-and-weaknesses record (M7) | Life of the `ACTIVE` profile | Adaptive tutoring — the core value proposition |
| Direct-notice record (version, sentAt) | Audit window after deletion (configuration) | Evidence that §312.4 notice was given before collection |
| Consent record, full | Life of the `ACTIVE` profile | Evidence of the lawful basis for collecting |
| Consent record, pseudonymised (AC 50) | Configured audit window after deletion | Auditability without retaining data about the child. **ASSUMPTION** — needs counsel |
| Account and session records | Life of the account; sign-in tokens expire on use or at their short TTL | Authentication |
| Soft-deleted account after a closure request | **30 days**, then hard purge (AC 47) | Protect families against accidental or malicious account deletion. Disclosed to the parent at confirmation. Applies to **closure only** |
| Audit entry for a deletion (request and completion timestamps) | Configured audit window | Proving deletions were performed |

**The 30 days is a closure recovery window and nothing else.** As a soft-delete
after the account holder closes their own account, disclosed and with a stated
business need, it is defensible. As a delay on a parent's §312.6 deletion
request it is the Amazon Alexa fact pattern that drew a $25M penalty. AC 47 and
AC 48 are therefore two paths with two timelines, and AC 48 explicitly forbids
routing the second into the first.

**Deletion.** Five paths, all specified above, all of which must remove objects
from blob storage and not only database rows: the pre-consent purge (AC 22),
delete a single student profile (AC 46), withdraw consent (AC 24 — stops further
collection but does not by itself delete), the parent's §312.6 deletion request
(AC 48, prompt, no grace period), and account closure (AC 47, 30-day recovery
then purge).

**The orphaned-blob problem.** If a client upload succeeds but the database
write fails, a file containing a minor's schoolwork sits in storage referenced
by nothing. It is invisible to every deletion path above, because every one of
them walks from a database row to a pathname. A parent who asks us to delete
everything would be told, truthfully and wrongly, that we had. AC 43 exists
solely for this: reconciliation must enumerate the *store* and delete objects
with no referencing row, rather than enumerating the database. This is a
compliance control, not housekeeping, and must not be dropped for scope.

**ASSUMPTIONS made in this spec** (each was a guess, none was stated by the
requester):

- Sign-in is passwordless email magic link. Chosen because `.env.example`
  references Auth.js and because a password is one more thing for a parent to
  lose; not confirmed.
- The account owner is always an adult and self-attests to being 18+ (AC 6).
  This is an account-holder gate with no COPPA weight.
- An adult can also be the learner, in which case they create an adult-learner
  profile for themselves (AC 10).
- The age gate collects an **age band only** — not a grade level — so that the
  pre-consent collection is as close to single-purpose as possible under the
  FTC's 2026-02-25 policy statement. Grade level is collected with the rest of
  the profile, after consent. This is a change from the previous draft, which
  derived under-18 status from grade level at profile-creation time.
- Consent is required for every under-18 learner, not only under-13s. COPPA's
  line is 13; the previous draft's 18 line is kept because it is stricter, it is
  simpler to explain to a parent, and several state minor-privacy statutes reach
  above 13.
- No full date of birth is ever collected.
- Grade levels are an enumerated set covering US K–12 plus "adult learner".
- Subjects are a fixed enumerated set, multi-select, 1–8 selections.
- The preset avatar set is app-bundled artwork identified by a stable string id.
- Consent covers data processing only; voice cloning consent is a separate,
  later scope with a different legal basis (BIPA).
- The 20 MB and 5-minute figures in AC 37 and AC 41 are product decisions
  derived from the storage research's file-size range and its warning that
  signed URLs are bearer credentials; neither was specified by the requester.
- The written security program and vendor assessment live at
  `docs/security-program.md`. The path is a guess; the artifact is required.
