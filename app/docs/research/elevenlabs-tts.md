# Research: ElevenLabs TTS and voice cloning

- **Date:** 2026-08-26
- **Researcher:** researcher agent
- **Question:** Can ElevenLabs power narrated whiteboard lessons in our Next.js 16 / Vercel AI tutor app — specifically streaming TTS, word-accurate timing data to sync canvas drawing, stock voice licensing, and consent-gated cloning of a parent's voice?
- **Verdict:** Yes, ElevenLabs is a good fit. It is the only major TTS vendor that ships both (a) timing data returned alongside the generated audio and (b) a documented instant-cloning API. Two catches: the timing data is **character-level, not word-level** (we must group characters into words ourselves), and their Prohibited Use Policy **flatly bans uploading voice data of anyone under 18** — so we can clone the parent, never the student. A third, time-boxed catch: the current stock "Default voices" are documented to **expire on 2026-12-31**, roughly four months out, so we must pin to the replacement voice set from day one.

## Summary

- Official SDK is **`@elevenlabs/elevenlabs-js`** (2.x). The unscoped `elevenlabs` package is deprecated. Exact latest patch could not be pinned — see Risks.
- **Timing data exists and is first-class**: `POST /v1/text-to-speech/{voice_id}/with-timestamps` and `.../stream/with-timestamps` return `alignment` + `normalized_alignment` with per-character start/end times in seconds. This is the feature that makes the whiteboard sync feasible.
- The alignment is **character-level**. Word boundaries are derived by us (split on the `characters` array at whitespace). ElevenLabs' separate **Forced Alignment** endpoint does return a `words` array, but it takes an existing audio file + transcript, i.e. a second round trip.
- **Streaming works**, both plain audio (`/stream`) and SSE-with-timestamps. Flash v2.5 is documented at **~75 ms model time-to-first-byte** (~50 ms in a newer post); add 50–200 ms network and a client player buffer (~500 ms typical). Realistic end-to-end first-audio: **roughly 300–800 ms**, dominated by network + player buffer, not the model.
- **Quality vs latency:** Eleven v3 = most expressive, 3,000 char/request cap, slowest, 1 credit/char. Flash v2.5 = ~75 ms, 40,000 char cap, 0.5 credits/char. Turbo v2.5 is functionally equivalent to Flash but slower — ElevenLabs says prefer Flash.
- **Stock voices:** list via `GET /v2/voices` filtered by `voice_type=default` / `category=premade`. Commercial use is included on **every paid plan**; the free plan forbids commercial use. Content generated on a paid plan keeps its license after downgrade.
- **Instant Voice Cloning:** `POST /v1/voices/add` (SDK `voices.ivc.create`), multipart, ~1–2 minutes of clean audio, do not exceed ~3 minutes. Requires a paid plan (Starter+). PVC is off the table for us — PVC can only ever be a clone of *your own* voice.
- **Consent is on us, contractually.** Their Prohibited Use Policy bans replicating a voice "without consent or legal right." Their voice-captcha verification is designed to prove *you are the speaker*, which does not match our parent-consent flow — so we must build and retain our own recorded-consent artifact.
- **Vercel:** fine. Node runtime, streaming supported, `maxDuration` up to 300 s default / 800 s max on Fluid compute. Two hard limits to design around: **4.5 MB function request/response payload** and **1 MB Server Action body** (default) — so parent voice-sample uploads must bypass both via direct-to-blob upload.

## Findings

### 1. Text-to-speech basics

**Package.** `@elevenlabs/elevenlabs-js` — the official JavaScript/Node library ([npm](https://www.npmjs.com/package/@elevenlabs/elevenlabs-js), [GitHub](https://github.com/elevenlabs/elevenlabs-js)). The older unscoped `elevenlabs` package is deprecated; ElevenLabs publishes a migration note saying to uninstall `elevenlabs`, install `@elevenlabs/elevenlabs-js`, and change the import path. `@elevenlabs/client` (browser) and `@elevenlabs/react` (React) are separate packages for the Agents/conversational product — **we do not need those** for narration TTS, and we should not pull them in just to play audio.

Version: search results disagreed. One source reported `2.61.0` as current; the GitHub releases listing surfaced `2.40.0` (2026-03-23) as latest. Both are 2.x with the same API surface. **Confirm before installing** with `pnpm view @elevenlabs/elevenlabs-js version`. Nothing here is installed in this repo yet — `package.json` has no ElevenLabs dependency, so every claim in this document is from documentation, not from reading installed source.

**Server-side synthesis.** Shape of the SDK (from the SDK reference; not executed):

```ts
// server-only module
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY, // defaults to this env var
});

// returns ReadableStream<Uint8Array>
const audio = await client.textToSpeech.convert(voiceId, {
  text: "Let's solve this step by step.",
  modelId: "eleven_flash_v2_5",
  outputFormat: "mp3_44100_128",
});
```

Documented SDK methods relevant to us:

| Method | HTTP | Returns |
| --- | --- | --- |
| `textToSpeech.convert(voiceId, req)` | `POST /v1/text-to-speech/{id}` | `ReadableStream<Uint8Array>` |
| `textToSpeech.stream(voiceId, req)` | `POST /v1/text-to-speech/{id}/stream` | `ReadableStream<Uint8Array>` |
| `textToSpeech.convertWithTimestamps(voiceId, req)` | `POST /v1/text-to-speech/{id}/with-timestamps` | JSON object (base64 audio + alignment) |
| `textToSpeech.streamWithTimestamps(voiceId, req)` | `POST /v1/text-to-speech/{id}/stream/with-timestamps` | async-iterable SSE stream of chunks |

**Models.**

| Model ID | Positioning | Latency | Max chars/request | Credits/char |
| --- | --- | --- | --- | --- |
| `eleven_v3` | Most expressive, 70+ languages, best emotional range | Highest — "no way to get v3 quality at Flash speeds" | 3,000 | 1 |
| `eleven_multilingual_v2` | Long-form/audiobook quality workhorse | Mid | 10,000 | 1 |
| `eleven_turbo_v2_5` | Balanced | ~300 ms | 40,000 | 0.5–1 |
| `eleven_flash_v2_5` | Realtime, 32 languages | ~75 ms model TTFB | 40,000 | 0.5 |

ElevenLabs explicitly recommends Flash over Turbo in all cases (functionally equivalent, Flash is lower latency). There is also an "Eleven v3 Conversational" variant positioned as expressive-but-realtime.

For a tutor app the interesting trade is: **v3 for pre-generated lesson narration** (quality matters, we can cache it, the 3,000-char cap forces us to chunk per lesson step anyway) and **Flash v2.5 for anything interactive/live** (chat replies).

**Output formats.** `output_format` accepts: `mp3_22050_32`, `mp3_24000_48`, `mp3_44100_32/64/96/128/192`, `opus_48000_32/64/96/128/192`, `pcm_8000/16000/22050/24000/32000/44100/48000`, `wav_8000/16000/22050/24000/32000/44100/48000`, `ulaw_8000`, `alaw_8000`. Default `mp3_44100_128`.

Tier gating on formats matters: `mp3_44100_192`, `pcm_44100`, and `wav_44100` require Creator/Pro or above. `mp3_44100_128` works on Free/Starter. **For browser playback of narration, `mp3_44100_128` is the right default** — universally decodable by `<audio>`/Web Audio, and available on the cheapest paid tier.

### 2. Streaming

Yes. Three delivery modes documented: a regular endpoint returning one complete file, a streaming endpoint returning chunks progressively via SSE, and a WebSocket endpoint for bidirectional streaming (send text incrementally, generation starts before input is complete).

ElevenLabs' own framing: *"the total generation time is similar; what changes is when data starts arriving."*

**Realistic time-to-first-byte.** Budget it as a sum, because the model is not the bottleneck:

- Model TTFB: **~75 ms** for Flash v2.5 (their docs); one newer post claims **50 ms** on upgraded GPUs. v3 is materially slower and no figure is published.
- Network round trip: **50–200 ms** depending on distance. They serve from USA, Netherlands, Singapore.
- Client player buffer: **~500 ms is the common default**; their docs note trimming it trades stutter risk for perceived latency.

So a defensible planning number for *first audible sound* is **~300–800 ms** with Flash v2.5, and we control the largest single term (the player buffer). For v3 assume worse and unknown; measure it.

**Implication for the whiteboard.** Do not architect the sync around live streaming. The narration for a lesson step is known ahead of time — generate it, get the alignment, cache both, and drive the canvas off `audio.currentTime` against stored timings. Streaming is for the *first* play of a freshly generated lesson, or for interactive chat. Chasing sync against a live stream buys nothing and makes drift debugging miserable.

### 3. Word/character-level timing data — CRITICAL

**This exists.** ElevenLabs shipped dedicated timestamp endpoints specifically so you can get "timestamps on when each character was spoken without using websockets, both in a streaming and non-streaming way."

**Non-streaming: `POST /v1/text-to-speech/{voice_id}/with-timestamps`**

Documented response shape:

```jsonc
{
  "audio_base64": "<base64 audio>",
  "alignment": {
    "characters": ["L", "e", "t", "'", "s", " ", "s", "o", "l", "v", "e"],
    "character_start_times_seconds": [0.0, 0.058, 0.093, 0.116, 0.139, 0.174, 0.209, 0.244, 0.267, 0.302, 0.325],
    "character_end_times_seconds":   [0.058, 0.093, 0.116, 0.139, 0.174, 0.209, 0.244, 0.267, 0.302, 0.325, 0.371]
  },
  "normalized_alignment": {
    "characters": [ /* ... */ ],
    "character_start_times_seconds": [ /* ... */ ],
    "character_end_times_seconds": [ /* ... */ ]
  }
}
```

(Numeric values above are illustrative of the shape, not copied from a real response.)

Three parallel arrays of equal length. `alignment` maps to the **original** input text as we sent it; `normalized_alignment` maps to the **normalized** text after ElevenLabs expands things like numbers and abbreviations. For our use case — "start drawing the triangle when the narrator says 'triangle'" — **`alignment` is the one to use**, because its indices line up with the string we authored and can annotate.

**Streaming: `POST /v1/text-to-speech/{voice_id}/stream/with-timestamps`** returns an SSE stream, newline-delimited JSON chunks, each containing base64 audio plus the alignment covering that chunk. SDK: `textToSpeech.streamWithTimestamps()` → async-iterable of `StreamingAudioChunkWithTimestampsResponse`.

**The gap: there is no `words` array here.** Marketing copy for Eleven v3 says "word-level timestamps available for subtitling, lip-sync, and alignment workflows," but every API-reference description of these endpoints says *character-level*. Deriving words from characters is trivial and deterministic — walk `characters`, split on whitespace, take the first char's start and last char's end — so this is a small implementation detail, not a blocker. But do not plan on the API handing us words.

**Suggested integration pattern for the whiteboard:** author lesson narration with inline markers, e.g. `"Now we draw the [[step:2]]hypotenuse."`, strip markers before sending to TTS while recording each marker's character offset in the clean string, then read `character_start_times_seconds[offset]` to get the cue time. This survives caching, works offline against stored JSON, and needs no runtime coupling to ElevenLabs.

**Fallback / cross-check: Forced Alignment.** `POST /v1/forced-alignment` takes an audio file (multipart, <1 GB, most formats) plus the text, and returns **both** a character list and a **`words` list** with timings, plus an alignment `loss`/confidence score per word and for the whole transcript. Two uses for us: (a) if character-derived word boundaries prove unreliable, and (b) to align narration audio we did *not* generate with ElevenLabs. It costs an extra call and extra latency, so it is a fallback, not the primary path.

### 4. Preset voices

**Listing.** `GET /v2/voices` (SDK: `voices.search()`). Filters documented:

- `voice_type`: `personal` | `community` | `default` | `workspace` | `non-default` | `non-community` | `saved`
- `category`: `premade` | `cloned` | `generated` | `professional`

The community **Voice Library** holds 10,000+ shared voices and is **not available via API to free-tier users**.

**Licensing.** Paid plans (Starter, Creator, Pro, Scale, Business, Enterprise) all include a full commercial license covering generated output — videos, courses, apps, audiobooks. Free plan users **may not** use output commercially, including for advertising. Voice Library voices are documented as carrying a free commercial use license. You may sell the *output*, not resell the ElevenLabs service itself. Content created while on a paid plan retains its license even if you later downgrade.

**Time bomb — read this.** ElevenLabs documents that **all Default voices expire on 2026-12-31** and will be inaccessible after that date. They are being replaced by a new voice set described as usable "forever," with published suggested replacements (tone and style differ). Default voices are additionally only available to accounts created **before March 2026** — so if we open a fresh ElevenLabs account now (August 2026), **we likely cannot access the legacy Default voices at all**, and should build against the new voice set exclusively.

Practical consequence: store a `voiceId` per tutor persona in our own DB with a human-readable label, never hardcode a voice ID in application code, and treat "voice went away" as a handled error path. Given the expiry, do **not** let a student's chosen voice be an un-remappable foreign key to an ElevenLabs ID.

### 5. Voice cloning with consent

**Instant Voice Cloning (IVC)** is the right product for us. Professional Voice Cloning (PVC) is explicitly unusable for our scenario: ElevenLabs states you can *only* create a PVC of **your own** voice, and that even *with* the other person's consent you may not PVC someone else's voice. PVC also needs 30 min – 3 h of audio, a Creator+ plan, and a verification step.

**IVC requirements:**

- **Audio quantity:** ~1–2 minutes of clear audio recommended; docs say cloning works with under 2 minutes, quality guidance says 1–5 minutes; **do not exceed ~3 minutes** — more yields little improvement and can degrade the clone.
- **Audio quality beats quantity:** no reverb, no artifacts, no background noise. How it was recorded matters more than total runtime.
- **Plan:** paid plan required (Free and Starter have 0 PVC slots; IVC is available on paid plans — exact IVC slot counts per tier not verified, see Risks).

**API call:** `POST /v1/voices/add` (SDK: `client.voices.ivc.create(...)`), `multipart/form-data`:

| Field | Notes |
| --- | --- |
| `name` | Voice name |
| `files` | Audio sample file(s) |
| `description` | Optional |
| `labels` | Optional JSON; keys such as `language`, `accent`, `gender`, `age` |
| `remove_background_noise` | Optional bool; runs their audio-isolation model. Docs warn: if samples have no background noise, this can make quality *worse*. |

Response includes a `voice_id` to use in TTS calls, and a `requires_verification` boolean. The voice object from `GET /v1/voices/{id}` carries a `voice_verification` sub-object.

**What ElevenLabs' terms require regarding consent.** Their **Prohibited Use Policy** forbids creating or using output to intentionally replicate another person's voice:

> (a) without consent or legal right, including to take unauthorized action on behalf of such individual; (b) in a way that harasses or causes harm to that person, including via unauthorized sexualization; (c) in a manner intended to deceive others about whether the voice was generated by artificial intelligence.

So consent is a **contractual obligation placed on us**, enforced after the fact, not a field in the API. There is no `consent_evidence` parameter to attach. **We must build the consent record ourselves and retain it** — the parent's recorded consent statement, timestamp, the identity of the requesting account, and a link to the resulting `voice_id`. Treat that as the audit artifact if ElevenLabs or a parent ever challenges a clone.

Also note clause (c): a tutor speaking in a parent's voice must be **disclosed as AI-generated to the student and the parent**. That is not optional under their policy, and it is the right product decision anyway.

**Verification step they enforce.** ElevenLabs uses **voice-captcha**: the user is shown a text prompt and must read it aloud into the interface within ~10 seconds, to confirm the person supplying the samples is the person speaking. Documented API surface for this is PVC-specific (`.../pvc/verification/captcha/verify`, plus a manual-verification request endpoint). Their concepts doc says *both* IVC and PVC "include a voice verification step," framed as an ethical/legal safeguard rather than a technical gate, and admits its limit: verification "cannot guarantee that the provided recording truly belongs to the requester, only that the requester was present and actively participating."

**Whether API-created IVC voices are blocked pending verification is the single biggest unknown in this document** and it sits directly on our critical path. See Risks.

**Hard blocker on cloning students.** ElevenLabs' policy states users are **strictly prohibited from uploading, transmitting, or otherwise making available voice data from children under 18**, and children's/child-sounding voices cannot be added to the Voice Library. Their services are stated to be intended for users **18 or over**, and they prohibit making services available to anyone under 13, or to 13–18 year olds without parental/guardian consent.

For our app: cloning the **parent** (an adult, with recorded consent) is consistent with these terms. Cloning the **student** is not, and we must prevent it at the product level — the upload UI should never offer "record your own voice" as a cloning source. Given the app already carries COPPA/FERPA obligations for minors, add: the parent's voice sample is biometric-adjacent personal data about an adult, needs its own retention policy and deletion path, and deleting a family's account must also `DELETE` the ElevenLabs voice.

We already intend to refuse public figures, which matches their separate **No-Go Voices** policy.

### 6. Pricing and limits

**Metering is by character of input text**, converted to credits — not by seconds of audio.

- `eleven_v3`: 1 credit/char
- `eleven_multilingual_v2`: 1 credit/char
- `eleven_flash_v2_5` / `eleven_flash_v2`: 0.5 credits/char (1 credit per 2 chars)
- `eleven_turbo_v2_5`: 0.5–1 credit/char depending on API vs web

**Plans** (monthly, from their pricing page):

| Plan | Price/mo | Credits/mo | TTS concurrency |
| --- | --- | --- | --- |
| Free | $0 | 10,000 | 2 |
| Starter | $6 | 30,000 | 3 |
| Creator | $22 ($11 first month) | 121,000 | 5 |
| Pro | $99 | 600,000 | 10 |
| Scale | $299 (3 seats) | 1,800,000 | 15 |
| Business | $990 (10 seats) | 6,000,000 | 15 |
| Enterprise | custom | custom | custom |

Annual billing = pay 10 months for 12. Unused credits roll over up to 2× monthly quota (balance caps at 3× monthly) while the paid subscription stays active and is not downgraded or cancelled.

**API pricing was cut in May 2026** (announced 2026-05-07): TTS down up to 55%, and **Pay-As-You-Go** was introduced across ElevenAPI and ElevenAgents. Quoted new TTS rate: **$0.05 per 1,000 tokens** for the Flash model on the Creator plan (was $0.11). Note they say "tokens," not "characters," in that announcement — the relationship between the two was not established from any source I found, and separate docs consistently say TTS is metered per character. **Do not build a cost model on that $0.05 figure without confirming the unit.**

**Rate limits.** The published per-plan number is **concurrent requests**, per the table above. ElevenLabs is explicit that requests-per-minute is *not* the same thing as concurrency, since it depends on request duration and batching; they publish no RPM figure. Over-limit returns **HTTP 429**. Higher concurrency is available by talking to their enterprise team.

**Concurrency is the real constraint for us**, not credits. Pre-generating a whole multi-step lesson means N parallel TTS calls; on Creator (5 concurrent) a 12-step lesson serializes into 3 waves. Design lesson generation as a queued/pooled job with bounded concurrency and 429 backoff, not a `Promise.all` over lesson steps. That bound belongs in one place in our code, configured per environment.

**Rough sizing:** a 500-word lesson ≈ 3,000 characters ≈ 3,000 credits on v3, 1,500 on Flash. Creator's 121,000 credits ≈ 40 v3 lessons/month. That is small. **Caching generated narration + alignment JSON in blob storage, keyed by a hash of (text, voiceId, modelId), is the highest-leverage cost decision in this integration** — lessons get replayed, and a replay should never cost a credit.

### 7. Vercel compatibility

Verified locally against the installed Next.js **16.3.1** docs in `node_modules/next/dist/docs/`; Vercel platform limits are from Vercel's docs (online).

**Runtime.** Use the Node runtime (default in Next 16; note `runtime: 'edge'` is now marked **deprecated** in the installed route-segment-config docs at `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/index.md:11`). The ElevenLabs Node SDK should run in a Node serverless function.

**Streaming: supported.** Vercel supports streaming from Node.js serverless functions, and Next.js Route Handlers expose Web-standard `Request`/`Response` and can return a `ReadableStream` directly. Since `textToSpeech.stream()` already returns a `ReadableStream<Uint8Array>`, a route handler can pass it through more or less untouched.

**Function duration.** With Fluid compute (now the default): Hobby default and max **300 s**; Pro/Enterprise default 300 s, max **800 s** (an 1800 s extended max is in beta and needs per-function config). Without Fluid: Hobby 10–60 s, Pro 15–300 s. Set per route with `export const maxDuration = <seconds>` — note `maxDuration` for Server Actions is set at the **page** level, not on the action. Vercel counts streaming time toward `maxDuration`. Not a practical problem for narration-sized requests.

**Payload limits — this is where we will actually get bitten.**

- **Vercel function request/response body: 4.5 MB hard cap.** Exceeding it returns `413 FUNCTION_PAYLOAD_TOO_LARGE`. A 1–3 minute voice sample as WAV blows straight through this.
- **Next.js Server Action body: 1 MB by default.** Confirmed in the installed docs (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md:29`). Raise it via `experimental.serverActions.bodySizeLimit` — still under `experimental` in 16.3.1. The installed docs also warn the limit covers raw body including multipart boundary/header overhead, budgeting an extra 10–20 KB.
- Community reports say raising `bodySizeLimit` sometimes fails to take effect in production, and that casing matters (`'10MB'` vs `'10mb'`). Unverified, but a reason not to depend on it.

**Recommended shape:** the parent's voice sample should **never** pass through a Server Action or a Vercel function body. Upload the audio directly from the browser to blob storage via a signed URL, then send only the resulting URL to the server, which fetches it and forwards it to `POST /v1/voices/add`. This sidesteps both the 1 MB and 4.5 MB ceilings and keeps the function short-lived.

Same reasoning on the output side: generated MP3 narration for a full lesson can exceed 4.5 MB. Persist audio to blob storage and return a URL; only stream through the function for genuinely live, first-play cases.

**Secrets.** `ELEVENLABS_API_KEY` is server-only, `.env`, never `NEXT_PUBLIC_`. The SDK reads it from `process.env.ELEVENLABS_API_KEY` by default. Client code must talk to our route handlers, never to ElevenLabs directly.

### 8. Alternatives worth knowing

Scored only on our two decisive criteria.

**Cartesia (Sonic)**

- *Word-level timing:* **Better than ElevenLabs on this axis.** `add_timestamps` (default `false`) on the SSE and WebSocket TTS endpoints returns `timestamps` messages containing **`word_timestamps`** — words plus start and end times, already grouped into words. Caveat: for the `sonic` model, timestamps are documented as supported only for **en, de, es, fr** (`sonic-preview` covers all languages). Language coverage is a real constraint if we ever tutor in other languages.
- *Consent-gated cloning:* Instant voice cloning from as little as **10 seconds** of audio, included on all paid tiers from entry-level Pro. Their Acceptable Use Policy requires users submit only their own voice or others' **with explicit consent**, with responsibility on the user. Structurally identical posture to ElevenLabs: policy-level obligation, no consent field in the API. The 10-second threshold is a *lower* barrier to misuse, which for an app serving minors is a liability consideration, not a feature.

**OpenAI TTS (`gpt-4o-mini-tts`)**

- *Word-level timing:* **No evidence it exists.** Nothing in the documentation surfaced indicates the TTS models return word or character timestamps. For our whiteboard sync this is close to disqualifying — we would have to generate audio, then run a separate forced-alignment or Whisper pass to recover timings, adding a round trip, cost, and a new failure mode.
- *Consent-gated cloning:* **Not offered.** The models are limited to preset, artificial voices (11–13 built-ins: alloy, echo, fable, onyx, nova, shimmer, etc.), and OpenAI monitors output to ensure it matches the synthetic presets. You can steer *how* a preset voice speaks via instructions, but you cannot upload a parent's voice at all. This rules OpenAI TTS out for our core differentiating feature.

**Bottom line:** ElevenLabs is the recommendation. Cartesia is the credible backup and is genuinely better at word timing; it would be worth a bake-off if character-to-word grouping turns out to be flaky, or if ElevenLabs' IVC verification blocks our parent-consent flow. OpenAI TTS is not a candidate for this app.

## Risks and unknowns

**Could not verify — needs confirming before we commit code:**

1. **Exact SDK version.** Sources conflicted: `2.61.0` vs `2.40.0` (2026-03-23). Run `pnpm view @elevenlabs/elevenlabs-js version` before adding it. Nothing was installed or read from source for this report — every SDK claim is from documentation, not verified against types.
2. **Whether `with-timestamps` supports every model.** ElevenLabs marketing associates word-level timestamps with `eleven_v3`, and the dialogue-with-timestamps endpoint defaults to `eleven_v3`. I could **not** confirm that `eleven_flash_v2_5` works with `/with-timestamps`. If it does not, the "Flash for interactive, v3 for lessons" split still works, but any low-latency path needing sync would be forced onto v3. **Test this first — it is a one-request experiment and it constrains the architecture.**
3. **Whether an IVC voice created via API is immediately usable, or blocked pending voice-captcha.** Their concepts doc says both IVC and PVC "include a voice verification step"; the documented captcha endpoints are PVC-scoped; the IVC response carries `requires_verification`. If API-created IVC voices require a human to complete a captcha in the ElevenLabs dashboard, our parent-consent flow does not work as designed and would need rethinking. **This is the highest-risk unknown in this document.** Resolve it with a real API call on a paid account before any product commitment.
4. **The "$0.05 per 1,000 tokens" figure** from the May 2026 price-cut announcement uses "tokens" while all other pricing docs say "characters." The conversion is unknown. Do not build a cost model on it.
5. **PAYG rates and terms** — the Pay-As-You-Go per-credit price was not obtainable from search results.
6. **IVC slots per plan.** PVC slots are documented (Free/Starter 0; Creator/Pro/Scale 1). Whether IVC voices are capped per tier, and at what number, I could not confirm. **This matters a lot for us** — if we clone one parent voice per family, a low per-account IVC cap becomes a hard ceiling on user count and could force an Enterprise conversation early.
7. **Exact TTFB for the with-timestamps endpoints.** No published figure. The ~75 ms Flash number is for plain synthesis; the timestamped variants may differ.
8. **Whether Default-voice expiry affects an account created now.** Docs say Default voices are only available to accounts created before March 2026 *and* that all Default voices expire 2026-12-31. A new account in August 2026 probably sees only the new voice set. Verify by calling `GET /v2/voices?voice_type=default` on a real account.
9. **Terms of Service exact wording.** The consent quote above is from the **Prohibited Use Policy**, which I am confident of. I could **not** retrieve the specific Terms of Service section text that third-party blogs cite as "Section 5." Have someone read `elevenlabs.io/terms-of-use` (and `terms-of-use-eu` if we serve the EEA) directly before launch. Third-party summaries of legal terms are not a source we should rely on for a compliance decision.

**Risks that could bite us even if everything above checks out:**

- **Default voice expiry on 2026-12-31 is ~4 months away.** If we ship against voices that vanish, every student's chosen tutor voice breaks at once, during a school year. Build against the new voice set, store voice IDs in our DB with a remapping path.
- **Concurrency, not credits, is the scaling wall.** 5 concurrent on Creator, 10 on Pro. Bulk lesson pre-generation must be a bounded queue with 429 backoff.
- **Character-level → word-level grouping is ours to own**, including edge cases: normalized vs original alignment divergence when text contains numbers, abbreviations, currency, or math symbols. A tutor app is *full* of "3x + 5 = 20". Whichever array we choose, **test alignment specifically on mathematical text** — this is the most likely place the sync silently drifts.
- **Consent enforcement is retroactive.** ElevenLabs can suspend the account for a policy violation. One misuse — a student cloning a teacher, a celebrity, or a classmate — puts the whole platform's TTS at risk. Gate cloning behind verified parent identity, keep the consent recording, log who requested what, and make abuse reporting easy.
- **Under-18 voice ban is absolute** and interacts with our COPPA/FERPA posture. Any feature that records a student's voice must be explicitly walled off from the cloning code path. Consider making it structurally impossible rather than policy-enforced.
- **Vendor lock-in on alignment format.** If we cache alignment JSON in ElevenLabs' exact shape, switching to Cartesia later means a migration. Store our own normalized `{ stepId, startSeconds, endSeconds }` cue format, derived at generation time, and treat the raw provider payload as disposable.

## Sources

- https://www.npmjs.com/package/@elevenlabs/elevenlabs-js — official Node SDK package listing; install and basic client usage.
- https://github.com/elevenlabs/elevenlabs-js — official SDK repo and releases; version history (conflicting version reports).
- https://github.com/elevenlabs/packages/blob/main/.agents/skills/elevenlabs:sdk-migration/SKILL.md — official migration note from deprecated `elevenlabs` to `@elevenlabs/elevenlabs-js`.
- https://elevenlabs.io/docs/api-reference/text-to-speech/convert — base TTS endpoint, parameters, output formats.
- https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps — non-streaming timestamps endpoint; `alignment` / `normalized_alignment` response shape.
- https://elevenlabs.io/docs/api-reference/text-to-speech/stream-with-timestamps — SSE streaming timestamps endpoint.
- https://elevenlabs.io/blog/new-text-to-speech-endpoints-with-timestamps — announcement explaining both timestamp endpoints and their purpose.
- https://elevenlabs.io/docs/overview/capabilities/forced-alignment — forced alignment capability overview.
- https://elevenlabs.io/docs/api-reference/forced-alignment/create — forced alignment endpoint; returns both characters and a `words` list with confidence loss.
- https://elevenlabs.io/docs/overview/models — model list, latency, language coverage, character caps.
- https://elevenlabs.io/docs/eleven-api/concepts/latency — latency breakdown: model TTFB, network, player buffer.
- https://elevenlabs.io/docs/eleven-api/guides/how-to/best-practices/latency-optimization — latency optimization guidance, ~50ms Flash figure, buffer trimming.
- https://elevenlabs.io/docs/eleven-api/concepts/audio-streaming — streaming vs regular vs WebSocket endpoint comparison.
- https://elevenlabs.io/docs/help-center/troubleshooting/what-audio-formats-do-you-support — full `output_format` list and per-tier gating.
- https://elevenlabs.io/docs/api-reference/voices/search — `GET /v2/voices`, `voice_type` and `category` filters.
- https://elevenlabs.io/docs/help-center/product/voice-customization/my-voices/what-are-default-voices — Default voices expire 2026-12-31; only for accounts created before March 2026.
- https://elevenlabs.io/docs/eleven-creative/voices/voice-cloning/instant-voice-cloning — IVC audio quantity and quality guidance.
- https://elevenlabs.io/docs/api-reference/voices/ivc/create — `POST /v1/voices/add` parameters.
- https://elevenlabs.io/docs/eleven-api/concepts/voice-cloning — IVC vs PVC, voice-captcha verification and its stated limits.
- https://elevenlabs.io/docs/help-center/product/voice-customization/voice-cloning/can-i-create-a-professional-voice-clone-of-someone-elses-voice — PVC restricted to your own voice even with consent.
- https://elevenlabs.io/docs/api-reference/voices/pvc/verification/captcha/verify — PVC captcha verification endpoint.
- https://elevenlabs.io/use-policy — Prohibited Use Policy: voice replication without consent; under-18 voice data ban; age gating.
- https://elevenlabs.io/terms-of-use — Terms of Service (non-EEA); commercial rights and age eligibility. Not read in full — see Risks.
- https://elevenlabs.io/pricing — plan tiers, prices, monthly credits, rollover.
- https://elevenlabs.io/blog/weve-lowered-api-agents-pricing-and-introduced-pay-as-you-go — May 2026 price cut and PAYG introduction; "$0.05 per 1,000 tokens" figure.
- https://help.elevenlabs.io/hc/en-us/articles/14312733311761-How-many-Text-to-Speech-requests-can-I-make-and-can-I-increase-it — per-plan TTS concurrency limits.
- https://help.elevenlabs.io/hc/en-us/articles/19571824571921-API-Error-Code-429 — 429 behaviour on exceeding concurrency.
- https://help.elevenlabs.io/hc/en-us/articles/13298164480913-What-s-the-maximum-amount-of-characters-and-text-I-can-generate — per-model max characters per request.
- https://vercel.com/docs/functions/limitations — 4.5 MB request/response payload cap, `413 FUNCTION_PAYLOAD_TOO_LARGE`.
- https://vercel.com/docs/functions/configuring-functions/duration — `maxDuration` defaults and maxima with and without Fluid compute.
- https://vercel.com/blog/streaming-for-serverless-node-js-and-edge-runtimes-with-vercel-functions — streaming support from Node serverless functions.
- `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md` — VERIFIED locally, Next 16.3.1: 1 MB default Server Action body limit, `experimental.serverActions.bodySizeLimit`, multipart overhead note.
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/` — VERIFIED locally, Next 16.3.1: `maxDuration` route segment config; `runtime: 'edge'` marked deprecated.
- https://docs.cartesia.ai/api-reference/tts/sse — Cartesia `add_timestamps` on SSE/WebSocket; `word_timestamps` message shape; per-language support.
- https://www.cartesia.ai/product/voice-cloning — Cartesia instant cloning from 10 seconds; plan availability.
- https://cartesia.ai/legal/acceptable-use.html — Cartesia consent requirement for cloning others' voices.
- https://platform.openai.com/docs/guides/text-to-speech — OpenAI TTS guide; preset voices only.
- https://openai.com/index/introducing-our-next-generation-audio-models/ — `gpt-4o-mini-tts` announcement; steerability, no cloning, no timestamps mentioned.
