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
