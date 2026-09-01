# Spec: Narration and tutor personas

- **Status:** Draft
- **Date:** 2026-08-27
- **Author:** product-spec agent
- **Milestone:** M5
- **ADRs:** n/a — none written yet. The architect must produce ADRs for (a) the
  TTS vendor choice and the persona-to-voice indirection, (b) the narration cache
  key and where cached audio lives, and (c) our own normalised cue format.
  Depends on M4's `LessonScript` ADR and ADR-0003 (private blob storage).
  Research: [elevenlabs-tts.md](../research/elevenlabs-tts.md),
  [tutoring-product-patterns.md](../research/tutoring-product-patterns.md).

## Problem

The whiteboard draws in silence. A child watching a lesson has to read narration
text at the same time as watching something being drawn, which splits their
attention exactly when the explanation is at its hardest — and for a struggling
reader, the text is a second obstacle in front of the maths. The product's whole
promise is a tutor that talks the student through it, in a voice the child picked
and likes. Right now there is no voice at all.

## Goal

Every lesson step is spoken by the student's chosen tutor persona, generated once
and cached, with the drawing driven by stored timings so it stays in step with
the words on every replay.

## Non-goals

Named because a reader will assume several of these are here:

- **No voice cloning.** No custom voice, no parent recording, no upload of any
  audio sample. Personas are a fixed, app-owned set. M6 does cloning.
- **No student audio, ever.** M5 requests no microphone permission on any screen,
  records nothing from the student's device, and transmits no audio captured from
  a student. There is no read-aloud practice, no pronunciation scoring, no voice
  answers.
- **No impersonation of a real person.** Personas are original, named characters.
  No persona may imitate a real, identifiable individual, living or dead,
  including public figures, celebrities, teachers or characters from copyrighted
  media (AC 2).
- **No narration of chat replies** (M3 stays text) and **no narration of practice
  problems** (M2 stays text). M5 narrates lesson scripts and nothing else.
- **No live-streamed narration synced to the canvas.** Generation is
  ahead-of-time and cached; playback never depends on a live TTS connection
  (AC 5). The research is explicit that chasing sync against a stream buys
  nothing and makes drift undebuggable.
- **No background music, sound effects, chimes or applause.**
- **No downloading, exporting or sharing narration audio.**
- **No playback speed control**, no per-word karaoke highlighting, no voice
  emotion or style controls.
- **No multilingual narration** and no translated lessons.
- **No per-student voice tuning** — pitch, speed and accent are properties of the
  persona, not of the student.

## User stories

- As a student, I want the tutor to talk me through the drawing, so that I can
  watch instead of reading.
- As a student, I want to choose which tutor voice teaches me, so that the app
  feels like mine.
- As a student, I want the words and the drawing to line up, so that "and now we
  circle the 5" happens when the 5 is circled.
- As a student, I want to go back a step and hear it again from there, so that I
  can catch the bit I missed.
- As a student in a quiet room, I want captions, so that I can follow the lesson
  with the sound off.
- As a student replaying a lesson, I want it to start instantly, so that watching
  it twice is not a punishment.
- As a parent, I want to know the voice is a computer, so that my child is not
  confused about who is talking to them.
- As a parent, I want the app never to record my child's voice, so that there is
  nothing to leak.
- As the owner, I want narration to be generated once and reused, so that a
  replayed lesson costs nothing.

## Acceptance criteria

**Preconditions for every criterion.** Narration applies to a lesson in status
`READY` (M4 AC 6) belonging to a student profile whose status is `ACTIVE` (M0
AC 36). A request against any other status returns HTTP 403 with the typed error
shape and makes no TTS call.

### Personas

1. **Given** the persona list, **when** it is inspected, **then** each persona is
   a database row holding a human-readable label, a description and the
   provider's voice identifier, and **no provider voice identifier appears as a
   literal in application code.** *(Stock voices in this category have been
   documented to expire on a published date; a voice id compiled into the app is
   an outage with a calendar entry.)*
2. **Given** the persona list, **when** it is reviewed, **then** no persona's
   name, description or artwork identifies or evokes a real, named individual.
3. **Given** a persona whose provider voice identifier no longer resolves,
   **when** narration is requested with it, **then** the request falls back to the
   configured default persona, the failure is logged with the unresolvable id, and
   the student sees a working lesson rather than silence or an error page.
4. **Given** a student profile, **when** the student selects a persona, **then**
   the selection is persisted on the profile and is used for subsequently
   generated narration.

### Generation and caching

5. **Given** a lesson with generated narration, **when** the TTS provider is
   unreachable, **then** the lesson still plays with full audio and in-sync
   drawing. *(Playback reads stored assets only. This is the criterion that
   forbids live-stream sync.)*
6. **Given** a `READY` lesson, **when** narration is generated, **then** one audio
   asset and one cue timeline are persisted per step before the lesson is marked
   narrated, and the lesson is not offered as narrated until all steps are
   present.
7. **Given** narration already generated for a (narration text, voice id, model
   id) triple, **when** narration is requested again for the same triple — the
   same lesson replayed, or a different lesson containing an identical narration
   line — **then** no request is made to the TTS provider and the stored asset is
   reused.
8. **Given** any one of narration text, voice id or model id changes, **when**
   narration is requested, **then** the cache key differs and a new asset is
   generated. *(Test each of the three independently.)*
9. **Given** an N-step lesson being narrated, **when** the provider calls are
   observed, **then** at no point are more than the configured maximum concurrent
   requests in flight, and a provider 429 causes a backoff and retry rather than a
   failed lesson. *(Concurrency, not credits, is the documented scaling wall in
   this category — a `Promise.all` over steps fails this.)*
10. **Given** a step whose narration text exceeds the configured per-request
    character cap, **when** narration is generated, **then** the request is
    refused with the typed error shape rather than silently truncated. *(M4 AC 8
    caps narration at authoring time so this should be unreachable; it is asserted
    here because a truncated explanation is invisible to everyone except the
    child.)*
11. **Given** generated narration audio, **when** storage is inspected, **then**
    it is stored as an object in the private blob store, is served to the browser
    only via a signed URL whose expiry is no more than the M0 AC 41 limit, and is
    never returned inline through a function response body.
12. **Given** a narration generation request, **when** the outbound request to the
    TTS provider is captured, **then** it carries the narration text and voice
    selection only — no student display name, no account email, no profile id, and
    no identifier in the request metadata or the resulting object's pathname.

### Cues and synchronisation

13. **Given** a provider response containing character-level alignment, **when**
    it is processed, **then** the persisted cue timeline is in our own normalised
    format — step id, start and end offsets in milliseconds — and the raw provider
    payload is not required at playback time. *(Delete the raw payload and replay
    the lesson: it must still sync.)*
14. **Given** character-level alignment for a narration line, **when** word
    boundaries are derived, **then** each word's start time is the start time of
    its first character and its end time is the end time of its last character,
    verified against a fixture including the line "solve for x: 3x plus 5 equals
    20". *(Mathematical narration is the documented place where alignment
    silently drifts. This fixture is not optional.)*
15. **Given** a narrated lesson played end to end, **when** the drawing for each
    step is compared against that step's audio cue, **then** every step begins
    within the configured sync tolerance of its cue, including the last step of a
    long lesson. *(No cumulative drift: the tolerance applies to the final step
    as strictly as to the first.)*
16. **Given** a narrated lesson, **when** the student pauses, steps back to step
    *k*, or replays from the start, **then** audio and drawing resume together
    from the cue for that step, with no audio from a later step still playing.

### Degradation, disclosure and lifecycle

17. **Given** a lesson whose narration generation failed, **when** the student
    opens it, **then** the lesson plays silently with captions, is labelled as
    narration-unavailable, and offers a retry — it is never unplayable because
    the voice failed.
18. **Given** a narrated lesson, **when** it plays, **then** captions showing the
    current step's narration text are displayed, can be toggled off, and the full
    narration text remains readable with audio muted.
19. **Given** any narrated lesson, **when** it plays, **then** the student and the
    account owner are shown that the voice is computer-generated. *(Required by
    the provider's prohibited-use policy and correct regardless of it. M6 makes
    this disclosure load-bearing.)*
20. **Given** a lesson or a student profile is deleted (M4 AC 21, M0 AC 46),
    **when** deletion completes, **then** the narration audio objects for that
    lesson are removed from the blob store, not only their database rows.
21. **Given** a student profile that has generated the configured daily narration
    budget, **when** more narration is requested, **then** the response is HTTP
    429 with the typed error shape, no TTS call is made, and existing narrated
    lessons remain playable.
22. **Given** account A signed in, **when** it requests a narration asset or cue
    timeline belonging to account B, **then** the response is HTTP 404 and no
    signed URL is issued.

## Out of scope for this milestone

Deliberately deferred; leave the seams, do not build them:

- **M6 custom voices.** AC 1's persona indirection and AC 7's cache key (which
  already includes voice id) are the seams. A cloned voice should be a persona row
  with an owning account, and nothing else in M5 should need to change.
- **Narrated chat replies.** Low-latency TTS is a different model with different
  latency characteristics; it is a separate decision, not an extension of this
  one.
- **Word-level highlighting of captions.** AC 14 derives word timings, so the data
  will exist; nothing renders them in M5.
- **Playback speed control.** Note the trap for whoever builds it: drawing timing
  is derived from audio position, so speed must change both together or sync
  breaks.
- **Forced alignment as a cross-check** on character-derived word boundaries. It
  is a fallback path if AC 14's fixture proves unreliable, not a default.
- **Pre-warming narration** for lessons the student has not opened yet.
- **Screen-reader treatment of the canvas** — still M4's open gap, and narration
  audio is not a substitute for it.

## Open questions

- [ ] **TTS vendor approval and the API key.** **BLOCKING.** Adding a TTS SDK is a
  new major dependency and the constitution requires the owner's approval, and
  `ELEVENLABS_API_KEY` (or the chosen equivalent) must be added to
  `.env.example` as a server-only variable. Nothing in M5 can be built without
  this.
- [ ] **Does the timestamped endpoint work with the low-latency model, and which
  model do we use per surface?** **TECHNICAL UNKNOWN.** The research could not
  confirm that the fast model supports the with-timestamps endpoint, and flags it
  as a one-request experiment that constrains the architecture. Since M5
  pre-generates everything, the expressive model is the natural choice for
  quality — but the answer decides whether any future low-latency synced surface
  is possible at all. **Run the experiment before the architect fixes the shape.**
- [ ] **Which stock voice set is actually available to a newly created account?**
  **TECHNICAL UNKNOWN.** The research documents that the legacy default voices
  expire on a published date and may not be available to accounts created after
  March 2026. AC 1 and AC 3 are the mitigations; the persona list still has to be
  populated from something real. Verify against a live account before choosing
  personas. Blocking for AC 1's content, not for its shape.
- [ ] **What is the sync tolerance in AC 15?** **PRODUCT + TECHNICAL.**
  **ASSUMPTION: 150 ms.** Nobody has measured what feels wrong to a child. Needs
  one round of real testing; non-blocking provided it is configuration.
- [x] **Are captions on by default?** **DECIDED by the owner, 2026-09-01: ON.**

  The assumption is confirmed, and the reason to hold it is stronger than the
  one originally written down. The note framed this as a reading-support
  trade-off — helpful for a struggling reader, clutter for another. The
  decisive argument is narrower: **a deaf or hard-of-hearing child gets nothing
  at all from narration.** Captions off by default would make the entire
  milestone inaccessible to them by default, and a default is what almost
  everyone keeps. Accessibility defaults belong on.

  The attention-splitting worry in M5's own problem statement is real and is
  answered by *how* captions are built rather than by switching them off:

  - **A caption is the CURRENT step's line, not the script.** The thing M5 set
    out to remove is a child reading a wall of text while watching a drawing.
    One line, appearing with the audio it belongs to, is not that.
  - **It must be toggleable, and the choice persisted per student profile** —
    the same shape as the persona selection (AC 4). A child who finds it
    cluttered turns it off once, not every lesson.
  - AC 16's static text view remains the separate, complete, no-canvas
    equivalent. Captions are not a substitute for it and it is not a substitute
    for them.

  Sequencing note for whoever builds this: captions are the surface that makes
  M5 legible to a reviewer without listening to audio, so building them early
  makes every later step easier to check.
- [x] **How many personas, and who designs them?** **DECIDED by the owner,
  2026-09-01: six**, designed by the owner and recorded below.

  | # | Persona | Personality | Voice (name) | Voice id |
  |---|---|---|---|---|
  | 1 | **Smooth J** | Laid back, charismatic, intelligent, easygoing | Eric — Smooth, Trustworthy | `cjVigY5qzO86Huf0OWal` |
  | 2 | **Professor Sunny** | Funny, upbeat, bright and warm; uses humour to get a student through a hard thing | Jessica — Playful, Bright, Warm | `cgSgspJ2msm6clMCkdW9` |
  | 3 | **Coach Vale** | Brilliant, low-energy, near-monotone, strict, everything by the book | Matilda — Knowledgable, Professional | `XrExE9yKIg1WjnnlVkGX` |
  | 4 | **Professor O** | Cool, bright, calm, dignified | Brian — Deep, Resonant, Comforting | `nPczCjzI2devNBz1zQrb` |
  | 5 | **Professor Blaze** | Energetic, warm, hyper-motivational | Liam — Energetic | `TX3LPaxmHKxFdv7VOQHJ` |
  | 6 | **Professor Love** | Clear, patient, encouraging | Alice — Clear, Engaging Educator | `Xb7hH8MSUJpSbSDYk0k2` |

  **These voice ids are SEED DATA, not code.** AC 1 forbids a provider voice id
  appearing as a literal in application code, and the reason is in the
  measurement note: the stock voice set carries a published expiry, so an id
  compiled into the app is an outage with a calendar entry. They belong in a
  seed script or a data migration, where AC 3's fallback can repoint them.

  **Three names were changed from the owner's first list, for one reason.**
  "Barack Obama", "Professor Snoop" ("he's gonna sound like Snoop Dogg") and
  "Professor Khaled" each named or evoked a real, living individual, which
  **AC 2 of this very spec forbids** — and which right-of-publicity law and the
  TTS vendor's own terms forbid independently. The *personalities* were kept
  intact and only the identities dropped: cool-bright-calm became Professor O,
  hyper-motivational became Professor Blaze, and the laid-back-cool character
  was already covered by Smooth J, who was the same character described twice.

  **Two are placeholders the owner may rename freely** — Professor Sunny and
  Professor Blaze. The only constraint on any replacement is AC 2.

  **Gender balance is deliberate.** The owner's first list was six male-coded
  characters. Three of the six voices are now female (Jessica, Matilda, Alice),
  because a nine-year-old picking the voice that teaches them every day should
  not find that every option is a man. Seven female voices were available and
  unused.

  **Still to design: the artwork.** Each persona needs a preset avatar in the
  existing M0 avatar style. AC 2 governs it as much as the name — no likeness of
  a real person, including a likeness that merely evokes one.
- [ ] **What is the per-profile narration budget in AC 21?** **PRODUCT.** It is a
  real cost control and also a usage cap a child will hit mid-lesson if set badly.
  ASSUMPTION: generous enough that a normal session never reaches it; the cap
  exists to catch a loop, not to ration lessons. Non-blocking as configuration.
- [ ] **Does narration audio for a deleted-and-regenerated lesson orphan in the
  blob store?** **TECHNICAL.** AC 20 covers deletion by lesson and profile, but
  M4 AC 19 creates a new script version on every regeneration, and each version
  narrated separately produces objects that may outlive their row. The M0 AC 43
  store-enumerating reconciler must cover the narration prefix too. Non-blocking
  for M5's criteria, **blocking for the reconciler's configuration.**

## Data touched

M5 introduces the first outbound flow to a **second** AI vendor, and the first
audio the app has ever handled. It handles no audio *of* the student — that is
AC-level and deliberate.

| Data | Subject | Sensitivity | Where |
|---|---|---|---|
| Narration text (from the lesson script) | Student — it explains their problem and contains their numbers | Medium | Postgres, and transmitted to the TTS vendor |
| Generated narration audio | Student (by association with their lesson) | Medium — it speaks the content of a child's homework aloud | Private blob store |
| Cue timeline (step id, start/end ms) | Student (by reference) | Low | Postgres |
| Persona selection | Student | Low | Postgres |
| Persona rows (label, description, voice id) | — | Not personal; app reference data | Postgres |
| Narration cache keys (hash of text, voice, model) | Student (indirectly) | Low | Postgres |
| Signed URLs for narration objects | Student | **Bearer credentials — never log them** | Transient |

**New tables this milestone adds:** `Persona`, `NarrationAsset` (cache-keyed),
`NarrationCue` or a cue array on the asset, plus a persona reference on
`StudentProfile`.

**Transmitted to third parties.** Narration text goes to the TTS vendor. Note
what that means concretely: **a sentence describing a specific child's homework
problem leaves our infrastructure to a second vendor**, and the §312.4 direct
notice (M0 AC 12–13) currently names Anthropic, Vercel and Neon only. It must
name the TTS vendor before M5 ships, and that is an M0 edit, not an M5 one.
AC 12 keeps identifiers out of the request, but the text itself is about the
child's work. Nothing is transmitted to any analytics or error-reporting service,
and a signed narration URL must never appear in a log, an error report or cached
HTML.

**Retention — owned by M0.** M0's published table needs a row for **generated
narration audio and its cue timeline** before M5 ships. The natural window is the
life of the source lesson, because the cache is what makes replay free; the
counter-argument is that audio of a child's homework is a heavier artifact than
the text it came from. Decide it in M0. **M5 states no duration.**

**Deletion.** Narration objects are removed by lesson deletion, profile deletion
(M0 AC 46), the parent's §312.6 request (M0 AC 48) and account closure (M0
AC 47) — all of which must delete the blob object, not just the row (AC 20).
Because narration reintroduces objects in blob storage, **the orphan problem M0
AC 43 exists to solve applies again here**: an audio object whose row was never
written is invisible to every deletion path. The reconciler must enumerate the
narration prefix.

**ASSUMPTIONS made in this spec** (each was a guess):

- Narration is generated per lesson step, not per lesson, so a step is the
  cacheable unit and the cue timeline is per step.
- Narration is generated on demand when a student first opens a lesson, not
  eagerly at authoring time. Eager generation is cheaper to sync and more
  expensive when a lesson is never watched.
- MP3 at a widely decodable bitrate is the output format, chosen for browser
  compatibility across the cheapest usable vendor tier.
- Audio is played with a standard HTML audio element and drawing is driven from
  its current playback position, which is what makes AC 15 and AC 16 achievable
  without a second clock.
- Personas are app-owned and identical for every account until M6.
- The AI-voice disclosure (AC 19) is a persistent visible label during playback,
  not a one-time dialog.
- Every threshold here — concurrency cap, character cap, sync tolerance, daily
  narration budget, signed URL expiry (M0's value) — lives in one configuration
  module, not as literals.
