# M6 implementation plan — custom voice

- **Status:** Awaiting owner approval. **No implementation may start until this is approved.**
- **Date:** 2026-09-02
- **Spec:** [m6-custom-voice.md](../specs/m6-custom-voice.md)
- **Gating measurement:** [m6-voice-clone-measurement.md](../research/m6-voice-clone-measurement.md) — **RUN, and it unblocked this plan**
- **Depends on:** ADR-0003 (private blob storage), ADR-0007 (append-only consent, blob-before-row), ADR-0008 (consent method interface), ADR-0015 (per-profile narration cache), ADR-0020 (ElevenLabs behind a persona indirection)

---

## 0. What the measurement settled, and what it changes

The spec named one question **BLOCKING for the design**. It is answered:

- **An API-created voice is IMMEDIATELY USABLE.** `requires_verification: false`;
  synthesis succeeds on the first attempt with no dashboard step. Confirmed twice.
- **Therefore AC 13's `PENDING_VERIFICATION` state is DEMOTED** from the expected
  path to a defensive branch. It is still built — a vendor can change this
  without telling us, and per-account policy may differ — but **it must not
  shape the primary UI flow**. No "we'll email you when it's ready" screen.
- **Vendor-side deletion works** (AC 19/20 are viable): `DELETE` returns 200 and
  the voice is then reported `voice_not_found`.
- **The voice cap is still unknown** and needs `user_read`, which the key lacks.
  **Blocking before the feature is promised to users; not blocking for this
  build.** The cap is therefore OUR configured number, not the vendor's.

---

## 1. The finding that must be fixed FIRST, before any M6 row exists

**M5 shipped a persona selection path with no ownership scoping, and M6 turns
that into a cross-account voice leak.**

`app/api/students/[studentId]/route.ts` validates a chosen persona with:

```ts
const chosen = await db.persona.findFirst({ where: { id: body.personaId, retiredAt: null } });
```

That is correct today, because every `Persona` row is shared app reference data
owned by nobody. The moment `ownerUserId` exists, this query lets **account A set
their child's narration voice to account B's cloned parent voice** — a stranger's
real voice reading their child's homework. `resolvePersonaForNarration`
(`app/api/lessons/[lessonId]/narration/route.ts`) and `findPersonaById`
(`lib/personas/dal.ts`) have the same shape and the same consequence.

This is not a review finding to be caught later. It is a precondition.

**The fix is structural, not a remembered check.** One DAL helper becomes the
only way any code reads a persona:

```ts
// lib/personas/dal.ts — the ONLY persona reader in the app.
// `visibleTo` is required, not optional: there is no call site that legitimately
// wants "any persona regardless of owner", and making the parameter optional is
// how the next person reintroduces this.
function personaVisibilityWhere(userId: string): Prisma.PersonaWhereInput {
  return { OR: [{ ownerUserId: null }, { ownerUserId: userId }] };
}
```

Every read — the picker list, the PATCH validation, generation-time resolution —
composes that clause. **Slice 1 does this before `ownerUserId` is ever written**,
so there is no window in which an owned persona exists behind an unscoped query.

A test asserts, by reading the source tree, that `db.persona.find*` appears in no
file except `lib/personas/dal.ts` — the same static-check technique
`no-voice-id-literals.test.ts` already uses, and the same reasoning as retro
lesson 22: a rule enforced by a grep over the source cannot be forgotten.

---

## 2. Schema delta

**Against the SHIPPED schema, which differs from the M2-M7 sketch.** The sketch
predates M5 and describes a `Persona` with `status`, `isDefault`, `provider` and
`ownerUserId`; the shipped row has `slug`, `artworkId`, `sortOrder`, `retiredAt`
and no ownership. This plan reconciles to what exists.

### 2.1 `Persona` — extended, not duplicated

```prisma
enum PersonaStatus {
  ACTIVE
  /// AC 13. Defensive branch — the measurement says this is not the normal path.
  PENDING_VERIFICATION
  /// AC 18. Consent revoked: unselectable, existing cached audio still plays.
  REVOKED
}

model Persona {
  // ... every existing field unchanged ...

  /// NULL for the app-owned shared set (the six M5 personas). Set for an M6
  /// cloned voice, which is then visible ONLY to this account's profiles (AC 12).
  /// Cascade: an account's deletion takes its personas with it (AC 20's local half).
  ownerUserId String?
  status      PersonaStatus @default(ACTIVE)

  owner       User?        @relation(fields: [ownerUserId], references: [id], onDelete: Cascade)
  customVoice CustomVoice?

  @@index([ownerUserId])
  @@index([ownerUserId, status])
}
```

**Why extend rather than add a parallel model.** Everything downstream of a
persona — the picker, `StudentProfile.personaId`, `LessonNarration.personaId`,
`NarrationAsset.personaId`, the cache key, the disclosure line — already works.
A parallel `CustomPersona` model would fork every one of those. The isolation
AC 12 asks for is one nullable column plus one required `WHERE` clause.

**`slug` for a custom voice** is `custom-<cuid>`, generated server-side. It stays
`@unique` and never collides with the six stock slugs, which are human-chosen.

**`artworkId`** uses a fixed preset (`CUSTOM_VOICE_ARTWORK_ID`) — never an
upload, never a likeness. AC 2's rule about pictures applies here exactly as it
does to stock personas.

**`retiredAt` vs `status`.** Both are kept and they mean different things:
`retiredAt` is "the app withdrew this stock voice"; `status` is "this voice's
own lifecycle". A REVOKED custom persona is not retired.

### 2.2 New models

Taken from the M2-M7 sketch, which is sound, with the changes noted:

```prisma
enum VoiceAuditEvent { CREATED  REVOKED  DELETED  VENDOR_DELETE_FAILED }

/// AC 5/6/7. The recorded spoken consent statement. NEVER transmitted to the TTS
/// vendor, never played to a student, never transcribed, never analysed.
model VoiceConsentRecording {
  id                       String   @id @default(cuid())
  userId                   String
  /// `users/<userId>/voice-consent/<cuid>.<ext>`. NEVER in a DTO.
  pathname                 String   @unique
  consentWordingVersion    String
  durationMs               Int
  /// AC 7: read SERVER-side from headers, never from the body.
  ipAddress                String?
  userAgent                String?
  /// AC 7: stamped once vendor creation succeeds.
  resultingProviderVoiceId String?
  /// AC 8: the appended ParentalConsent row carrying VOICE_CLONING.
  parentalConsentId        String?
  createdAt                DateTime @default(now())

  user            User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  parentalConsent ParentalConsent? @relation(fields: [parentalConsentId], references: [id], onDelete: Restrict)
  customVoice     CustomVoice?

  @@index([userId, createdAt])
}

model CustomVoice {
  id                      String    @id @default(cuid())
  userId                  String
  personaId               String    @unique
  voiceConsentRecordingId String    @unique
  /// AC 11. Nulled once deleted per M0's VOICE_SAMPLE retention row — the most
  /// sensitive object this application will ever hold.
  samplePathname          String?
  sampleDeletedAt         DateTime?
  providerVoiceId         String
  /// AC 13. Defaults false; the measurement says the vendor returns false.
  requiresVerification    Boolean   @default(false)
  createdAt               DateTime  @default(now())

  user             User                  @relation(fields: [userId], references: [id], onDelete: Cascade)
  persona          Persona               @relation(fields: [personaId], references: [id], onDelete: Cascade)
  consentRecording VoiceConsentRecording @relation(fields: [voiceConsentRecordingId], references: [id], onDelete: Restrict)

  @@index([userId])
}

/// AC 21. Like DeletionAudit (ADR-0007 §4) it has NO foreign keys, so it
/// survives the purge it exists to record. `actorHash` is an HMAC under the same
/// AUDIT_PSEUDONYM_KEY as ConsentAuditArtifact; `userId` is nulled by account
/// deletion while the hash survives.
model VoiceCreationAudit {
  id                    String          @id @default(cuid())
  event                 VoiceAuditEvent
  userId                String?
  actorHash             String
  providerVoiceId       String
  consentWordingVersion String?
  occurredAt            DateTime        @default(now())

  @@index([providerVoiceId])
  @@index([event, occurredAt])
}
```

**`ConsentScope` gains `VOICE_CLONING`** — appended, never reordered (AC 8,
ADR-0007). One new enum value, one new consent row per grant.

### 2.3 Retention and notice — both must move before this ships

- **Two new `RETENTION_POLICY` rows**, owned by M0, not numbered here (the
  one-number-one-home rule): `VOICE_SAMPLE` and `VOICE_CONSENT_RECORDING`. The
  coverage test will fail on the three new models until they are classified,
  which is the mechanism working.
- **The §312.4 notice and `/privacy` gain a row.** M6 sends an adult's voice to
  ElevenLabs — a new *category* of data to an already-named processor. The
  `third-party-coverage` test added in M5 will not catch this, because the vendor
  is already listed. **A new test must assert the notice describes voice data**,
  or this recurs exactly as the M5 vendor omission did.

---

## 3. API contract

Endpoints continue M5's numbering. **Every one is session-scoped to the account
owner and takes no `studentProfileId` in any form — AC 3 is satisfied
structurally, by the absence of the parameter, not by a check.**

| # | Route | Method | Auth | Body | Success | Failures |
|---|---|---|---|---|---|---|
| 48 | `/api/voice/consent-recording` | POST | Owner + `adultAttestedAt` | `{ contentType, durationMs }` | `201 { uploadUrl, pathname, grantId }` | **403** no attestation (AC 1) · **429** over `VOICE_ATTEMPTS_PER_WINDOW` |
| 49 | `/api/voice/consent-recording/[grantId]/confirm` | POST | Owner | `z.object({}).strict()` | `201 { consentRecordingId }` | **400** duration outside bounds · **404** grant not this user's · **409** grant spent |
| 50 | `/api/voice/sample` | POST | Owner | `{ contentType, durationMs, consentRecordingId }` | `201 { uploadUrl, pathname, grantId }` | **400** duration outside `VOICE_SAMPLE_MIN/MAX_MS` (AC 9) · **409** no consent recording for this user at the current wording version (AC 6) |
| 51 | `/api/voice` | POST | Owner + `adultAttestedAt` | `{ sampleGrantId, label }` | `202 { persona }` | **403** (AC 1/3) · **409** at `MAX_CUSTOM_VOICES_PER_USER` (AC 15) · **429** (AC 15) · **409** sample grant unspent/foreign |
| 52 | `/api/voice/[personaId]` | DELETE | Owner of that persona | — | `200 { deleted: true }` | **404** cross-account (AC 12) |
| 53 | `/api/voice/[personaId]/revoke` | POST | Owner of that persona | `z.object({}).strict()` | `200 { persona }` | **404** cross-account |

**Endpoint 51 is synchronous, not `after()`-scheduled.** The measurement timed
creation at ~2s. M4/M5's `after()` pattern exists for 12-59s work; using it here
would add a polling UI and a status machine to buy nothing. **If a future
measurement shows creation is slow or asynchronous, this is the decision to
revisit first.**

**The upload flow is M1's, reused exactly** (AC 11 is M1 AC 2 restated): the
server issues a grant with a **server-chosen pathname**, the browser PUTs bytes
straight to the store, and a confirm endpoint validates and records. No request
to our origin ever carries audio bytes.

### 3.1 AC 4's honest limit, stated here because it belongs in the contract

AC 4 requires that no path accepts "an audio file the in-app recorder did not
produce". **What this design actually guarantees:**

- ✅ No file input exists in the UI.
- ✅ The client cannot name the object — the pathname is server-chosen, so a
  request pointing at *some other stored object* is refused. That is the literal
  attack AC 4 describes.
- ✅ The grant is single-use, short-lived, and bound to the user.
- ❌ **It cannot prove the bytes came from a microphone.** A determined account
  owner can PUT any audio to the signed URL.

**That residual is accepted, and the reason should be written down rather than
glossed:** the actor is the *account owner*, cloning under a recorded consent
statement in their own voice, with an audit row naming them. The control that
matters against the real threat — a *child* cloning a classmate — is AC 2/AC 3:
there is no student-facing entry point, and every endpoint is owner-scoped.
Claiming microphone provenance we cannot enforce would be the more dangerous
error.

---

## 4. Component tree

```
app/(app)/account/voice/page.tsx          server — the flow's only entry point
  components/voice/voice-flow.tsx         "use client" — owns the step machine
    voice-consent-step.tsx                AC 5: prescribed wording, recorded FIRST
    voice-record-step.tsx                 AC 9/10: record, playback, re-record
    voice-review-step.tsx                 AC 10: explicit approve before any send
    voice-recorder.tsx                    MediaRecorder; the ONLY getUserMedia call
  components/voice/custom-voice-card.tsx  manage/revoke/delete an existing voice
```

- **Entry point (the M2.5 lesson):** a "Your voice" card on the account page,
  built in its own slice and actually linked. Seven green slices with no way in
  is this project's most repeated failure.
- **AC 22:** `getUserMedia` appears in exactly one file, asserted by a static
  test over the source tree.
- **AC 2:** a static test asserts no route under `(app)/students/**` links to
  `/account/voice`.
- **AC 16:** M5's `ai-voice-disclosure.tsx` already exists. For a custom voice it
  must name the adult and say it is a recreation — *"An AI recreation of Dad's
  voice, not a recording of him."* This is the disclosure that matters most.

---

## 5. Slice order

Each slice is independently reviewable and leaves the suite green.

| # | Slice | Why here |
|---|---|---|
| 1 | **Persona visibility scoping** — the single DAL reader, all three call sites, the static test | **Before any owned persona can exist.** §1. |
| 2 | Migration: `ownerUserId`, `status`, three models, `ConsentScope.VOICE_CLONING`, retention rows | Schema before anything reads it |
| 3 | Vendor client — `lib/voice/provider.ts`, `fetch`, create + delete, typed failures | Isolated, and the measurement already proved the shapes |
| 4 | Consent recording — endpoints 48/49, blob-direct upload, the append-only consent row | AC 5/6/7/8. Must precede the sample (AC 5's ordering) |
| 5 | Sample capture — endpoint 50, duration bounds | AC 9/11 |
| 6 | Creation — endpoint 51, caps, audit row, sample deletion | AC 13/14/15/21 |
| 7 | **Deletion and revocation — endpoints 52/53, and the four vendor-reaching paths** | Its own slice, per retro lesson 19 |
| 8 | The flow UI — recorder, consent, review steps | AC 5/9/10/22 |
| 9 | **THE ENTRY POINT** — the account-page card, and the custom-voice disclosure | The M2.5 lesson |
| 10 | Notice + privacy copy, and the test that keeps them complete | §2.3 |

**Slice 7 is deliberately separate and is the highest-risk slice.** AC 19/20
require deletion to reach the vendor from *four* paths: explicit voice deletion,
consent revocation, student-profile deletion, and account deletion. M5's review
found the equivalent purge could over-delete; M3/M4's reviews each found an
untested cascade. This slice gets integration tests against real Postgres for
every path, and a `VENDOR_DELETE_FAILED` audit row when the vendor call fails —
because a deletion that stops at our database is not a deletion, and one that
fails silently is worse than one that errors.

---

## 6. ADRs this plan requires

The spec asks for two. Both are written after approval, before their slices:

- **ADR-0022 — the consent artifact is recorded before the sample, stored
  separately, and never leaves us.** Covers ordering (AC 5), the blob layout, the
  binding to `ParentalConsent` via append-only `VOICE_CLONING`, and why the
  recording is never sent to the vendor or transcribed.
- **ADR-0023 — an account-owned persona is one nullable column and one required
  WHERE clause.** Covers the extend-vs-parallel decision, the single-reader DAL
  rule, and the static test that enforces it.

---

## 7. Decisions the OWNER must make before slice 4

1. **The prescribed consent wording (AC 5).** Versioned like the M0 notice. **The
   flow cannot ship with placeholder copy.** Needs to name the speaker, this app,
   and that their voice will be recreated to narrate lessons for their children.
2. **`MAX_CUSTOM_VOICES_PER_USER`.** The spec assumes **one**. Recommend one.
3. **Sample retention window** — how long the raw sample is kept after the clone
   exists. Recommend deleting it immediately on success; it has no further
   business need and is the most sensitive object we hold.
4. **Consent recording retention.** It is the artifact answering "was this
   authorised", so it plausibly outlives the voice. Needs its own stated need.
5. **The key-scope question** from the measurement: keep one key that can delete
   every voice, or narrow it and issue a write-scoped key for M6.

Items 1-4 are spec open questions already; item 5 is new from the measurement.

---

## 8. What this plan does NOT do

- **No SDK.** `fetch`, as M5 established. Adding `@elevenlabs/elevenlabs-js`
  remains a decision requiring approval, and nothing here needs it.
- **No second adult, no multiple voices per child, no clone improvement, no
  vendor verification handshake beyond surfacing AC 13.** All out of scope in the
  spec; the seams are left, not built.
- **No claim that vendor deletion is contractual erasure.** The API reports the
  voice gone. Whether the model and derived data are erased from the vendor's
  systems is a DPA question, and M6's promise to a parent rests on both.
