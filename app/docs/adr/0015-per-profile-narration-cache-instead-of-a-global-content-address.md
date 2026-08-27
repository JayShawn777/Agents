# ADR-0015: Narration audio is cached per student profile, not globally content-addressed

- **Status:** Proposed
- **Date:** 2026-08-27
- **Deciders:** Jaysh (pending)
- **Spec:** docs/specs/m5-narration-and-personas.md, docs/specs/m6-custom-voice.md

## Context

M5 is a shallow-designed milestone and its API contract is deliberately not
fixed. But `NarrationAsset` lands in a migration, and how it is keyed decides
whether M0's deletion guarantees still hold once the app stores audio. That
cannot be deferred.

The cost argument for a global cache is made explicitly by the research.
`docs/research/elevenlabs-tts.md` §6: *"Caching generated narration + alignment
JSON in blob storage, keyed by a hash of (text, voiceId, modelId), is the
highest-leverage cost decision in this integration — lessons get replayed, and a
replay should never cost a credit."* M5 AC 7 reads almost the same way:

> Given narration already generated for a (narration text, voice id, model id)
> triple, when narration is requested again for the same triple — **the same
> lesson replayed, or a different lesson containing an identical narration
> line** — then no request is made to the TTS provider and the stored asset is
> reused.

A content-addressed key across the whole application is the obvious reading, and
it is the cheapest thing to build.

Pulling the other way is everything M0 established about deletion, plus two M5/M6
criteria:

- **M5 AC 20** — a lesson or a student profile is deleted, and *"the narration
  audio objects for that lesson are removed from the blob store, not only their
  database rows."*
- **M6 AC 19** — deleting a custom voice removes *"every cached narration asset
  generated with that voice id"* from the blob store.
- **ADR-0007 §1** — blobs are deleted before rows, always, and *"we accept a
  dangling row over a dangling file, because only one of those is a child's
  schoolwork sitting somewhere we promised it was not."*
- **M0 AC 46/48** — profile deletion and the parent's §312.6 request must leave
  nothing behind.

Narration audio is a recording of a machine reading a specific child's homework
aloud. M5's own data table rates it Medium and notes it *"speaks the content of a
child's homework aloud."*

The collision is exact. Under a globally content-addressed cache, two lessons for
two children in two different accounts that happen to contain the line *"Now we
find a common denominator"* — which they will, constantly, because that is what
lesson narration sounds like — share one object. A §312.6 request from one parent
then either deletes audio the other child's lesson still needs, or does not
delete it, in which case a byte-for-byte recording generated for a child we were
told to forget survives, reachable by another account's signed URL.

M5's open questions also flag that a regenerated lesson (M4 AC 19 creates a new
script version each time) produces narration objects that may outlive their row,
and that M0 AC 43's store-enumerating reconciler *"must cover the narration
prefix too"* — marked **blocking for the reconciler's configuration**.

## Decision

We will scope the narration cache **to the student profile**. The cache key is
still a hash of `(narrationText, providerVoiceId, ttsModelId)`, but it is unique
**per profile**, the object lives under that profile's pathname prefix, and the
row cascades from `StudentProfile`.

```prisma
model NarrationAsset {
  studentProfileId String
  personaId        String
  cacheKey         String   // sha256(text \0 voiceId \0 modelId)  — M5 AC 7/8
  providerVoiceId  String   // denormalised: M6 AC 19 deletes by voice id
  ttsModelId       String
  pathname         String @unique      // students/<profileId>/narration/<cacheKey>.mp3
  durationMs       Int
  cues             Json                // M5 AC 13 — OUR normalised format
  characterCount   Int

  studentProfile StudentProfile @relation(..., onDelete: Cascade)
  persona        Persona        @relation(..., onDelete: Cascade)

  @@unique([studentProfileId, cacheKey])
  @@index([providerVoiceId])
}
```

Three consequences are the point of the decision:

1. **Deletion is a cascade plus a prefix.** `deleteStudentData` already walks
   pathnames and deletes blobs before rows (ADR-0007 §1). Narration adds one more
   pathname source and nothing else. There is no refcount, no shared object, and
   no case where deleting one child's data affects another's.
2. **M6 AC 19 is one indexed query.** `providerVoiceId` is denormalised onto the
   asset, so "delete every cached narration generated with this voice" is
   `findMany({ where: { providerVoiceId } })` → read pathnames → `storage.del()` →
   delete rows. Across accounts, because a custom voice belongs to one account
   anyway.
3. **Every narration object sits under `students/<profileId>/`,** so the
   store-enumerating reconciler (M0 AC 43) covers it with a prefix change rather
   than a new mechanism, and an object whose row was never written is still
   findable.

### What AC 7 actually still buys

Read literally, AC 7 asks for reuse across "the same lesson replayed, or a
different lesson containing an identical narration line". Per-profile scoping
keeps **both** of those, because both are about one student:

- A replay costs nothing — the same lesson, same steps, same voice, same key.
- A regenerated lesson (M4 AC 19) reuses every narration line it kept from the
  previous version, which is the expensive case the research is actually worried
  about, since regeneration is where a whole lesson gets re-narrated.
- A second lesson for the same student on the same skill reuses its shared lines.

What is given up is reuse **across students**, which AC 7 does not require and
which M4's non-goals forbid at the lesson level anyway (*"No lesson reuse across
students in M4, and no cross-student cache"*).

### The registry that makes this not-forgettable

Adding narration means `deleteStudentData` now has two pathname sources instead
of one, and there will be a third (M6's voice sample, account-scoped). Rather
than a second `findMany` bolted into a function whose ordering is already
load-bearing, `lib/deletion/service.ts` gains an exported registry:

```ts
export const PROFILE_BLOB_SOURCES = [
  { model: 'upload',         where: (id) => ({ studentProfileId: id }) },
  { model: 'narrationAsset', where: (id) => ({ studentProfileId: id }) },
] as const;
```

with a unit test asserting that **every Prisma model carrying a `pathname` column
and reachable from `StudentProfile` appears in the registry.** A future model with
a blob and no registry entry fails CI rather than producing an orphan nobody
finds until a parent asks.

That test is the real deliverable of this ADR. The scoping decision makes
deletion *possible*; the registry makes forgetting it *loud*.

## Alternatives considered

### A global content-addressed cache, `@@unique([cacheKey])`
- **Pros:** The cheapest option, and the research's own recommendation. Maximum
  reuse: at scale, common tutoring sentences are generated once for the whole
  product. One row, one object, no duplication. It is what a CDN would do.
- **Cons:** It makes deletion unsatisfiable. M5 AC 20 and M0 AC 46 require a
  child's narration audio to be gone; a shared object cannot be deleted without
  breaking another child's lesson, and cannot be kept without retaining a
  recording made for a child we were told to forget. Refcounting is the usual
  answer and it is exactly the wrong tool here: a refcount that leaks leaves a
  permanent object, a refcount that under-counts deletes a live lesson, and
  neither failure is visible. ADR-0007 chose its failure direction deliberately
  — a dangling row over a dangling file — and a shared cache makes dangling files
  the *designed* outcome. It would also mean an object under no student's prefix,
  so the reconciler could no longer decide orphanhood by prefix.
- **Rejected because:** it trades a compliance guarantee for a cost saving, in
  the one category of data where the guarantee is the product.

### Global cache with a reference-count column
- **Pros:** Keeps the cost saving and makes deletion nominally correct.
- **Cons:** A distributed refcount across two systems (rows and blobs) with no
  transaction spanning them, decremented on four different deletion paths
  (profile, §312.6, closure, lesson regeneration) plus a retention sweep. Every
  one of those is a place to leak or over-delete. And the audit story becomes
  "we believe this object is unreferenced" rather than "this object was under the
  prefix of a profile that no longer exists."
- **Rejected because:** ADR-0007 already rejected the equivalent
  tombstone-and-count design for uploads, for the same reason: it cannot see the
  case that matters, and its failures are silent.

### Per-account (per-`User`) scoping rather than per-profile
- **Pros:** Siblings in one family share narration, which is the largest
  realistic overlap. Deletion is still tractable — one account, one boundary.
- **Cons:** M0 AC 46 and AC 48 are **per student profile**. Deleting one child's
  data in a two-child family would have to work out whether each object is still
  needed by the sibling — the refcount problem again, at family scale. And the
  §312.6 path is the one place we cannot afford a "mostly correct" answer.
- **Rejected because:** the deletion boundary in this product is the profile, and
  a cache boundary wider than the deletion boundary always reintroduces
  refcounting.

### Store narration inline in Postgres instead of blob storage
- **Pros:** One deletion path — the cascade. No orphans possible at all, since
  there is no second system.
- **Cons:** M5 AC 11 requires narration to be an object in the private blob store
  served by a signed URL, and forbids returning it inline through a function
  response body. Vercel's 4.5 MB function payload cap makes inline delivery
  unworkable for a full lesson regardless (research §7), and multi-megabyte
  `bytea` columns are a bad fit for Neon.
- **Rejected because:** AC 11 forbids it and the payload limit makes it
  impossible anyway.

### Do not cache at all — regenerate on every play
- **Pros:** Nothing to delete beyond the lesson itself. Simplest possible
  lifecycle.
- **Cons:** M5 AC 5 requires a lesson to play with full audio **when the TTS
  provider is unreachable**, which is only possible from stored assets. AC 7
  requires reuse in terms. And a replayed lesson would cost credits every time,
  against the explicit "a replay should never cost a credit" goal.
- **Rejected because:** AC 5 makes stored assets mandatory, not optional.

## Consequences

### Positive
- Every M0 deletion guarantee continues to hold with narration in the picture,
  using the mechanism that already exists rather than a new one.
- M6 AC 19 — delete every narration made with a revoked parent's voice — is one
  indexed query, across the whole store, with no traversal.
- Every narration object is under `students/<profileId>/`, so the
  store-enumerating reconciler's coverage is a prefix, and M5's open question
  about regenerated-lesson orphans is answered by the control M0 already built.
- The `PROFILE_BLOB_SOURCES` registry plus its test means M6's voice sample and
  anything after it cannot be silently omitted from the destructor.
- The cache still eliminates the two expensive cases: replay, and re-narrating a
  regenerated lesson.

### Negative / accepted trade-offs
- **We pay to generate the same sentence for every student who hears it.** At
  scale this is real money and the research called the global cache the
  highest-leverage cost decision in the integration. We are knowingly declining
  it. Metering is per character, so the cost is proportional to lesson volume;
  `NARRATION_DAILY_BUDGET_CHARS` per profile (M5 AC 21) is the control that keeps
  it bounded rather than the cache.
- **Storage duplicates.** N students hearing the same line means N objects.
  Blob storage is cheap relative to TTS credits, so this is the right side of the
  trade, but it is a growth curve to watch.
- **`providerVoiceId` is denormalised** onto every asset and can in principle
  disagree with the persona's current value. It is written once and never
  updated; a persona whose voice id is remapped (M5 AC 3) leaves old assets keyed
  to the old id, which is correct — they *were* generated with it, and M6 AC 19
  needs exactly that historical truth.
- The `cues` JSON is stored per asset rather than per lesson step, so a lesson
  that reuses a line reuses its cues. That is right, and it is also why the cue
  format must be relative to the line (offsets from the start of that audio file)
  and not to the lesson.
- A shared cache remains possible later — the key is already content-addressed —
  but it would require answering the deletion question first, which is the whole
  reason it is not being done now.

### Follow-up required
- [ ] **Add the narration prefix to the reconciler's configuration** before M5
      ships. M5's open question marks this blocking, and an audio object with no
      row is invisible to every row-driven deletion path.
- [ ] Write the `PROFILE_BLOB_SOURCES` registry and its "every model with a
      pathname is listed" test **in M5's first commit**, before the first
      narration object is ever written.
- [ ] Add `NARRATION_AUDIO` to M0's `RETENTION_POLICY` (life of the source
      lesson), plus `VOICE_SAMPLE` and `VOICE_CONSENT_RECORDING` for M6. The
      existing bijection test will fail until each windowed row has a job step,
      which is the desired behaviour.
- [ ] Name the TTS vendor in the §312.4 direct notice (M0 AC 12/13) and add a
      vendor assessment row (M0 AC 52) **before** the first narration request.
      That is an M0 edit, not an M5 one, and it is a hard precondition.
- [ ] Confirm the vendor's own retention of submitted text and generated audio.
      We delete our copy; whether they delete theirs is a contract question
      nobody has asked.

## Revisit when

Narration cost becomes a material line item and the volume justifies solving the
deletion problem properly (a shared cache with a defensible deletion story is a
new ADR, not an amendment to this one); or the deletion boundary changes — for
example if multi-adult accounts arrive and profiles stop being the unit of
erasure; or a vendor appears whose pricing makes per-student generation free, at
which point the cache's only remaining job is offline playback under AC 5.
