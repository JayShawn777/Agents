# Spec: Spoken language practice

- **Status:** Draft
- **Date:** 2026-08-27
- **Author:** Claude (inline; not the product-spec agent — see M2.5's process note)
- **Milestone:** **M8**, after M6
- **ADRs:** n/a — none written yet. Blocked on a COPPA decision (below) before
  the architect may design anything. Will need ADRs for (a) the ASR vendor and
  what leaves the device, (b) how a child's audio is retained, or not, and
  (c) how a spoken answer is graded when there is no canonical string to
  compare against. Research needed: an ASR vendor assessment in
  `docs/research/`, alongside
  [coppa-childrens-privacy.md](../research/coppa-childrens-privacy.md).

## Problem

The tutor is meant to cover foreign languages, and a language is not learned by
typing it. A child who can conjugate on paper and cannot say the word out loud
has not learned to speak — and speaking is the part they are most self-conscious
about and least likely to practise in front of a class. The one thing an
always-patient tutor is uniquely good at is letting a child say something wrong
forty times with nobody watching.

Nothing in M0–M7 can hear. M3 is text chat and excludes voice by name. M5 is
text-to-speech: the app talks, the child does not. M6 records a consenting adult
so the app can talk in a familiar voice. **No milestone captures a child's
speech**, so as planned the product cannot teach speaking at all.

## Goal

A student can say a word, phrase or sentence in the language they are learning,
have the app tell them how close they were, and try again — without the app
retaining a recording of the child's voice any longer than answering that one
question requires.

## Non-goals

- **Not open-ended conversation practice.** A prompt-and-response exchange
  against a known target phrase. Free-form spoken dialogue is a later thing and
  probably belongs with M3's chat, not here.
- **Not accent correction, and not a native-speaker standard.** The bar is
  intelligibility, not sounding like a particular region's speaker. A child with
  a speech difference, a regional accent, or a first language that shapes their
  vowels must not be told they are wrong for it.
- **No score that can fall.** M2 AC 19/20 and M2.5 AC 13 are binding on this
  surface too, and pronunciation is exactly where a decaying percentage is most
  tempting and most discouraging.
- **No always-on microphone.** Capture is per-attempt, initiated by an explicit
  press, with a visible indicator while it is live and an automatic stop.
- **No storage of a child's raw audio beyond the request** unless AC 4's
  consent path is taken deliberately and separately.
- **No speaker identification, voice biometrics, or voiceprint of any kind.**
  This is the single brightest line in the milestone. A voiceprint is biometric
  data about a child and this product will not create one.
- **No voice cloning of the child.** M6 clones a consenting adult. That
  mechanism must not be reachable from a child's recordings.
- **No speech input anywhere else in the app.** This does not retroactively add
  voice to chat (M3), to practice answers (M2), or to checkpoints (M2.5).
- **No offline/on-device claim** unless the chosen vendor actually delivers it.
- **Not a replacement for the written foreign-language track**, which is blocked
  on its own taxonomy question — see "Dependency" below.

## User stories

- As a student, I want to say a phrase and be told whether I was understandable,
  so that I can practise speaking without an audience.
- As a student, I want to hear it said correctly right after I try, so that I
  have something to imitate.
- As a student, I want to try as many times as I like without a score dropping,
  so that practising is not punished.
- As a parent, I want to know exactly what happens to a recording of my child's
  voice, in plain language, before I allow it.
- As a parent, I want to turn speaking practice off for my child and have every
  recording already taken be gone, so that consent is reversible in fact and not
  only on paper.

## Acceptance criteria

**Precondition for every criterion.** Speaking practice is unavailable — the
control is not rendered and the endpoint refuses — unless AC 4's consent has been
granted for that specific student profile and has not been withdrawn.

### Consent, before anything else

1. **Given** an account whose parent has not granted voice consent, **when** any
   speaking surface or endpoint is reached, **then** it is refused, no audio is
   accepted, and the parent is shown what granting it would mean.
2. **Given** the §312.4 direct notice, **when** it is rendered, **then** it names
   audio collection, names the ASR vendor as a recipient, and states the
   retention outcome, in the same plain language as the existing notice.
3. **Given** voice consent is withdrawn, **when** the withdrawal completes,
   **then** speaking practice stops immediately and every stored artifact
   derived from that child's audio is deleted on the M0 deletion path, with a
   `DeletionAudit` row like any other deletion.
4. **Given** voice consent is granted, **when** the consent record is inspected,
   **then** it is a separate, independently withdrawable scope — not folded into
   the general consent that covers uploads and practice.

### Capture

5. **Given** a student on a speaking exercise, **when** the microphone is live,
   **then** an indicator is visible for the entire time and capture stops on its
   own at a bounded maximum length.
6. **Given** a capture, **when** it completes, **then** the audio is sent for
   scoring and is not written to durable storage by default (AC 10 governs the
   exception).
7. **Given** a denied or unavailable microphone permission, **when** the student
   opens a speaking exercise, **then** they get a written alternative for the
   same item rather than a dead end.

### Scoring and feedback

8. **Given** a spoken attempt against a known target phrase, **when** it is
   scored, **then** the student is told whether it was understandable and what
   to adjust, in the encouraging register the rest of the app uses.
9. **Given** a spoken attempt that cannot be scored — silence, noise, an upstream
   failure — **when** it is processed, **then** the result is the `UNSCORED`
   outcome M2's grading already defines, never an error and never a wrong mark.
10. **Given** repeated spoken attempts, **when** any child-facing payload is
    inspected, **then** it contains no value lower than one previously rendered
    for that student or item.

### Data

11. **Given** a spoken attempt, **when** the request to the ASR vendor is
    captured, **then** it carries no display name, avatar id, account email,
    user id or student profile id — the `lib/ai/outbound.ts` rule extended to a
    second vendor.
12. **Given** any artifact this milestone stores, **when** `RETENTION_POLICY` is
    read, **then** it has a row with a window, and the deletion bijection test
    covers it.
13. **Given** a stored transcript of what a child said, **when** it is treated
    anywhere in the system, **then** it is student personal data under COPPA —
    the same class as uploaded schoolwork, not an ordinary log line.

## Out of scope for this milestone

- Free-form spoken conversation with the tutor.
- Speaking practice in subjects other than foreign language.
- Reading-aloud fluency assessment for English, which is a genuinely adjacent
  product and a different set of obligations.
- Any use of stored audio to improve a model, ours or a vendor's.

## Open questions

- [ ] **Which ASR vendor, and does its ToS permit audio from children under 13?**
      Several major providers forbid it outright or require a separate
      agreement. **BLOCKING** — this decides whether the milestone is buildable
      as specified.
- [ ] **Does the vendor retain audio, and can retention be contractually
      disabled?** If not, "we do not keep your child's voice" is not a claim we
      can make. **BLOCKING.**
- [ ] **Is a stored transcript acceptable where stored audio is not?** A
      transcript is far less sensitive than a voiceprint but is still a record of
      a child speaking. **Non-blocking**, decide before the schema is designed.
- [ ] **What is the intelligibility bar, and who sets it?** Getting this wrong
      towards strictness turns the feature into the thing AC's non-goals forbid.
      **Non-blocking**, but needs a real answer before launch, not a threshold
      someone picked.
- [ ] **Which languages at launch?** ASR quality varies enormously by language
      and is worst for exactly the under-resourced languages a family is most
      likely to want. **Non-blocking.**

## Dependency: the written foreign-language track

This milestone assumes foreign language exists as a subject with content behind
it. It does not yet. `FOREIGN_LANGUAGE` is a `Subject` enum member with no
skills bundled, and it is currently *asserted* non-gradable by
`tests/unit/lib/taxonomy/index.test.ts` so that adding it has to be deliberate.

The blocker is real and is not laziness: the taxonomy is indexed by
`GradeLevel`, and ACTFL — the framework a US K-8 world-language course would be
measured against — is organised by **proficiency**, not grade. A first-year
learner may be in grade 3 or grade 8. Mapping proficiency onto grade means
inventing a correspondence ACTFL does not publish, and `SKILL_GRADE_BAND`
filtering assumes one. The options are a synthetic mapping, or exempting
foreign language from grade banding entirely.

That is an architecture decision and belongs in an ADR (proposed **ADR-0016**)
before any JSON is written. Doing the written track first is also the cheaper
order: it proves the subject end-to-end through machinery that already exists,
and speaking then has somewhere to attach.

## Data touched

**Reads:** the student's grade level, target language and the phrase being
practised. **Writes:** a spoken-attempt record and its outcome; audio itself is
not persisted by default (AC 6). **Transmits:** the captured audio to a
third-party ASR vendor — **a new vendor, a new recipient in the §312.4 notice,
and a new row in the vendor capability assessment.** That is the single biggest
compliance change in this milestone and the reason two of its open questions are
blocking.

**Retention:** every artifact gets a `RETENTION_POLICY` row before
implementation. A child's voice is personal information under COPPA; the FTC's
policy statement tolerates audio collected as a substitute for text and deleted
immediately, which is narrower than what pronunciation feedback needs — so this
milestone stands on AC 4's separate consent rather than on that allowance.
