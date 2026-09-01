# Measurement: the TTS vendor, before M5's architecture

- **Date:** 2026-09-01
- **Taken by:** `tests/unit/live/narration.live.test.ts` (`RUN_LIVE_AI=1`, real API, real account)
- **Question:** M5's spec says of its second open question, *"Run the experiment
  before the architect fixes the shape."* This is that run.
- **Verdict:** **Both blocking unknowns are resolved, and one came back the
  opposite of what the design assumed.** M5's architecture may now be fixed.

## Why this exists

M4's plan §9.2 gated its contract on five measurements and four of the five
changed the design. Retro lesson 18 is the other half: an ADR's claims about a
vendor are hypotheses, and three of M3's were false within hours of
implementation starting. The research note
[elevenlabs-tts.md](elevenlabs-tts.md) is careful and good, but it is reading
documentation. This is the account answering.

Deliberately taken with `fetch` and **no SDK**, so that finding out whether the
vendor does what the docs claim did not require first installing a dependency
the constitution says to ask about.

## 1. Does the with-timestamps endpoint work on the LOW-LATENCY model?

**YES — and the research could not confirm it.** This was named as the one
experiment that constrains the architecture.

| model | with-timestamps | round trip | audio bytes |
|---|---|---|---|
| `eleven_flash_v2_5` | **200 OK** | 262 ms | 56,886 |
| `eleven_multilingual_v2` | 200 OK | 976 ms | 51,453 |

Both return full alignment. The fast model is **3.7x faster and half the credit
cost** (0.5 vs 1.0 credits/character).

**What this changes.** The spec reasoned that because M5 pre-generates
everything, the expressive model is the natural choice and the low-latency
question only matters for a hypothetical future. That reasoning holds for M5 —
but the *consequence* it feared does not exist: choosing quality for M5 does
**not** foreclose a low-latency synced surface later. A live speaking tutor
(M8's territory) is reachable on the same endpoint and the same alignment
format. Nothing about M5's cache design needs to hedge against it.

**Recommendation:** use the quality model for M5's pre-generated narration —
this is cached audio a child hears many times, and 700 ms of extra generation
time is invisible when it happens once, server-side, ahead of playback. Record
the model on the cached row (as M4 does) so a future switch is a data question,
not an archaeology question.

## 2. Which stock voices does this account actually have?

**21 `premade` voices.** The research flagged that the legacy default voice set
is documented to expire 2026-12-31 and might not exist for accounts created
after March 2026. This account has a full, current set, so AC 1's persona list
can be populated from something real.

Several are plainly suited to a child tutor and are worth putting in front of
the owner as persona candidates:

| voice id | name |
|---|---|
| `Xb7hH8MSUJpSbSDYk0k2` | Alice — Clear, Engaging Educator |
| `EXAVITQu4vr4xnSDxMaL` | Sarah — Mature, Reassuring, Confident |
| `JBFqnCBsd6RMkjVDRZzb` | George — Warm, Captivating Storyteller |
| `nPczCjzI2devNBz1zQrb` | Brian — Deep, Resonant and Comforting |
| `cgSgspJ2msm6clMCkdW9` | Jessica — Playful, Bright, Warm |
| `SAz9YHcvj6GT2YYXdXww` | River — Relaxed, Neutral, Informative |

**This does not settle the persona list.** Spec AC 1 requires personas to be
database rows with original names and descriptions, and the vendor's voice is an
*indirection behind* a persona, not the persona itself — which is exactly what
makes AC 3 (the provider voice id stops resolving) survivable. Naming and
designing four to six personas is still an owner/product decision.

**Do not hardcode a voice id in application code.** AC 1 says a database row,
and the expiry risk above is the reason.

## 3. The alignment is character-level — confirmed, not cited

For the 59-character test sentence: 59 characters, 59 start times, 59 end times,
**no `words` array**. Total duration 3.158 s.

So grouping characters into words is **our** problem, which is precisely why the
M5 spec asks the architect for an ADR on our own normalised cue format. It also
means the cue format is where mathematics will hurt: "3/4" is read aloud as
words that do not correspond one-to-one with the characters on the whiteboard,
and M4's lesson scripts are full of LaTeX. **That seam deserves an explicit
decision, not an inherited assumption.**

Useful secondary numbers: ~53 ms of audio per character, and roughly 17 KB of
MP3 per second — so a typical lesson step lands around 50 KB and a whole lesson
in the low hundreds of KB. Cache sizing and the blob retention story can be
reasoned about from that.

## 4. Cost, measured

This run spent **~91 credits** in total: a 2-character permission probe, then
the 59-character sentence through both models (59 x 0.5 + 59 x 1.0 + 2).

On a paid plan that is **roughly one to two US cents.**

The exact figure could not be read back from the account: the API key is
**scoped** and lacks the `user_read` permission, so `GET /v1/user/subscription`
returns 401. That is a good default for a key that only needs to read voices and
synthesise speech — the production key should keep exactly the permissions it
needs (`voices_read`, `text_to_speech`) and nothing more. If a usage dashboard
is ever wanted in-app, that is a deliberate, separate grant.

## What is still NOT answered

- **Nothing about how narration sounds to a child**, or which persona a nine-
  year-old actually picks. That is user testing, not an API call.
- **Nothing about mathematics read aloud.** The test sentence was prose. How
  `\frac{1}{4}` should be spoken is an open design question and the highest-risk
  unknown remaining in M5.
- **Nothing about the sync tolerance** in AC 15's replacement (the spec's 150 ms
  assumption). Still unmeasured, still configuration.
- **The account's plan tier and quota**, per the permission note above.

---

# Part 2: how mathematics is read aloud (plan §8.1)

- **Date:** 2026-09-01
- **Gates:** backend slices 4 and 5. Run before either was written.
- **Cost:** four calls, ~80 characters. Under two US cents.
- **Verdict:** **all four questions answered, and the plan's stated default
  survives.** Narration is sent verbatim and LaTeX is prevented at authoring
  time, never repaired at speech time.

## N1 — how much real narration is not plain words?

**Zero API calls.** Every `narration` string available from real authored M4
output (nine, across the three fixtures kept in `tests/e2e/fixtures/`) is clean
prose. No backslash, no brace, no bare operator.

**n is 9 and they are curated, so this is weak evidence** — and it does not
matter, because it points the same way either way. A rate near zero makes the
author-time guard a cheap assertion that almost never fires; a material rate
would make it load-bearing. Cheap and load-bearing are the same code. What
would change the design is a rate near zero **plus** a decision to skip the
guard, and §8.1 explicitly does not do that.

## N2 — is `alignment` index-aligned to the exact string we sent? **YES**

This is ADR-0021's foundation, and it holds.

```
input:                     "solve for x: 3x plus 5 equals 20"
alignment.characters.join: "solve for x: 3x plus 5 equals 20"   → identical
start times monotonic:     true
```

**But `normalized_alignment` is NOT the same string.** It came back as
`" solve for x: 3x plus 5 equals 20 "` — padded with a leading and trailing
space. Its indices therefore do **not** correspond to our text.

**Consequence, and it is a one-line trap:** word grouping must key off
`alignment`, never `normalized_alignment`. The two fields differ by two
characters, which is exactly the kind of difference that produces a cue
timeline that is subtly, unfixably off by one word and looks like a sync bug.
ADR-0021 should say this explicitly rather than leaving the next reader to pick
the more official-sounding field name.

## N3 — what does the vendor do with LaTeX, and with bare symbols?

| input | chars | duration | seconds per character |
|---|---|---|---|
| `\frac{1}{4} is one quarter` | 26 | 2.368 s | **0.0911** |
| `3x + 5 = 20` | 11 | 1.718 s | **0.1562** |
| `one quarter` | 11 | 1.115 s | 0.1014 |

**Bare symbols are expanded, and expanded well.** `3x + 5 = 20` takes 1.7
seconds for eleven characters — half again the per-character rate of plain
prose. That is the signature of "three x plus five equals twenty" being spoken:
far more speech than eleven characters of text. **No normaliser is needed for
`+`, `=` or a coefficient.**

**LaTeX is the opposite, and worse than "read literally".** The LaTeX line runs
at 0.0911 s/char — *below* plain prose. If `\frac{1}{4}` were being read out as
"backslash frac open brace one close brace" the rate would be far higher, not
lower. The markup is being largely **swallowed**: the child hears something like
"one four is one quarter", or "frac one four is one quarter".

That is the dangerous failure, not the loud one. A child who hears
"backslash frac" knows something is broken. A child who hears "one four is one
quarter" hears a confident, fluent, **wrong** explanation of their homework.

**And it corrupts the cues as well as the audio.** The alignment still maps 1:1
onto our input (N2), so characters that produce no audible speech — `\`, `{`,
`}` — are still assigned real time spans. Any word-level timeline built over
LaTeX is wrong in both directions at once.

**So the default holds and is now evidence-backed:** narration must never
contain LaTeX, and the place to stop it is authoring, where a violation can be
regenerated — not speech, where it can only be papered over.

## N4 — do expanded tokens produce degenerate spans? **NO**

Over `"solve for x: 3x plus 5 equals 20"`: zero characters with `end < start`,
eight whitespace-delimited words, zero with a non-positive span.

```
solve  0–383 ms      for  418–522 ms      x:  650–882 ms      3x  1057–1370 ms
```

Word grouping by whitespace works, and needs no repair pass. Note `x:` groups
with its punctuation — irrelevant for M5, where nothing renders individual
words, but ADR-0021 should say whether punctuation belongs to the word it
trails before anything does render them.

## What this changes in the plan

Nothing structural — which is the useful outcome, because it means slices 4 and
5 can be written as specified. Two amendments:

1. **ADR-0021 must name `alignment` and rule out `normalized_alignment`**, with
   the two-character difference as the reason.
2. `assertSpeakableNarration` is confirmed as author-time only, for the reason
   §8.1 gives: `toLessonVersionDTO` re-parses stored scripts and returns
   `script: null` on failure, so tightening `LessonStepSchema` would turn every
   already-stored lesson containing a backslash into a lesson with no script.

## Still not answered

**Nobody has listened to any of this audio.** Every conclusion above is drawn
from durations and alignment arrays. The inference about LaTeX is strong — a
sub-prose per-character rate has no other explanation — but "what does a child
actually hear" is a question a human answers with headphones, and it is still
open.
