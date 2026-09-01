# ADR-0020: ElevenLabs is called with `fetch`, behind a persona row that owns the voice id

- **Status:** Proposed
- **Date:** 2026-09-01
- **Deciders:** Jaysh (pending — see "Follow-up required")
- **Spec:** docs/specs/m5-narration-and-personas.md (AC 1, 2, 3, 5, 7, 8, 12)

## Context

M5 needs a text-to-speech vendor and a way for a student to choose a voice. Two
separable decisions have been travelling as one, and this ADR separates them.

**What is already settled.**

- The owner has approved **ElevenLabs** as the vendor. Commercial use requires
  a paid plan; the free tier forbids it outright.
- `ELEVENLABS_API_KEY` is set and is deliberately **scoped** to `voices_read`
  and `text_to_speech`. `GET /v1/user/subscription` returns 401 because the key
  lacks `user_read`, which is the right default for a synthesis credential.
- The owner has chosen six personas and their voices, recorded in the spec's
  open questions.

**What the measurement established** (2026-09-01, real account, real API —
`docs/research/m5-narration-measurement.md`). These are facts, taken with
`fetch` and no SDK:

- `POST /v1/text-to-speech/{voice_id}/with-timestamps` returns 200 on **both**
  `eleven_flash_v2_5` (262 ms) and `eleven_multilingual_v2` (976 ms), with full
  alignment from both. The research could not confirm this and the spec named it
  the one experiment that constrains the architecture.
- The account has **21 current `premade` voices**, so the documented 2026-12-31
  expiry of the legacy default set does not bite today.
- Alignment is **character-level**: 59 characters in, 59 start and 59 end times
  out, no `words` array. (ADR-0021 owns what we do about that.)
- The whole measurement cost ~91 credits — one to two US cents.

**What forces a decision now.**

1. **AC 1 forbids a provider voice identifier appearing as a literal in
   application code**, because the stock voice set carries a published expiry:
   an id compiled into the app is an outage with a calendar entry. AC 3 requires
   that when a voice id stops resolving, the student still gets a working
   lesson.
2. **AC 2 forbids a persona that identifies or evokes a real individual.** Three
   names in the owner's first list had to change for exactly this reason, and
   the constraint will recur every time personas are extended.
3. **The constitution says never to add a new major dependency without asking.**
   The official SDK, `@elevenlabs/elevenlabs-js`, is such a dependency. Nothing
   in this repo depends on it today, and the measurement deliberately avoided it
   so that finding out whether the vendor works did not require first installing
   something we might not keep.
4. **AC 12 requires the outbound request to carry the narration text and voice
   selection only** — no display name, no email, no profile id, no identifier in
   the request metadata.

## Decision

**We will call ElevenLabs with `fetch`, from one server-only module, and add no
new dependency.** `lib/narration/provider.ts` will be the only file in the
application that knows the vendor's URL, header name or payload shape, and it
will expose one function taking `{ text, providerVoiceId, modelId,
outputFormat }` and returning `{ audio: ArrayBuffer, alignment }` or a typed
error.

The two endpoints M5 needs are:

- `POST /v1/text-to-speech/{voice_id}/with-timestamps` — synthesis plus
  alignment, `model_id: eleven_multilingual_v2`, `output_format:
  mp3_44100_128`.
- `GET /v2/voices` — used by the pre-seed check (plan §8.4), not at runtime.

**We will use the quality model for M5**, because M5 pre-generates: 700 ms of
extra generation time is invisible when it happens once, server-side, ahead of
playback, and the audio is heard many times. The model id will be recorded on
every cached row, so a future switch is a data question rather than an
archaeology question. The measurement is explicit that this **does not**
foreclose a low-latency synced surface later — the fast model returns the same
alignment on the same endpoint — so nothing in M5's cache design hedges against
one.

**We will put a persona row between the student and the voice id.** A `Persona`
is a database row holding a slug that is ours, a human-readable label, a
description, a preset artwork id, and the provider's voice id. Application code
refers to a persona by **slug** (`DEFAULT_PERSONA_SLUG` in `lib/config.ts`);
only a database row holds a `providerVoiceId`, and only a migration writes one.

Three consequences are the point of the indirection:

1. **A voice id that stops resolving is a data fix**, not a deploy. AC 3's
   fallback path will resolve the default persona and log the unresolvable id;
   the student sees a working lesson rather than silence.
2. **The cache key already contains the voice id** (ADR-0015), so remapping a
   persona's voice produces new assets rather than corrupting old ones, and the
   old assets remain correctly attributed to the voice that actually spoke them.
3. **M6's custom voice is a persona row with an owning account** and nothing
   else in M5 has to change. That is the seam the spec asked for.

**The voice ids are seed data.** The six rows will be inserted by the M5
migration rather than by a `prisma/seed.ts`, because there is no seed script in
this repo today and a second command that has to be remembered on every
environment — including Neon, where `pnpm db:migrate:prod` is the only step
anyone runs — is an app with no personas the first time it is forgotten.

## Alternatives considered

### Install `@elevenlabs/elevenlabs-js`

- **Pros:** Typed request and response shapes; the vendor's own retry and error
  classes; multipart upload handled for M6's instant voice cloning; the path
  most future readers would expect.
- **Cons:** A new major dependency, which the constitution says to ask about,
  for a surface of **two JSON endpoints**. The research could not pin its
  version (sources disagreed: 2.61.0 vs 2.40.0) and read no installed source.
  The measurement — the only thing in this project that has actually talked to
  the vendor — used `fetch`, so adopting the SDK would mean the live test and
  production no longer exercise the same wire path, which retro lesson 17 says
  is how a doubt survives a test suite. The comparison with `@anthropic-ai/sdk`
  does not carry: that dependency buys streaming, structured output with schema
  parsing, prompt-cache control and typed errors across a surface we use
  heavily. Here it would buy a URL and a header.
- **Rejected because:** it costs an approval and a supply-chain surface for no
  capability M5 needs. **This is a recommendation, not a fait accompli** — the
  owner may say yes, and if so only `lib/narration/provider.ts` changes.

### Hardcode the six voice ids in `lib/config.ts` and make personas a TypeScript constant

- **Pros:** No table, no migration, no seed problem, no join. Personas are
  identical for every account until M6 anyway.
- **Cons:** AC 1 forbids it in as many words, and the reason is documented: the
  stock voice set carries a published expiry. A remap would then be a code
  change and a deploy, on a path whose failure mode is every student's chosen
  voice breaking at once, during a school year. It also makes M6 — a persona
  with an owning account — a schema change rather than a row.
- **Rejected because:** the criterion exists precisely to prevent it, and the
  expiry is a calendar entry, not a hypothetical.

### Cartesia (Sonic) instead

- **Pros:** Genuinely better on our decisive axis — it returns `word_timestamps`
  already grouped into words, which would make ADR-0021 unnecessary. Cloning
  from ten seconds of audio.
- **Cons:** The owner has approved ElevenLabs, the key exists and is scoped, and
  the measurement has already been taken against it. Timestamp language coverage
  for the `sonic` model is documented as en/de/es/fr only, which matters for a
  product that intends to tutor foreign languages (M8). The ten-second cloning
  threshold is a lower barrier to misuse in an app serving minors — a liability
  consideration, not a feature.
- **Rejected because:** switching vendors now would discard the one measurement
  we have and re-open a settled approval, to avoid a word-grouping problem that
  the measurement shows is deterministic. It remains the credible backup if
  character-to-word grouping proves unreliable (plan §8.1 N2 is the signal).

### OpenAI TTS (`gpt-4o-mini-tts`)

- **Pros:** One fewer vendor relationship; we already hold an Anthropic
  relationship, not an OpenAI one, so this is no saving in practice.
- **Cons:** No evidence any timestamp data is returned at all, which makes the
  whiteboard sync require a separate forced-alignment pass — a round trip, a
  cost and a failure mode. No cloning, so M6 is impossible on it.
- **Rejected because:** it cannot do the one thing that makes narrated lessons
  work.

### Let the student's chosen voice be a foreign key straight to a provider voice id

- **Pros:** One less table.
- **Cons:** The research names this specifically: given the expiry, do not let a
  student's chosen voice be an un-remappable reference to a provider id. A
  persona is also a product object — a name, a personality, artwork — and a
  voice id is none of those.
- **Rejected because:** it merges an identifier we do not control with a product
  concept we do.

## Consequences

### Positive

- No new dependency, so no approval is needed for one, and the supply chain is
  unchanged.
- The live measurement and production will exercise the same wire path, so the
  test keeps meaning something.
- A voice id that expires or is withdrawn is a migration, not a deploy.
- M6's custom voice becomes a persona row with an owning account, with no change
  to M5's cache, DTOs or player.
- AC 12 is enforceable in one file: there is exactly one place a request body is
  constructed, so "the request carries text and voice only" is a test against
  one function rather than a habit spread across a pipeline.

### Negative / accepted trade-offs

- **We own the wire shape.** A vendor change to the response schema shows up as
  a parse failure in our code rather than a typed compile error. Mitigation: the
  provider module will validate the response with zod at the boundary, the same
  rule the constitution applies to all external input.
- **We own retries and error classification.** The SDK's `APIError` hierarchy
  would have been free; ours will be a small mapping from status codes to the
  narration failure codes.
- **M6's multipart voice upload will be hand-rolled** if we stay on `fetch`.
  That is a fair place to revisit this decision, and it is the "revisit when"
  below.
- **Personas are seeded by a migration**, so changing a label or a description
  is a migration too. For six rows that is acceptable and gives a clean audit
  trail; for a persona catalogue that grows it would become annoying.
- **`GET /v2/voices` is not called at runtime**, so a voice that disappears is
  discovered when synthesis fails, not before. AC 3's fallback is the control,
  and it is a runtime one.

### Vendor claims in this ADR are hypotheses, and here is what falsifies each

Retro lesson 18: three of M3's ADR claims about vendors were false within hours.
These are the load-bearing ones here.

- *We expect* `POST /v1/text-to-speech/{id}/with-timestamps` to accept
  `model_id: eleven_multilingual_v2` and `output_format: mp3_44100_128` together
  and return base64 audio plus alignment. **Measured on 2026-09-01** for the
  model; the output format was not varied in that run, so the format pairing is
  the untested half. *Falsifier:* a 400 or an unexpected content type on the
  first synthesis. *If false:* fall back to the default format, which the
  measurement did exercise.
- *We expect* the account's TTS concurrency ceiling to be at least 2.
  **Unverified** — the scoped key cannot read the plan tier. *Falsifier:* a 429
  with two requests in flight. *If false:* `NARRATION_MAX_CONCURRENCY = 1`, and
  a 12-step lesson serialises.
- *We expect* all six seeded voice ids to resolve on this account. The
  measurement listed 21 `premade` voices and confirmed **two** of the six by
  name (Jessica, Brian) plus Alice as a candidate; the other three are from the
  owner's list and have not been checked against the live account. *Falsifier:*
  plan §8.4's `GET /v2/voices` check. *If false:* fix the seed before the
  migration is applied anywhere.

### Follow-up required

- [ ] **Owner: yes or no to `@elevenlabs/elevenlabs-js`.** The recommendation is
      no. Until answered, `lib/narration/provider.ts` is written against `fetch`.
- [ ] **Verify all six voice ids resolve** (plan §8.4) before the migration is
      applied to any database.
- [ ] **Write `tests/unit/lib/narration/no-voice-id-literals.test.ts`** — it will
      read the seeded ids out of the migration SQL and assert none of them
      appears anywhere under `app/`, `lib/` or `components/`. AC 1 is a rule
      about code, so it should be enforced by reading the code, in the same
      spirit as the retention-coverage test. **This test does not exist yet.**
- [ ] **Name ElevenLabs in the §312.4 direct notice and add a vendor-assessment
      row** (M0 AC 12/13/52) before the first narration request. That is an M0
      edit and a hard precondition, and it may require re-noticing existing
      families — see plan §7.5.
- [ ] **Ask what the vendor retains** of submitted text and generated audio. We
      delete our copy; theirs is a contract question nobody has asked. Carried
      unchanged from ADR-0015.
- [ ] **Design the six persona artworks** (AC 2). Placeholders until then.

## Revisit when

M6 needs instant voice cloning — a multipart upload, a `requires_verification`
flag and a delete path is a materially larger surface than two JSON endpoints,
and it is the point at which the SDK may start earning its dependency. Or a
low-latency synced surface arrives (a live speaking tutor), at which point the
model choice, not the transport, is what reopens. Or narration cost becomes a
material line item, which is ADR-0015's trigger rather than this one's.
