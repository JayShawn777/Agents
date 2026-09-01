# ADR-0021: Narration cues are our own millisecond word timeline, derived once from character alignment

- **Status:** Proposed
- **Date:** 2026-09-01
- **Deciders:** Jaysh (pending)
- **Spec:** docs/specs/m5-narration-and-personas.md (AC 13, 14, 15, 16)

## Context

The vendor returns **character-level** alignment and nothing else. This is
measured, not cited: for a 59-character sentence, `docs/research/m5-narration-measurement.md`
recorded 59 characters, 59 start times, 59 end times and **no `words` array**.
Marketing copy elsewhere mentions word-level timestamps; the API does not
return them on this endpoint.

So grouping characters into words is **our** problem. The spec asks for an ADR
about it for two reasons, and only one of them is the grouping.

**The first reason is lock-in.** The research names it: *"If we cache alignment
JSON in ElevenLabs' exact shape, switching to Cartesia later means a
migration."* AC 13 turns that into a criterion with a test attached — *"Delete
the raw payload and replay the lesson: it must still sync."*

**The second reason is mathematics.** The measurement's own closing note: *"'3/4'
is read aloud as words that do not correspond one-to-one with the characters on
the whiteboard, and M4's lesson scripts are full of LaTeX. That seam deserves
an explicit decision, not an inherited assumption."* AC 14 makes the fixture
line "solve for x: 3x plus 5 equals 20" mandatory for exactly this reason.

Three further constraints shape the format:

- **ADR-0015 scopes the cache to the student profile and keys it on the
  narration line**, so one audio asset can be referenced by several lessons of
  the same student. Its own consequences section says the cue format must
  therefore be relative to the line, not to the lesson.
- **M4 already has a `CueSource` seam** (`lib/lessons/cues.ts`), built so that
  M5 replaces the timing source without touching the player. Its `Cue` type is
  `{ stepId, startOffsetMs, durationMs }`, in integer milliseconds.
- **M5 narrates per step, one audio file per step** (plan §0), which is what
  makes AC 15's "no cumulative drift, the last step as strictly as the first"
  structural rather than arithmetic.

## Decision

We will store **two things, both ours, both in integer milliseconds**, and we
will not store the provider payload at all.

**1. Per asset — a word timeline relative to that audio file.** `cues` on
`NarrationAsset`, written once at generation, alongside `cueFormatVersion`
(`CUE_FORMAT_VERSION`, `"1"`):

```jsonc
{
  "v": 1,
  "durationMs": 3158,
  "words": [
    { "t": "solve", "s": 0,   "e": 412 },
    { "t": "for",   "s": 412, "e": 598 }
  ]
}
```

`s` and `e` are offsets from the **start of this audio file**, never from the
start of a lesson — because the same file may be step 2 of one lesson and step
5 of another. That is ADR-0015's cache working as designed, and an absolute
offset would be silently wrong on the second lesson.

**2. Per lesson — a step timeline.** `LessonNarrationStep` rows carrying
`{ stepId, stepIndex, startOffsetMs }`, where `startOffsetMs` is the running
sum of the durations of steps 0..k-1 and the duration comes from the referenced
asset. This is AC 13's "step id, start and end offsets in milliseconds", and it
maps onto M4's existing `Cue` type with no conversion, so
`lib/narration/cue-source.ts` will return the `CueSource` the player already
consumes.

**The derivation rule (AC 14), stated so two people implement it identically.**
A word is a maximal run of non-whitespace characters in the text **we sent**.
Its start is the start time of its first character; its end is the end time of
its last character. Times arrive in seconds as floats and are converted with
`Math.round(seconds * 1000)`. Punctuation attaches to the word it touches. A
run of whitespace produces no word. Words are emitted in input order and their
times are clamped to be non-decreasing.

**We will read the `alignment` array, not `normalized_alignment`.** `alignment`
maps to the original text as we sent it, so its indices correspond to the string
we authored and can annotate; `normalized_alignment` maps to the vendor's
expanded text, whose indices correspond to nothing we hold. **This is an
assumption about vendor behaviour and plan §8.1 N2 is the experiment that
falsifies it**: if `alignment.characters.join("")` is not byte-identical to our
input, this decision is wrong and word grouping has to key off the normalised
array — which would change what a "word" even refers to, since the normalised
text is not the text on screen.

**We will not store the raw provider payload.** Not in the row, not in the blob
store, not in a log. AC 13's test — delete the raw payload and replay — is then
true by construction rather than by discipline, because there is nothing to
delete.

**We will derive and store word cues even though M5 renders none of them.** AC
14 is about the derivation, and the derivation is where mathematics silently
drifts; deriving it at generation time means a wrong grouping is inspectable in
a row rather than reconstructable only by re-calling a paid API. Word-level
caption highlighting is explicitly out of scope for M5 — **nothing in M5 will
render `words`**, and this ADR claims no acceptance criterion for it beyond
AC 14's derivation.

### What the format is deliberately not

- Not seconds. The vendor's floats do not compare or sum cleanly, and M4's
  timeline is already integer milliseconds. One unit, one place.
- Not character-level. We keep words, not the 59 per-character spans. Characters
  are the vendor's unit of billing and of alignment; they are not a unit anyone
  in this product needs, and storing them would be storing the payload under
  another name.
- Not a per-lesson concatenated timeline. See ADR-0015: assets are shared.

## Alternatives considered

### Store the provider's `alignment` object verbatim and interpret it at playback

- **Pros:** Nothing to derive at generation time; no chance of a derivation bug
  baking a wrong timeline into a row; the raw data is there if we later want
  character-level anything.
- **Cons:** It is the lock-in the research warned about, and AC 13 forbids it in
  as many words — the criterion's test is "delete the raw payload and replay".
  It also pushes the maths problem to the client, where it would run on every
  play instead of once, and where a fix would require shipping JavaScript rather
  than backfilling rows.
- **Rejected because:** AC 13 exists specifically to prevent it.

### Use `normalized_alignment` instead of `alignment`

- **Pros:** It is the alignment of what was actually *spoken*, so for expanded
  tokens ("20" → "twenty") the character spans are meaningful in isolation.
- **Cons:** Its indices correspond to text we never authored and never display.
  A cue derived from it cannot be related back to the narration line, the
  caption, or anything on the whiteboard. For our use — "the drawing for step k
  starts when step k's audio starts" — it buys nothing.
- **Rejected because:** we need cues that index the text we hold. Kept as the
  contingency if plan §8.1 N2 shows `alignment` is not index-aligned to our
  input.

### Call the Forced Alignment endpoint to get a real `words` array

- **Pros:** The vendor does the grouping and returns per-word confidence, which
  would be a genuine signal on mathematical text.
- **Cons:** A second round trip per line, extra cost, and a second failure mode
  on the generation path, to replace a grouping rule that is deterministic and
  fits in a paragraph. The spec already lists it as out of scope and as a
  fallback rather than a default.
- **Rejected because:** it is a fallback for a problem we have not yet measured.
  Plan §8.1 N4 is what would promote it.

### Derive words in the browser at playback time from stored character arrays

- **Pros:** No format decision at all; the "our format" question disappears.
- **Cons:** It requires storing the character arrays, which is the first
  alternative wearing a hat, and it runs the same derivation on every play on
  every device.
- **Rejected because:** it is the lock-in option plus a performance cost.

### Store cues on `LessonNarrationStep` rather than on `NarrationAsset`

- **Pros:** The lesson timeline and the word timeline would live together, and
  a reader would need one join fewer.
- **Cons:** The cues belong to the audio, and the audio is shared between
  lessons. Storing them per step would duplicate them on every reuse and make
  "these two rows describe the same audio" a thing that could become false.
- **Rejected because:** the cache's unit is the asset, so the cues' unit is the
  asset. ADR-0015 already says this.

## Consequences

### Positive

- Switching vendors becomes a change to one derivation function. Cartesia
  already returns grouped words; feeding them into this format is a mapping,
  not a migration.
- AC 13's "delete the raw payload and replay" is true because the payload is
  never written.
- The player is unchanged: `narrationCueSource(steps)` will satisfy the
  `CueSource` interface M4 built for exactly this substitution.
- A wrong word grouping is visible in a database row, in our own units, next to
  the text it came from — which is the only way the mathematics problem becomes
  debuggable rather than anecdotal.
- Because each step is its own file, the step timeline is a sum of measured
  durations rather than a prediction. AC 15's last step is as accurate as its
  first for structural reasons.

### Negative / accepted trade-offs

- **The derivation is lossy and irreversible.** If we later want character-level
  data, it means regenerating — which costs credits. Accepted: characters are
  the vendor's unit, not ours, and `CUE_FORMAT_VERSION` makes a format change a
  data question with a known cost.
- **Rounding to milliseconds loses sub-millisecond precision.** Irrelevant
  against a 150 ms sync tolerance, and it buys integer comparisons everywhere.
- **A word whose characters the vendor expanded gets a span covering the whole
  expansion.** "20" spoken as "twenty" yields one word with a ~600 ms span. That
  is correct for our purpose and would be wrong for lip-sync; we are not doing
  lip-sync.
- **Nothing renders `words` in M5**, so the derivation's correctness is held by
  a fixture test rather than by anything a user would notice. That is a real
  weakness and it is why AC 14's fixture is described in the spec as not
  optional.

### Follow-up required

- [ ] **Run plan §8.1 before the derivation is written.** N2 decides which
      alignment array this ADR is built on; N3 and N4 decide whether the
      derivation needs a repair pass for degenerate spans. If N2 comes back
      false, this ADR needs a dated revision note before slice 4 starts.
- [ ] **Write `tests/unit/lib/narration/cues.test.ts` with the AC 14 fixture**
      — "solve for x: 3x plus 5 equals 20", from a recorded real response, not a
      hand-invented one. Retro lesson 20: a fixture must be a state a real
      writer produces. **This test does not exist yet.**
- [ ] **Decide what `cues` does when the character count disagrees with the
      input length.** The plan's position is to fail the run with a typed
      failure code rather than emit a timeline nobody can trust; that becomes a
      real decision once §8.1 N2 says whether it can happen.
- [ ] **Re-check this ADR when word-level caption highlighting is built** (M6+).
      It is the first consumer that will actually read `words`, and the first
      chance to find out whether the derivation was right.

## Revisit when

Plan §8.1 N2 falsifies the `alignment` assumption; or a second TTS vendor
appears in the product and the mapping function acquires a second
implementation; or word-level highlighting ships and the derivation is finally
observable by a user rather than only by a test.
