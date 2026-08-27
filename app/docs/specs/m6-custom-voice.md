# Spec: Custom voice

- **Status:** Draft
- **Date:** 2026-08-27
- **Author:** product-spec agent
- **Milestone:** M6
- **ADRs:** n/a — none written yet. The architect must produce ADRs for (a) how
  the recorded-consent artifact is captured, stored and bound to a created voice,
  and (b) how an account-owned persona is isolated from the shared persona set.
  Depends on M5's persona ADR, ADR-0003 (private blob storage), ADR-0007
  (append-only consent) and ADR-0008 (consent method interface). Research:
  [elevenlabs-tts.md](../research/elevenlabs-tts.md).

## Problem

A seven-year-old will sit still for a parent's voice in a way they will not for a
stranger's. Parents who travel, who work nights, or who cannot sit down at
homework time every evening want to be in the room anyway, and the app is already
speaking to their child every day in somebody else's voice. The feature is
obvious and it is also the single most abusable thing in the product: the same
mechanism that lets a mother narrate her daughter's fractions lesson lets a child
upload a recording of a classmate, a teacher, or a YouTuber.

## Goal

An account owner can record their own voice, with a recorded consent statement,
and have it become a tutor persona available only to the student profiles in
their own account — while it remains structurally impossible for a student to
clone their own voice or anyone else's.

## Non-goals

Named because a reader will assume several of these are here, and because two of
them are hard prohibitions rather than deferrals:

- **A student may never clone a voice. Not their own, not a friend's, not a
  parent's.** The provider's policy bars voice data from anyone under 18
  outright, which is stricter than the celebrity-impersonation concern and admits
  no exception for consent. There is no student-facing entry point to this
  feature at all (AC 2, AC 3).
- **No cloning of a third party.** Not a grandparent, not a sibling, not a
  teacher, not a public figure, not a fictional character, not a voice from a
  video. The sample is recorded live, in-app, by the signed-in account owner
  (AC 4). **There is no file-upload path for a voice sample** — not as a
  convenience, not as a fallback, not for support cases.
- **No voice sharing between accounts.** A cloned voice is visible only to its
  own account's profiles (AC 12). No marketplace, no library, no gifting, no
  "use grandma's voice" invite flow.
- **No professional-grade cloning.** The high-fidelity cloning product available
  in this category can only ever clone the speaker's own voice, needs hours of
  audio and a manual verification step; it is not the mechanism here.
- **No use of a cloned voice outside lesson narration.** Not in chat, not in
  emails, not in marketing, not in notifications.
- **No voice editing, emotion controls, accent adjustment, or style transfer.**
- **No voice as authentication.** A voice sample is never a credential.
- **No re-recording to improve an existing clone** — delete and start again.
- **No transcription of the sample or the consent statement**, and no other
  processing of the recorded audio beyond creating the voice.
- **No changes to M5's playback, caching or sync.** A custom voice is a persona
  row; everything downstream is unchanged.

## User stories

- As a parent, I want to record my own voice and have it teach my child, so that
  I am there at homework time even when I am not.
- As a parent, I want to say out loud that I consent, and know that recording is
  kept, so that it is clear this was me and I agreed to it.
- As a parent, I want to hear the sample back before it is sent anywhere, so that
  I am not committing a bad recording to something permanent.
- As a parent, I want my child to be told the voice is a computer copy of me, so
  that they are not confused about whether I am actually speaking.
- As a parent, I want to delete my voice and have it gone from the app and from
  the vendor, so that "delete" means delete.
- As a parent, I want to be certain my child cannot record themselves or a friend
  into this, so that the app is not a deepfake toy in a schoolbag.
- As a student, I want to pick my parent's voice or a regular tutor voice
  depending on the day, so that it is still my choice.
- As a security reviewer, I want the under-18 prohibition enforced by the
  structure of the flow rather than by a warning message, so that it cannot be
  clicked past.

## Acceptance criteria

**Preconditions for every criterion.** Every M6 surface requires an authenticated
account owner whose `adultAttestedAt` is set (M0 AC 6). Every request is
evaluated against the signed-in user, never against a student profile.

### Who may do this, and how the sample is obtained

1. **Given** a signed-in account owner, **when** they open the custom-voice flow,
   **then** it is available; and **given** an account with no `adultAttestedAt`,
   **when** the flow is opened, **then** it is refused with HTTP 403 and the
   typed error shape.
2. **Given** any student-facing surface in the application, **when** it is
   enumerated, **then** there is no navigation path, button, link or deep link
   from it to the voice-recording flow.
3. **Given** a request to create a voice that references a student profile as the
   speaker — by parameter, by session, or by any other means — **when** it is
   processed, **then** it is refused with HTTP 403, no audio is transmitted to the
   vendor, and no voice is created.
4. **Given** the voice-recording flow, **when** it is inspected, **then** it
   contains no file input and no path that accepts an audio file the in-app
   recorder did not produce; and **given** a direct API request submitting an
   arbitrary stored object as a sample, **when** it is processed, **then** it is
   refused. *(The only accepted source is a recording made in this flow, in this
   session.)*
5. **Given** the flow, **when** the owner begins, **then** they are required to
   record a spoken consent statement reading fixed, versioned prescribed wording
   — naming themselves, this app, and that their voice will be recreated to
   narrate lessons for their children — **before** the voice sample is recorded.
6. **Given** a submission with no stored consent recording for that account and
   consent version, **when** voice creation is attempted, **then** it is refused
   and no request is made to the vendor.
7. **Given** a recorded consent statement, **when** it is persisted, **then** the
   record holds the audio object pathname, the signed-in user id, the consent
   wording version, the timestamp, the IP address and user agent read server-side,
   and — once creation succeeds — the resulting vendor voice id.
8. **Given** the existing consent model, **when** M6's consent is recorded,
   **then** it is expressed by appending a new value to the `ConsentScope` enum
   and appending a new consent row; no existing consent row is modified or
   rewritten (ADR-0007).

### Recording, review and creation

9. **Given** a sample shorter than the configured minimum or longer than the
   configured maximum duration, **when** it is submitted, **then** it is rejected
   with actionable guidance both in the browser and at the API boundary, and no
   vendor request is made.
10. **Given** a completed sample, **when** the owner reaches the review step,
    **then** they can play it back, and nothing is transmitted to the vendor until
    they explicitly approve it; re-recording discards the previous sample.
11. **Given** an approved sample, **when** it is uploaded, **then** the bytes
    travel from the browser directly to the private blob store, and no request to
    the application's own origin carries the audio bytes in its body. *(Same
    constraint and same reason as M1 AC 2.)*
12. **Given** a successfully created voice, **when** persona lists are inspected,
    **then** the new persona appears for every student profile in that account and
    appears in no other account's list, and a direct request for it from another
    account returns HTTP 404.
13. **Given** the vendor returns the created voice in a state requiring further
    verification, **when** it is processed, **then** the persona is persisted in a
    `PENDING_VERIFICATION` state, is not selectable, and the owner is shown what
    is outstanding — the flow does not present an unusable voice as ready.
14. **Given** vendor creation fails or times out, **when** it is processed,
    **then** no persona row exists without a vendor voice id, the owner sees a
    plain message with a retry, and no vendor payload, key or internal error text
    reaches the browser.
15. **Given** an account that already has the configured maximum number of custom
    voices, **when** another creation is attempted, **then** the response is HTTP
    409 with the typed error shape; and **given** an account that has made the
    configured number of creation attempts in the configured window, **when**
    another is attempted, **then** the response is HTTP 429.

### Use, disclosure and revocation

16. **Given** a lesson narrated with a custom voice, **when** it plays, **then**
    the student sees a persistent indication that the voice is an AI recreation of
    the named adult and not a recording of them. *(M5 AC 19 already requires an
    AI-voice disclosure; this is the version that matters most.)*
17. **Given** a custom voice, **when** narration is generated with it, **then**
    M5's cache key (narration text, voice id, model id) distinguishes it from
    every other voice, and no narration generated with a stock persona is served
    for it.
18. **Given** the owner revokes voice consent, **when** revocation completes,
    **then** the persona is immediately unselectable, no new narration is
    generated with it, and any student profile that had selected it falls back to
    the configured default persona without an error.
19. **Given** the owner deletes the custom voice, **when** deletion completes,
    **then** the voice is deleted at the vendor, the persona row is removed, the
    stored voice sample object is removed from the blob store, and every cached
    narration asset generated with that voice id is removed from the blob store.
20. **Given** a student profile or the whole account is deleted (M0 AC 46, AC 47,
    AC 48), **when** deletion completes, **then** the account's custom voices are
    deleted **at the vendor** as well as locally. *(This is data that has left our
    infrastructure; a deletion that stops at our database is not a deletion.)*
21. **Given** a voice creation, deletion or revocation, **when** it completes,
    **then** an audit row records which account performed it, when, and against
    which vendor voice id — durable enough to answer "who cloned this" after the
    fact.
22. **Given** any screen in the application other than this flow, **when** it is
    loaded, **then** no microphone permission is requested. *(Carried forward
    from M5 AC-level behaviour; M6 is the only place a microphone is ever used,
    and only for the account owner.)*

## Out of scope for this milestone

Deliberately deferred; leave the seams, do not build them:

- **A second adult in the household.** M0 is one owner, N student profiles. A
  co-parent recording their own voice needs multi-adult accounts first.
- **Multiple custom voices per account** beyond the configured cap, and per-child
  assignment of different family voices.
- **Improving a clone with additional samples.**
- **A vendor-side verification handshake** beyond surfacing the pending state in
  AC 13 — if the vendor requires a human step in their own dashboard, M6 reports
  it and stops.
- **Abuse reporting by third parties** and any internal review queue. AC 21's
  audit row is the only forensic capability in this milestone.
- **Using the custom voice anywhere but lesson narration.**
- **Any use of the consent recording other than as an artifact** — it is stored
  evidence, never played to a student, never transcribed, never analysed.

## Open questions

- [ ] **Is a voice created through the API immediately usable, or blocked pending
  a manual verification step?** **TECHNICAL UNKNOWN, and the research calls it the
  highest-risk unknown in the whole integration.** If a human must complete a
  captcha in the vendor's own dashboard, the parent-facing flow as designed does
  not work and M6 needs rethinking. AC 13 makes the pending case survivable
  rather than assuming it away. **Resolve with a real API call on a paid account
  before any implementation.** **BLOCKING for the design, not for the criteria.**
- [ ] **How many cloned voices does the vendor plan allow per account?**
  **TECHNICAL UNKNOWN.** The research could not confirm per-tier caps. If the cap
  is low and account-wide rather than per-customer, it is a hard ceiling on how
  many families can ever use this feature. **Verify before promising it to
  anyone.** Blocking for scale, not for a first build.
- [ ] **How long is the raw voice sample kept after the clone exists?**
  **PRODUCT — needs a row in M0's retention table, not a number here.** The
  argument for deleting it within days is strong: once the vendor has the voice,
  the sample has no further business need, and it is the most sensitive object
  the app will ever hold. **ASSUMPTION pending the M0 row: delete the sample
  promptly after successful creation.** Non-blocking provided the window is
  configuration in M0.
- [ ] **How long is the recorded consent statement kept?** **PRODUCT — also an M0
  row.** It is the artifact that answers "was this authorised", so it plausibly
  outlives the voice itself; it is also a recording of an adult's voice, which is
  not nothing. It needs its own row with its own stated business need. Non-blocking
  for the build.
- [ ] **One custom voice per account, or more (AC 15)?** **PRODUCT.**
  **ASSUMPTION: one, as configuration.** Non-blocking.
- [ ] **What is the exact prescribed consent wording (AC 5), and who writes it?**
  **PRODUCT.** It is versioned like the M0 notice text, so it can change without
  invalidating existing recordings. The flow cannot ship with placeholder copy.
  Non-blocking for engineering, blocking for release.
- [ ] **What happens to a lesson a child has already watched in a parent's voice
  when that voice is deleted?** **PRODUCT.** AC 19 deletes the cached narration,
  so a replay regenerates in a stock voice — which is correct for deletion and
  may be startling for a child. ASSUMPTION: accept it, and say so at the deletion
  confirmation. Non-blocking.
- [ ] **Does the sample need a quality check before it is sent?** **TECHNICAL.**
  A noisy or too-quiet recording produces a bad clone the parent then blames on
  us, and the vendor's own noise removal is documented to make clean audio worse.
  AC 10's listen-back is the only control specified. Measure on real recordings
  before adding automated checks. Non-blocking.

## Data touched

**This is the most sensitive data the application will ever hold**, and it is
about an adult rather than a child — which does not make it lower risk, only
differently governed. M0 already flags that voice cloning has its own legal basis
distinct from data-processing consent; that work is owned there.

| Data | Subject | Sensitivity | Where |
|---|---|---|---|
| Recorded voice sample | Account owner (adult) | **Very high — biometric-adjacent; uniquely identifies a person** | Private blob store, then deleted per M0's row |
| Recorded consent statement | Account owner (adult) | **Very high — voice recording plus an identity claim** | Private blob store |
| Consent record: user id, wording version, timestamp, IP, user agent, resulting voice id | Account owner | High — evidence of authorisation | Postgres |
| Vendor voice id | Account owner | Medium — a handle to a voice model of a real person held by a third party | Postgres |
| Custom persona row (label, owning account) | Account owner | Low–medium; the label is usually a real first name | Postgres |
| Narration audio generated in the custom voice | Student (content) and owner (voice) | High — a real person's voice speaking a child's homework | Private blob store |
| Voice creation/deletion audit rows | Account owner | Low; retained as evidence | Postgres |

**New tables this milestone adds:** `VoiceConsentRecording`, `VoiceCreationAudit`,
plus an owning-account column and a status column on M5's `Persona`, and a new
`ConsentScope` value.

**Transmitted to third parties.** The voice sample is transmitted to the TTS
vendor and a **model of a real person's voice is created and held there**. This
is qualitatively different from every other outbound flow in the app: text we
send can be deleted from our side and forgotten; a voice model persists in
someone else's system until we delete it, which is why AC 19 and AC 20 are
written as vendor-side deletions rather than local ones. The consent recording is
**never** transmitted to the vendor — it is our own artifact, held for our own
account. The §312.4 direct notice and the published retention policy (M0) must
both be updated before M6 ships.

**Retention — owned by M0.** Two new rows are required in M0's published table
before this milestone ships: the **raw voice sample** and the **recorded consent
statement**. **M6 states no duration for either**, deliberately, per the
one-number-one-home rule. The narration audio row added for M5 covers audio
generated in a custom voice.

**Deletion.** Four paths must reach the vendor, not just Postgres: voice deletion
by the owner (AC 19), consent revocation (AC 18 — stops use; the owner may then
delete), profile or account deletion (AC 20), and the parent's §312.6 request
(M0 AC 48). Every one of them must also remove blob objects — the sample, the
consent recording where its window has elapsed, and the cached narration. The
orphan problem applies here at its sharpest: **a voice sample uploaded to blob
storage whose database row was never written is a recording of a real person's
voice referenced by nothing**, and M0 AC 43's store-enumerating reconciler must
cover this prefix.

**ASSUMPTIONS made in this spec** (each was a guess):

- One custom voice per account, created by the account owner, usable by all of
  that account's student profiles.
- Instant cloning from a short in-app recording is the mechanism; the
  professional cloning product is not usable here.
- The consent statement is recorded before the sample, in the same session, using
  the same recorder — so a submission without one is a client that skipped a step,
  not a supported path.
- The recorded consent statement is stored as audio and never transcribed.
- The custom persona's label defaults to the owner's own name and is editable, but
  is shown to the student alongside the AI-recreation disclosure (AC 16).
- Sample minimum and maximum durations, the per-account voice cap, and the
  creation-attempt rate limit are all configuration.
- Deleting a voice regenerates future narration in the default persona rather than
  leaving lessons unplayable.
