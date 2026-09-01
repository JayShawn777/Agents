# M5 implementation plan — narration and tutor personas

- **Date:** 2026-09-01
- **Spec:** [m5-narration-and-personas.md](../specs/m5-narration-and-personas.md) (22 AC)
- **ADRs:** [0020](../adr/0020-elevenlabs-behind-a-persona-indirection-called-with-fetch.md) (the vendor and the persona indirection), [0015](../adr/0015-per-profile-narration-cache-instead-of-a-global-content-address.md) (the cache key and where audio lives — **revised 2026-09-01, becomes live this milestone**), [0021](../adr/0021-narration-cues-are-our-own-word-timeline-derived-from-character-alignment.md) (our own cue format)
- **Measurement:** [m5-narration-measurement.md](../research/m5-narration-measurement.md) — taken 2026-09-01 against the real account. It supersedes [elevenlabs-tts.md](../research/elevenlabs-tts.md) wherever the two disagree.

This is the contract the spec's second open question said could not be written
until the experiment returned. It has. Where a number is still a guess, this
document says so rather than glossing it, and §8 names what must be measured
before each risky slice.

**Status: DESIGN ONLY. Nothing below is built.** Every "will" in this document
is intent, not a description of code (retro lesson 23).

---

## 0. What the measurement settled, and what it did not

Four things are now fact and the design is built on them.

1. **Alignment is character-level.** 59 characters in, 59 start times and 59
   end times out, and **no `words` array**. Grouping characters into words is
   ours, which is the whole reason ADR-0021 exists.
2. **`with-timestamps` works on both models** — `eleven_flash_v2_5` at 262 ms
   and `eleven_multilingual_v2` at 976 ms. M5 pre-generates, so we take the
   quality model; the measurement's own conclusion is that this **does not
   foreclose** a future low-latency synced surface, so nothing here hedges
   against one. The model id is recorded on every cached row, so switching
   later is a data question.
3. **The account has 21 current `premade` voices**, so the 2026-12-31 expiry of
   the legacy set does not bite us today. It is still the reason AC 1 exists.
4. **The key is scoped** to `voices_read` + `text_to_speech`. `GET
   /v1/user/subscription` returns 401, so **we cannot read the account's plan
   tier or its concurrency ceiling.** That is why §2's concurrency constant is
   set at the floor rather than at the plan's real limit.

Three things the measurement explicitly did **not** answer, all carried into §8:

- **How mathematics is read aloud.** The test sentence was prose. This is the
  highest-risk unknown in the milestone and §8.1 is the experiment for it.
- **What the sync tolerance should be.** Still the spec's 150 ms assumption,
  still unmeasured, still configuration.
- **What a nine-year-old thinks of any of it.** Not an API call.

### Two decisions this plan makes that the measurement did not force

- **We add no new dependency.** The measurement ran on `fetch`; production will
  too. ADR-0020 argues it; the owner still has to say yes or no (§10.1).
- **Narration is per lesson STEP, and each step is its own audio file.** This
  is the spec's assumption, and it is load-bearing in a way the spec does not
  say: because each step's drawing starts when *its own* file starts, AC 15's
  "no cumulative drift, the last step as strictly as the first" is true by
  construction rather than by arithmetic. What it costs is a seam between
  files, which §8.2 measures.

---

## 1. The migration — one, additive, plus seed rows

Four new models, two new columns on `StudentProfile`, no change to any M4
table. **No backfill, nothing destructive.**

```prisma
/// AC 1. App reference data — no student data, ever. The provider's voice id
/// lives HERE and nowhere else: the stock voice set carries a published expiry
/// (2026-12-31 for the legacy set), so an id compiled into application code is
/// an outage with a calendar entry. AC 3 repoints this column; it never
/// repoints a constant.
model Persona {
  id              String  @id @default(cuid())
  /// OURS, stable across a voice remap. Config refers to a persona by slug.
  slug            String  @unique
  label           String
  description     String
  /// Preset artwork id from `PERSONA_ARTWORK_IDS` (AC 2). Never an upload.
  artworkId       String
  /// The vendor's voice id. Seed data. See `tests/unit/lib/narration/no-voice-id-literals.test.ts`.
  providerVoiceId String
  ttsProvider     String  @default("elevenlabs")
  sortOrder       Int
  /// Personas are RETIRED, never deleted — a hard delete would orphan the
  /// attribution on a child's cached audio. Nothing enforces this at the
  /// database level; the two relations below are `SetNull` so that a delete
  /// that happens anyway destroys no audio.
  retiredAt       DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  profiles        StudentProfile[]
  narrationAssets NarrationAsset[]

  @@index([retiredAt, sortOrder])
}

enum NarrationStatus {
  PENDING     // row exists, no TTS call yet. Also the AC 21 budget grant.
  GENERATING  // calls are in flight
  READY       // AC 6 — every step has an asset and a cue timeline
  FAILED      // AC 17 — the lesson still plays, silently, with captions
}

/// One narration run for one LessonScriptVersion. Narration belongs to a
/// SCRIPT VERSION, not to a lesson: M4 AC 19 makes a new version on every
/// regeneration, and narrating version 2 must not silently repoint version 1's
/// audio.
model LessonNarration {
  id               String @id @default(cuid())
  lessonId         String
  versionId        String
  studentProfileId String
  /// Null only if the persona row was deleted (which is not supposed to happen).
  personaId        String?

  status           NarrationStatus @default(PENDING)
  /// Recorded, never inferred — the measurement's own recommendation.
  ttsModelId       String
  providerVoiceId  String
  cueFormatVersion String

  failureCode      String?
  stepCount        Int?
  totalDurationMs  Int?
  /// What this run actually sent to the vendor. Feeds the AC 21 budget.
  charactersBilled Int?
  /// How many steps were served from cache — the number that says whether
  /// AC 7 is doing anything. Nothing renders it.
  cacheHits        Int?

  startedAt        DateTime?
  completedAt      DateTime?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  lesson  Lesson                @relation(fields: [lessonId], references: [id], onDelete: Cascade)
  persona Persona?              @relation(fields: [personaId], references: [id], onDelete: SetNull)
  steps   LessonNarrationStep[]

  /// One live narration per version. A retry (AC 17) and a persona change both
  /// UPDATE this row rather than inserting a second one; the assets they no
  /// longer point at stay in the cache and cost nothing.
  @@unique([versionId])
  /// The stale-GENERATING reaper, the same query shape `reapIfStale` uses.
  @@index([status, updatedAt])
  /// The AC 21 daily budget query.
  @@index([studentProfileId, createdAt])
}

/// The join that makes AC 13's timeline. A step id and an offset — nothing
/// about the provider, and nothing that needs the raw payload at playback.
model LessonNarrationStep {
  id            String @id @default(cuid())
  narrationId   String
  /// The LessonScript step id (ADR-0014 §2 — stable across regenerations).
  stepId        String
  stepIndex     Int
  assetId       String
  /// Running sum of the durations of steps 0..k-1. AC 13's "start offset".
  startOffsetMs Int
  createdAt     DateTime @default(now())

  narration LessonNarration @relation(fields: [narrationId], references: [id], onDelete: Cascade)
  asset     NarrationAsset  @relation(fields: [assetId],     references: [id], onDelete: Cascade)

  @@unique([narrationId, stepIndex])
  @@index([assetId])
}

/// ADR-0015. The cache. Per student profile, never global.
model NarrationAsset {
  id               String  @id @default(cuid())
  studentProfileId String
  personaId        String?

  /// sha256(narrationText \0 providerVoiceId \0 ttsModelId) — AC 7 / AC 8.
  cacheKey         String
  /// Denormalised and never updated: M6 AC 19 deletes by voice id, and an
  /// asset WAS generated with the id it carries even after AC 3 repoints the
  /// persona.
  providerVoiceId  String
  ttsModelId       String

  /// `students/<profileId>/narration/<cacheKey>.mp3` — ADR-0015.
  pathname         String  @unique
  contentType      String
  sizeBytes        Int
  durationMs       Int
  characterCount   Int

  /// ADR-0021. OUR normalised word cues, offsets relative to THIS file's
  /// start. The provider payload is not stored and is not needed at playback.
  cues             Json
  cueFormatVersion String

  createdAt        DateTime @default(now())

  studentProfile StudentProfile        @relation(fields: [studentProfileId], references: [id], onDelete: Cascade)
  persona        Persona?              @relation(fields: [personaId],        references: [id], onDelete: SetNull)
  steps          LessonNarrationStep[]

  @@unique([studentProfileId, cacheKey])
  @@index([providerVoiceId])
}
```

On `StudentProfile`:

```prisma
  /// AC 4. Null means "the default persona" (`DEFAULT_PERSONA_SLUG`) rather
  /// than "no voice" — a child who never opens the picker still gets narration.
  personaId       String?
  /// AC 18 + the owner's 2026-09-01 decision. ON by default, because a deaf or
  /// hard-of-hearing child gets nothing at all from narration and a default is
  /// what almost everyone keeps.
  captionsEnabled Boolean @default(true)

  persona         Persona?         @relation(fields: [personaId], references: [id], onDelete: SetNull)
  narrationAssets NarrationAsset[]
```

**The asset stores no narration text.** The cache key is the hash and the
script is the text. One fewer copy of a sentence describing a child's homework,
and the captions read from the script (which M4 already renders), not from the
asset.

### The six persona rows are INSERTed by the migration, not by a seed script

There is no `prisma/seed.ts` in this repo and no `prisma.seed` entry in
`package.json`. Adding one means a second command (`pnpm db:seed`) that has to
be remembered on every environment including Neon, where `pnpm db:migrate:prod`
is the only step anyone runs today. A forgotten seed is an app with zero
personas, which is an app with no narration at all.

So the six rows land as `INSERT`s inside the same migration, hand-added after
`--create-only` (the M4 mechanics, §1 of that plan). A later voice remap
(AC 3's repointing) is a new migration — which is the audit trail we want
anyway: "when did Coach Vale's voice change, and to what" becomes a question
`git log prisma/migrations/` answers.

**Operational note, so nobody loses an hour to it:** `.claude/hooks/guard.mjs`
denies writes under `prisma/migrations/` outright. M4 hand-added a CHECK
constraint the same way, so the path exists — it needs `CLAUDE_SKIP_GUARD=1`
for that one write, which is a deliberate, human-authorised exception. And
`SHADOW_DATABASE_URL` must be passed per command until `.env` is fixed
(CLAUDE.md > Databases).

The seeded values are the owner's six, verbatim from the spec:

| slug | label | voice id | voice |
|---|---|---|---|
| `smooth-j` | Smooth J | `cjVigY5qzO86Huf0OWal` | Eric |
| `professor-sunny` | Professor Sunny | `cgSgspJ2msm6clMCkdW9` | Jessica |
| `coach-vale` | Coach Vale | `XrExE9yKIg1WjnnlVkGX` | Matilda |
| `professor-o` | Professor O | `nPczCjzI2devNBz1zQrb` | Brian |
| `professor-blaze` | Professor Blaze | `TX3LPaxmHKxFdv7VOQHJ` | Liam |
| `professor-love` | Professor Love | `Xb7hH8MSUJpSbSDYk0k2` | Alice |

**§8.4 verifies all six ids resolve on the live account before this migration
is applied anywhere.** A voice id that 404s at generation time is AC 3's
fallback firing on every lesson, which is a working app that quietly speaks in
the wrong voice.

### Retention classification — required, and it fails the suite if missed

`tests/unit/lib/jobs/retention-policy-coverage.test.ts` reads
`schema.prisma` and fails on any model with no classification. All four new
models must be classified in the same commit as the migration:

| Model | Classification |
|---|---|
| `NarrationAsset` | `NARRATION_AUDIO` (new `RETENTION_POLICY` key) |
| `LessonNarration` | `NARRATION_AUDIO` |
| `LessonNarrationStep` | `NARRATION_AUDIO` |
| `Persona` | **outside the policy** — "App reference data: a label, a description and a vendor voice id. Holds nothing about a child." |

The new key's `windowDays` is **M0's decision, not M5's** (the spec says M5
states no duration). §10.3 asks for it. The plan's default, chosen so the build
is not blocked, is `windowDays: null` with the note *"life of the ACTIVE
profile"* — matching `LESSON_CONTENT`, since narration cannot outlive the
lesson it was generated from. If M0 picks a real window instead, the coverage
test will demand a job step in `enforce-retention.ts`, which is the desired
behaviour and is a small addition, not a redesign.

`RETENTION_POLICY` is also what `/retention` renders to parents verbatim, so
the `purpose` string has to be written for a parent: *"An audio recording of
the tutor's voice reading a lesson explanation aloud, and the timings that keep
the drawing in step with it."*

---

## 2. Config — `lib/config.ts`

Every threshold in one module, per the spec's own last assumption. Nothing here
is a literal at a call site.

| Constant | Value | Why |
|---|---|---|
| `NARRATION_TTS_PROVIDER` | `"elevenlabs"` | Recorded so the cache row and the vendor-assessment row agree on a name. |
| `NARRATION_MODEL_ID` | `"eleven_multilingual_v2"` | Measured: 976 ms, 1 credit/char, full alignment. Quality over latency because M5 pre-generates and a child hears it many times. |
| `NARRATION_OUTPUT_FORMAT` | `"mp3_44100_128"` | Universally decodable by `<audio>`; available on the cheapest paid tier (research §1). |
| `NARRATION_MAX_CONCURRENCY` | `2` | AC 9. **The floor, deliberately.** The scoped key cannot read the plan tier (401), and the published floor is 2 concurrent on Free / 3 on Starter. §8.3 raises it with evidence or leaves it. |
| `NARRATION_MAX_ATTEMPTS` | `3` | AC 9's 429 backoff, matching `MAX_EXTRACTION_ATTEMPTS`. |
| `NARRATION_BACKOFF_BASE_MS` | `750` | Exponential with jitter: 750 / 1500 / 3000. A guess. |
| `NARRATION_TIMEOUT_MS` | `330_000` | Anchored ABOVE the route's `maxDuration = 300`, exactly as `LESSON_AUTHORING_TIMEOUT_MS` is — M4's review found a timeout below `maxDuration` reaps a live run and sells the child a second paid one. |
| `NARRATION_RUNS_PER_HOUR` | `6` | Matches `LESSONS_PER_HOUR`; a narration run cannot outnumber the lessons that can exist. |
| `NARRATION_DAILY_BUDGET_CHARS` | `20_000` | AC 21. Per profile per day, counted in characters actually SENT (cache hits are free). ~7 worst-case lessons, ~14 typical. A guess; §10.4. |
| `NARRATION_SYNC_TOLERANCE_MS` | `150` | AC 15. The spec's assumption, unmeasured. §8.2. |
| `NARRATION_URL_REFRESH_MARGIN_MS` | `60_000` | Signed URLs live `SIGNED_URL_TTL_MS` (5 min); a 12-step lesson runs longer. The player re-fetches the narration payload this far before the earliest expiry. |
| `CUE_FORMAT_VERSION` | `"1"` | ADR-0021. Stored per asset so a format change is a data question. |
| `DEFAULT_PERSONA_SLUG` | `"professor-love"` | AC 3's fallback and the persona for a profile that never chose. **A slug, ours — not a vendor voice id**, so this constant does not violate AC 1. §10.5 confirms the choice. |
| `PERSONA_ARTWORK_IDS` | 6 ids | AC 2. The artwork does not exist yet (§10.6); the ids and a placeholder do. |
| `NARRATION_PATHNAME_PREFIX` | `"narration"` | One place the reconciler, the purge and the cache agree on the prefix. |

`NARRATION_CHAR_CAP` (240) already exists from M4 and is AC 10's cap. It is
enforced at authoring; M5 re-asserts it at generation and returns the typed
error rather than truncating, because an unreachable check is cheap and a
truncated explanation is invisible to everyone except the child.

---

## 3. API contract — FIXED once approved

Continuing the numbering, which ended at 45. **Two new routes and one extended
route.** There is no `GET /api/personas`: the picker is a server component that
reads the persona table through the DAL and passes rows as props, and M4's rule
holds — a route with no consumer is a retention obligation nobody scoped.

| # | Route | Method | Auth | Input (zod) | Success | Error |
|---|---|---|---|---|---|---|
| 4† | `/api/students/[studentId]` | PATCH | **Owner+ACTIVE** | existing `updateStudentInputSchema`, extended with `personaId: z.cuid().optional()` and `captionsEnabled: z.boolean().optional()` (still `.strict()`, still "at least one key") | `200 { student: StudentProfileDTO }`, now carrying `persona: { id, slug, label } \| null` and `captionsEnabled` (AC 4, AC 18) | 400 · 401 · **403** non-ACTIVE, before the body is parsed (M0 AC 11) · 404 cross-account · **409** `personaId` does not resolve to a non-retired persona |
| 46 | `/api/lessons/[lessonId]/narration` | POST | **Owner+ACTIVE** | `z.object({}).strict()` | `202 { narration: LessonNarrationDTO }` at `PENDING`. The row is written **before** any TTS call — it is the budget grant. Generation is scheduled with `after()`, registered eagerly in request context (M3's `after()` lesson) | **403** profile not ACTIVE · **404** cross-account (AC 22) · **409** the lesson has no `READY` current version, or a run for this version is already `PENDING`/`GENERATING` · **429** over `NARRATION_RUNS_PER_HOUR` **or** over `NARRATION_DAILY_BUDGET_CHARS` — no TTS call either way (AC 21) · **400** a step exceeds `NARRATION_CHAR_CAP` (AC 10) |
| 47 | `/api/lessons/[lessonId]/narration` | GET | Owner | — | `200 { narration: LessonNarrationDTO \| null }`. Polled while `PENDING`/`GENERATING`. Lazily fails a stale `GENERATING` row past `NARRATION_TIMEOUT_MS` (the `reapIfStale` shape — **and it re-reads on a lost guard race rather than returning a hard-coded FAILED**, which is the M4 review's finding). Signed URLs are minted **only** when `READY` | 401 · 404 (AC 22) |

† Endpoint 4 already exists (M0). This is an extension of its schema and
handler, not a new route.

**Retry (AC 17) is endpoint 46 again**, not a third route: a `FAILED` run is
re-claimed and reset to `PENDING` by the same POST. Only an in-flight run 409s.

### DTOs — `lib/schemas/dto.ts` + `lib/narration/dto.ts`

```ts
export type NarrationStepDTO = {
  stepId: string;
  stepIndex: number;
  startOffsetMs: number;
  durationMs: number;
  /** AC 11. Present ONLY when the run is READY. Never logged, never in HTML sent to a cache. */
  audioUrl: string;
  audioUrlExpiresAt: string;
  /** ADR-0021. Word cues relative to THIS step's audio. Nothing renders them in M5 (AC 14 derives them; word highlighting is M6+). */
  words: { text: string; startMs: number; endMs: number }[];
};

export type LessonNarrationDTO = {
  id: string;
  versionId: string;
  status: NarrationStatus;
  /** AC 19's label is built from this, client-side, from an allowlisted string. */
  persona: { id: string; slug: string; label: string } | null;
  stepCount: number | null;
  totalDurationMs: number | null;
  /** From `NARRATION_FAILURE_MESSAGES` only. Never a provider payload (M1 AC 24). */
  failureMessage: string | null;
  /** Empty unless READY. */
  steps: NarrationStepDTO[];
  // NEVER in a DTO: providerVoiceId, ttsModelId, pathname, cacheKey,
  // charactersBilled, failureCode, cacheHits.
};
```

`providerVoiceId` is absent from every DTO on purpose. Nothing in the browser
needs it, and the one place it is allowed to exist is a database row (AC 1).

### Rules that bind every one of these

1. **A signed URL never appears in a log, an error report, or a `console.error`
   argument.** The spec calls them bearer credentials. The DTO is not logged.
2. **The client never calls the vendor.** `ELEVENLABS_API_KEY` is server-only
   and never `NEXT_PUBLIC_`. Audio reaches the browser only from our own store,
   through a signed URL.
3. **The outbound request carries text, voice id, model id and output format.
   Nothing else** (AC 12) — no display name, no email, no profile id, no
   lesson id, no filename, no custom header. §7.4 is the test.

---

## 4. Component tree

```
app/(app)/lessons/[lessonId]/page.tsx              server  unchanged shape; now also loads the
                                                           narration DTO and the profile's
                                                           captionsEnabled, and renders the AC 19
                                                           disclosure.
  components/lessons/ai-voice-disclosure.tsx       server  AC 19. A persistent label — "Spoken by
                                                           a computer voice (Coach Vale)" — not a
                                                           dialog. Static text, no state.
  components/lessons/narration-state.tsx           CLIENT  polls #47 while PENDING/GENERATING;
                                                           renders AC 17's "narration unavailable"
                                                           label + retry (#46). "use client":
                                                           it owns a poll interval. Stops on
                                                           error (the M4 poller finding).
  components/lessons/lesson-view.tsx               CLIENT  unchanged reason for existing (a server
                                                           component cannot pass the render prop);
                                                           now also threads narration + captions.
    components/lessons/lesson-player.tsx           CLIENT  MODIFIED. Owns one <audio> element and
                                                           the step index. "use client": audio
                                                           element, timers, user input.
      components/lessons/stage.tsx                 CLIENT  MODIFIED. Gains the step-reveal
                                                           transition and the annotation stroke
                                                           reveal — M5's first real animation —
                                                           and honours prefers-reduced-motion by
                                                           REMOVING both (AC 15).
      components/lessons/lesson-captions.tsx       CLIENT  NEW. The CURRENT step's line only, never
                                                           the script. aria-live="polite".
                                                           "use client": visibility follows the
                                                           player's step index.
      components/lessons/player-controls.tsx       CLIENT  MODIFIED. Adds mute and a captions
                                                           toggle; the toggle PATCHes #4 (AC 18,
                                                           AC 4's shape).
  components/lessons/lesson-text-view.tsx          server  unchanged. AC 16's separate, complete
                                                           equivalent — not a substitute for
                                                           captions and not substituted by them.

app/(app)/students/[studentId]/voice/page.tsx      server  NEW. Loads personas through the DAL and
                                                           passes rows as props. No API route.
  components/personas/persona-picker.tsx           CLIENT  NEW. Radio-group of persona cards;
                                                           PATCHes #4. "use client": selection +
                                                           optimistic state.
  components/personas/persona-card.tsx             server  NEW. Artwork, label, description. Pure
                                                           presentation, no interactivity of its
                                                           own.

app/api/dev/local-object/route.ts                  server  NEW, DEV ONLY. See §6.
hooks/use-prefers-reduced-motion.ts                CLIENT  RECOVERED from git history (deleted
                                                           2026-08-28). useSyncExternalStore over
                                                           matchMedia with a `false` server
                                                           snapshot — it was correct; do not
                                                           rewrite it.
```

### The player, precisely

This is the part most likely to be built differently by two people, so it is
pinned here.

- **One `<audio>` element for the whole lesson**, whose `src` is the current
  step's signed URL. Advancing a step sets `src` and calls `play()`; `onEnded`
  advances. AC 16's "no audio from a later step still playing" is then
  structural — there is one element and one source — rather than a bug to
  remember not to write.
- **Drawing follows audio, never a second clock.** The player's M4 `setTimeout`
  path survives *only* for the no-narration case (AC 17, and any lesson whose
  narration is FAILED or absent). When narration is present, step advance is
  driven by the audio element's `ended` event and its `currentTime`.
- **The cue source is swapped, not the player.** `lib/narration/cue-source.ts`
  exports `narrationCueSource(steps)` returning the existing `CueSource` type
  from `lib/lessons/cues.ts`. This is exactly what M4 built that seam for; the
  player's `stepIndexAt` / `startOfStep` calls do not change.
- **Two M4 latent defects must be fixed in the same file, because narration
  makes them reachable** (both are listed as known-open in CLAUDE.md):
  `staticCueSource(timeline)` is currently called on every render and thrown
  away, and `stepIndex` never resets when `script` changes.
- **Signed URL refresh.** When the earliest `audioUrlExpiresAt` is less than
  `NARRATION_URL_REFRESH_MARGIN_MS` away, the player re-fetches #47. No new
  endpoint, no per-asset URL route.
- **Autoplay is an ASSUMPTION, not a fact** — see §8.2 and Risks.

### Captions

The M4 player already renders the current step's narration text in an
`aria-live="polite"` paragraph. M5 does not invent captions; it promotes that
paragraph into `lesson-captions.tsx`, styles it as a caption, gates it on
`captionsEnabled`, and adds the toggle. The three binding constraints from the
owner's decision are met as follows, and each names the file that will carry
it:

- *current step's line only* — `lesson-captions.tsx` receives `narration` from
  `PlayerState`, which is `script.steps[stepIndex].narration`. It has no access
  to the whole script, so "the caption is the whole script" is not a bug that
  can be written here.
- *toggle persisted per profile* — `player-controls.tsx` PATCHes endpoint 4
  with `captionsEnabled`, the same shape as the persona selection.
- *AC 16's text view stays separate* — `lesson-text-view.tsx` is untouched.

---

## 5. Slices — file counts are stated, and none exceeds six

M2.5 cited the six-file rule and then put three concerns in one slice, which
had to be split mid-build. Each slice below names its files and its count.

**Shared / blocking, before anything runs in parallel:** slice 1. It carries
the migration, the DTO types and the config constants that both tracks compile
against.

| # | Slice | Files | n |
|---|---|---|---|
| 1 | **Migration, seed rows, retention, config** | `prisma/schema.prisma`, the migration SQL (hand-added persona `INSERT`s), `lib/config.ts`, `tests/unit/lib/jobs/retention-policy-coverage.test.ts` (classify the four models), `tests/unit/lib/narration/no-voice-id-literals.test.ts`, `tests/integration/persona-seed.test.ts` | 6 |
| 2 | **Storage port, reconciler, deletion registry** | `lib/storage/port.ts` (`put`), `lib/storage/local-fs.ts`, `lib/jobs/reconcile-blobs.ts`, `lib/deletion/service.ts` (`PROFILE_BLOB_SOURCES`), `tests/unit/lib/jobs/reconcile-blobs.test.ts`, `tests/unit/lib/deletion/blob-sources.test.ts` | 6 |
| 3 | **Cascades and purge — its own slice, per retro lesson 19** | `lib/narration/purge.ts`, `lib/uploads/delete-upload.ts`, `app/api/extractions/[extractionId]/route.ts`, `tests/integration/narration-deletion-cascade.test.ts`, `tests/unit/lib/narration/purge.test.ts` | 5 |
| 4 | **Provider client and cue derivation** | `lib/narration/provider.ts`, `lib/narration/cues.ts`, `lib/narration/speakable.ts`, `lib/errors.ts`, `tests/unit/lib/narration/cues.test.ts`, `tests/unit/lib/narration/provider.test.ts` | 6 |
| 5 | **The generation pipeline** | `lib/narration/cache.ts`, `lib/narration/generate.ts`, `lib/narration/dto.ts`, `tests/unit/lib/narration/cache.test.ts`, `tests/unit/lib/narration/generate.test.ts` | 5 |
| 6 | **Routes 46/47 and the profile PATCH extension** | `app/api/lessons/[lessonId]/narration/route.ts`, `lib/schemas/narration.ts`, `lib/schemas/student.ts`, `app/api/students/[studentId]/route.ts`, `tests/unit/app/api/lessons-narration.test.ts`, `tests/unit/app/api/student-persona.test.ts` | 6 |
| 7 | **Persona picker (the screen)** | `lib/personas/dal.ts`, `lib/personas/dto.ts`, `components/personas/persona-card.tsx`, `components/personas/persona-picker.tsx`, `app/(app)/students/[studentId]/voice/page.tsx`, `tests/unit/components/personas/persona-picker.test.tsx` | 6 |
| 8 | **The audio player** | `lib/narration/cue-source.ts`, `components/lessons/lesson-player.tsx`, `components/lessons/lesson-captions.tsx`, `components/lessons/player-controls.tsx`, `tests/unit/lib/narration/cue-source.test.ts`, `tests/unit/components/lessons/lesson-player.test.tsx` | 6 |
| 9 | **Narration state, disclosure, dev audio route** | `components/lessons/narration-state.tsx`, `components/lessons/ai-voice-disclosure.tsx`, `app/api/dev/local-object/route.ts`, `app/(app)/lessons/[lessonId]/page.tsx`, `tests/unit/components/lessons/narration-state.test.tsx`, `tests/unit/app/api/dev-local-object.test.ts` | 6 |
| 10 | **AC 15 — the first animation and the reinstated preference** | `hooks/use-prefers-reduced-motion.ts` (recovered), `components/lessons/stage.tsx`, `app/globals.css` (or the stage's classes), `tests/unit/hooks/use-prefers-reduced-motion.test.ts`, `tests/unit/components/lessons/stage-motion.test.tsx` | 5 |
| 11 | **THE ENTRY POINT — "Choose your tutor's voice"** | `app/(app)/students/[studentId]/page.tsx` (a card linking to `/voice`), `components/lessons/ai-voice-disclosure.tsx` (a "change voice" link), `tests/e2e/persona-selection.spec.ts` | 3 |
| 12 | **M5-2 for real: the browser measurement** | `tests/e2e/narration-playback.spec.ts`, and the note it produces | 2 |

**The parallel split.** Slice 1 lands first, alone. Then backend (2, 3, 4, 5,
6) and frontend (7, 8, 9, 10) run against the fixed contract in §3. Slices 11
and 12 are last and are sequential, and **11 is not optional**: M2.5 shipped
seven green slices and 616 passing tests with no screen anywhere that let a
student start a checkpoint. The equivalent failure here is a persona picker
that exists and is linked from nothing.

### What slice 11 actually has to be true of

Ask it out loud before the milestone is called done: **can a child reach the
voice picker from a screen they already visit?** The answer must be a named
link on the student page, not "the route exists". And: **does a lesson a child
opens today get narrated without anyone pressing anything?** Endpoint 46 is
called by `narration-state.tsx` on mount when a `READY` lesson has no narration
run — that auto-request is the second entry point, and it is in slice 9.

### Deliberately NOT in these slices

- **The Vercel Blob adapter.** §6.
- **Word-level caption highlighting.** AC 14 derives the data; the spec puts
  rendering it out of scope.
- **Pre-warming narration** for unopened lessons.
- **Narrating chat replies or practice problems.** Different milestone,
  different model, different decision.
- **Extracting the generic status machine.** This is now the *fourth* instance
  of `PENDING → …  → READY | FAILED`. It should become one — and, exactly as
  M4 argued, not while the fourth is being written.

---

## 6. What M5 needs from storage, and whether the gap blocks it

M5 is the first feature in this app that **writes** an object server-side.
Everything before it wrote objects from the browser, straight to the CDN.

**Three facts, read from the code rather than assumed:**

1. `StoragePort` (`lib/storage/port.ts`) **has no write method.** It has
   `handleClientUpload`, `head`, `signedReadUrl`, `readBytes`, `del`,
   `listAll`. There is nothing narration can call.
2. `LocalFsStorage` **already implements `put()`** — deliberately outside the
   port, per its own docstring, "for tests and for a future local-only upload
   route to call directly."
3. `lib/storage/vercel-blob.ts` **does not exist**, and `get-storage.ts`'s
   `vercel-blob` branch throws.

So M5 adds one method to the port:

```ts
  /**
   * Writes an object server-side. Narration (M5) is the first caller: audio is
   * generated by a server-side vendor call, so its bytes never travel
   * browser-to-CDN the way an upload's do, and `handleClientUpload` cannot
   * carry them (see LocalFsStorage's docstring).
   */
  put(pathname: string, data: ArrayBuffer | Uint8Array, contentType: string): Promise<{ pathname: string; sizeBytes: number }>;
```

`LocalFsStorage` satisfies it today; the signature is deliberately narrower
than its existing `put` (no `uploadedAt` — that parameter exists for tests).

**Does the missing Vercel Blob adapter block M5? No, and it does not make it
worse.** The app cannot be deployed with working uploads today either — M1 has
the same dependency, and `STORAGE_DRIVER=local` is the project default. What
M5 changes is that the unwritten `vercel-blob.ts` now has one more method to
implement, and that is worth writing into ADR-0003's follow-up list rather than
discovering during a deploy.

**What DOES block hearing anything in local dev**, and needs building in slice
9: `LocalFsStorage.signedReadUrl` returns a deliberately non-fetchable
`local-storage://…` URL. An `<audio src="local-storage://…">` plays nothing.
So slice 9 adds `app/api/dev/local-object/route.ts`, modelled exactly on
`app/api/dev/local-upload/route.ts` — **the fence first**: `if (STORAGE_DRIVER
!== "local") return 404`, before anything else, unconditional and not
bypassable by request input, so a probe against production cannot even confirm
the path exists. Then: session, and the requested pathname must match
`students/<a profile this session owns>/narration/<key>.mp3`. It is an
arbitrary-file-read route if that check is wrong, so it is a route with one
job and a regex.

---

## 7. Deletion, retention, and the second vendor

This is the half of M5 that is not about audio quality, and it is where the
milestone can do real harm.

### 7.1 The reconciler will delete narration audio unless it is taught not to

**This is the finding that must not be missed, and it is worse than the spec's
open question describes.** The spec asks that M0 AC 43's store-enumerating
reconciler "cover the narration prefix". Read
`lib/jobs/reconcile-blobs.ts`: it already enumerates the **whole store** with
`storage.listAll()` and no prefix, and treats *any* pathname with no matching
`Upload` row, older than `ORPHAN_THRESHOLD_MINUTES` (60), as an orphan to
delete.

So on the first cron run more than an hour after the first narration object is
written, **every narration object in the store is deleted**, and the
`NarrationAsset` rows survive pointing at nothing. Every lesson then plays a
404. Nothing fails loudly; the audio simply stops existing.

The fix is in slice 2, which lands **before** slice 5 writes the first object:
`reconcileBlobs` stops asking "is there an `Upload` row" and starts asking "does
*any* registered owner claim this pathname", over a small registry:

```ts
// lib/jobs/reconcile-blobs.ts — the claim registry
const BLOB_CLAIMANTS = [
  (pathnames: string[]) => db.upload.findMany({ where: { pathname: { in: pathnames } }, select: { pathname: true } }),
  (pathnames: string[]) => db.narrationAsset.findMany({ where: { pathname: { in: pathnames } }, select: { pathname: true } }),
] as const;
```

An object is an orphan only if no claimant returns it. The tests that will
prove it (slice 2): a narration object **with** a row survives a run however
old it is; a narration object **without** a row, older than the threshold, is
deleted — which is the behaviour we actively want, because slice 5 writes the
blob before the row and a crash between the two is exactly the orphan class
this job exists for.

### 7.2 `deleteStudentData` reads one table, and it needs two

`lib/deletion/service.ts` step 1 reads `db.upload.findMany({ where: {
studentProfileId } })` and nothing else. AC 20 and M0 AC 46/48 are unsatisfiable
until it also reads `NarrationAsset`.

ADR-0015 proposed the mechanism and it is **not built** — the ADR is revised
this milestone to say so in the future tense. Slice 2 will add:

```ts
export const PROFILE_BLOB_SOURCES = [
  { model: "upload",         where: (id: string) => ({ studentProfileId: id }) },
  { model: "narrationAsset", where: (id: string) => ({ studentProfileId: id }) },
] as const;
```

plus `tests/unit/lib/deletion/blob-sources.test.ts`, which **reads
`schema.prisma`** and fails if any model declaring a `pathname` field and a
`studentProfileId` field is missing from the registry. That is the same
mechanism as the retention-coverage test, and it is the real deliverable: the
scoping decision makes deletion possible, the registry makes forgetting it
loud. M6's voice sample is the next thing it will catch.

Ordering is unchanged and stays ADR-0007 §1: **blobs before rows**, and a
storage failure returns `STORAGE_FAILURE` with nothing destroyed.

### 7.3 AC 20's *lesson* clause, and the thing the cache makes awkward

AC 20 says narration objects are removed when **a lesson** is deleted, not only
when a profile is. But the cache is profile-scoped by design (ADR-0015): a
second lesson for the same child can legitimately reference the same asset, so
"delete this lesson's audio" is not a well-formed instruction.

There is also no `DELETE /api/lessons/[id]` — a lesson dies by cascade, from
its extracted problem or practice problem, which die from an extraction or an
upload. Nothing in application code watches it happen.

**The design:** `lib/narration/purge.ts` exports
`purgeUnreferencedNarration(studentProfileId)` — delete every `NarrationAsset`
for that profile with **no** remaining `LessonNarrationStep` rows, blobs first,
then rows. It is called after the row deletion by the two paths that can
cascade a lesson away (`lib/uploads/delete-upload.ts` and the extraction DELETE
route), and it is idempotent, so calling it twice or from a third path later is
free.

Three things about it worth not re-deriving:

- **It is not a refcount.** ADR-0015 rejected refcounting because a
  cross-account count that leaks or under-counts fails silently. This is a
  query for "zero referencing rows", inside one profile, run after the fact —
  it cannot over-delete, and its worst failure is a cache entry that lingers
  under a prefix that gets deleted with the profile anyway.
- **It costs cache hits.** Deleting one extraction can evict lines a future
  lesson would have reused. That is the correct side of ADR-0015's stated
  trade: correctness over credits.
- **It is the honest reading of AC 20.** The literal reading — "the objects for
  that lesson" — is unsatisfiable under a shared cache without a refcount, and
  the refcount is the thing we already decided we cannot audit.

### 7.4 AC 12, and one place the spec and ADR-0015 contradict each other

AC 12 requires the outbound request to carry "the narration text and voice
selection only — no student display name, no account email, no profile id, and
**no identifier in the request metadata or the resulting object's pathname**."

ADR-0015 requires the object's pathname to be
`students/<profileId>/narration/<cacheKey>.mp3`, because prefix-scoping is what
makes deletion and reconciliation work at all.

**These cannot both be met as written.** §10.2 asks the owner to settle it. The
plan's reading, and the reason: AC 12 is about what reaches the *vendor*, and
our private pathname never does. A cuid is opaque, carries no name and no
email, and the prefix is the mechanism behind AC 20, M0 AC 46 and M0 AC 48. So
M5 will satisfy AC 12 as: **(a)** the outbound body contains exactly `text`,
`model_id`, `output_format`, and the voice id in the URL — asserted by a test
that captures the request and compares the key set, and asserts the profile id,
display name and email do not appear anywhere in the request; and **(b)** our
pathname contains only an opaque profile id and a content hash. If the owner
reads AC 12 literally instead, ADR-0015 has to be reopened before slice 1, and
deletion needs a different mechanism — that is a rewrite, not a revision, which
is why it is in §10 and not a footnote.

### 7.5 The §312.4 direct notice — a hard precondition, and possibly a re-consent

M5 is **the first outbound flow to a second AI vendor.** The direct notice
(M0 AC 12–13) names Anthropic, Vercel and Neon. It must name the TTS vendor
**before the first narration request is made**, and that is an M0 edit, not an
M5 one. So is the §312.8 vendor-assessment row (M0 AC 52).

There is a second-order question the plan cannot answer and must not bury:
**adding a recipient of a child's data is a change to who receives it, and the
notice carries a version.** M0 AC 14's design keeps existing rows on the
version actually served to them. Whether every already-consented family must be
re-noticed and re-consented before their child's narration text is sent to
ElevenLabs is a §312.5 question for the owner and, realistically, for counsel.
It is in §10.7. It is not a blocker for building M5; it is a blocker for M5
generating narration for an existing profile.

Also unanswered, and carried from ADR-0015's own follow-up list: **what the
vendor retains.** We delete our copy. Whether ElevenLabs retains submitted text
or generated audio, and for how long, is a contract question nobody has asked.

---

## 8. What must be measured or decided before each risky slice

M4 §9.2's pattern, which earned its place: four of five measurements changed
the design, and the M5 measurement already flipped one assumption outright.
Each item below names the slices it gates and what a `false` costs.

### 8.1 THE HIGHEST-RISK UNKNOWN — how mathematics is read aloud

**Gates slices 4 and 5. Nothing in the generation path should be written before
this returns.**

The problem, stated exactly. The measured sentence was prose. M4's lesson
scripts are full of LaTeX — its prompt tells the model `write` ops carry
`"\\frac{1}{4}"` — and while the same prompt tells it narration must "make
sense read on its own" and models the good form ("we add the two numerators,
one plus one"), **nothing validates that.** `LessonStepSchema.narration` is
`z.string().min(1).max(240)`. A step whose narration says `\frac{1}{4}` is a
valid M4 script today, and a TTS vendor handed that string may say "backslash
frac one two three" to a nine-year-old.

Separately: even for clean prose, character-level alignment on mathematical
text is where the research says sync silently drifts, and where AC 14's fixture
requirement comes from.

**The experiment** — an extension of `tests/unit/live/narration.live.test.ts`,
which already exists and already runs on `fetch`. Roughly 2,000 characters of
synthesis, so **one to two US cents**.

| # | Question | Method | What a `false` changes |
|---|---|---|---|
| N1 | How much real narration is not plain words? | Zero API calls. Take the six authored fixtures from the M4 measurement, extract every `narration` string, and count those containing `\`, `{`, `}`, `^`, `_`, `$`, or a digit adjacent to an operator. | If the rate is ~0, the guard in N4 is a cheap assertion. If it is material, the guard is load-bearing and slice 4 grows a normaliser. |
| N2 | Does `alignment` stay index-aligned to the string we sent? | Send the AC 14 fixture line "solve for x: 3x plus 5 equals 20". Assert `alignment.characters.join("") === input` exactly, and that start/end times are non-decreasing. | **This is ADR-0021's foundation.** If the joined characters differ from our input, word grouping cannot key off `alignment` and must use `normalized_alignment`, whose indices do not correspond to our text — which changes AC 14's derivation and the cue format. |
| N3 | What does the vendor do with LaTeX, and with bare symbols? | Send three lines: `\frac{1}{4} is one quarter`, `3x + 5 = 20`, and `one quarter`. Compare durations and per-character spans; listen to the MP3. | If LaTeX is spoken literally (expected), narration must never contain it — see the decision below. If bare `+`/`=` are expanded sensibly, no normaliser is needed for them. |
| N4 | Do expanded tokens produce degenerate spans? | On the same responses, assert no character has `end < start`, and that every whitespace-delimited word yields `end > start`. | A degenerate span means word grouping needs a repair pass, and the AC 14 fixture test needs to encode it. |

**The decision this experiment gates, stated in advance so a `false` is cheap.**
Default: **narration is sent verbatim, and LaTeX is prevented at authoring time
rather than repaired at speech time.**

- `lib/lessons/validate.ts` gains `assertSpeakableNarration(script)`, called
  **only from the authoring path**, mapping a violation to the existing
  `INVALID_SCRIPT` failure code. `lib/lessons/prompt.ts` gains one sentence:
  narration is spoken words — write "one quarter", never `\frac{1}{4}`.
- **It must NOT go into `LessonStepSchema`.** `toLessonVersionDTO` re-parses the
  stored `script` JSON with `LessonScriptSchema.safeParse` and, on failure,
  returns `script: null` — deliberately, so a malformed document surfaces as "no
  script" rather than as a renderer crash in front of a child. So tightening the
  shared schema would not merely reject new scripts: **every already-stored M4
  lesson whose narration contains a backslash would silently become a lesson
  with no script.** Author-time only. This is the difference between a change
  and an outage, and it is invisible in a diff.
- For lessons **already stored** with unspeakable narration, slice 4's
  `lib/narration/speakable.ts` applies a **closed set** of substitutions —
  closed, and derived from what N1/N3 actually find, not imagined — and if
  residual LaTeX remains, that run fails with `UNSPEAKABLE`. The lesson then
  plays silently with captions and a retry (AC 17), which is a degradation the
  product already handles. Refusing cleanly beats doing it badly; that is
  ADR-0009 §4's principle and M3/M4 already apply it.
- The rejected alternative is a general LaTeX-to-speech normaliser. It is an
  open-ended natural-language problem (`\int_0^1 x^2\,dx`), its errors are
  invisible to everyone except the child listening, and it would be the only
  unmeasured language component in the app.

### 8.2 Playback continuity in a real browser

**Gates slice 12; informs slice 8's shape. Slice 8 can be written against the
default and corrected.**

Three questions, all needing a **headed** browser — headless Chrome relaxes
autoplay policy, so a green headless run proves nothing here.

1. **Does one `<audio>` element keep its user activation across `src` changes?**
   *Assumption:* it does — the child presses Play once and every subsequent
   step plays from `onEnded`. *Falsifier:* the second step's `play()` rejects
   with `NotAllowedError`. *If false:* either create every step's element
   during the initial gesture and `play()`/`pause()` each once, or concatenate
   a lesson's audio into a single object at generation time — the second is a
   material redesign of the cache, so this is in Risks.
2. **How big is the seam between two step files?** *Assumption:* small enough
   to read as a natural pause between sentences. *Falsifier:* a gap that reads
   as a stall. *If false:* preload step k+1 into a second element while k
   plays, and swap.
3. **Is 150 ms the right sync tolerance?** Nobody has measured what a child
   notices. It is configuration, so this is non-blocking — but the measurement
   should report the observed step-start error so the constant stops being a
   guess.

### 8.3 The concurrency ceiling

**Informs slice 5. Non-blocking.** The scoped key cannot read the plan tier, so
`NARRATION_MAX_CONCURRENCY = 2` is the published floor. A three-in-flight burst
against the live account either 429s (leave it at 2) or does not (raise it once
the plan is known). AC 9 is satisfied by the pool and the backoff regardless of
the number; the number only changes how long a 12-step lesson takes.

### 8.4 Do all six persona voice ids resolve?

**Gates slice 1.** `GET /v2/voices` on the live account; assert all six seeded
ids are present. No synthesis credits. If one is missing, the seed is wrong
*before* it is applied to Neon, and AC 3's fallback would otherwise mask it —
a working app quietly speaking in the wrong voice is the failure mode that
survives a green test suite.

---

## 9. Risks

- **The reconciler eats the audio (§7.1)** → slice 2 lands before slice 5, and
  its test asserts a narration object with a row survives a run.
- **Autoplay activation does not survive a `src` change (§8.2)** → if false, the
  fallback is per-step elements primed during the initial gesture; a
  concatenated-per-lesson audio object would be a redesign of the cache and of
  AC 7, so it is the last resort, not the first.
- **`alignment` is not index-aligned to our input (§8.1 N2)** → ADR-0021's word
  derivation changes shape. Cheap now, expensive after slice 8 is built on it.
- **Stored M4 lessons contain LaTeX narration** → they narrate as `UNSPEAKABLE`
  and fall back to AC 17's silent-with-captions path. Visible, honest, and
  fixable by regenerating the lesson (M4 AC 19 already exists).
- **The §312.4 notice change may require re-consent (§7.5)** → owner and
  counsel, before the first narration request for an existing profile. Building
  M5 is not blocked; switching it on for existing families might be.
- **A signed URL leaks into a log or an error report** → it is a bearer
  credential for a recording of a child's homework. The DTO is never passed to
  `console.error`; the narration failure path logs a code, never the payload.
- **Deploying M5 needs a `put()` that does not exist for Vercel Blob (§6)** →
  same gap M1 already has; not made worse, but now on ADR-0003's follow-up
  list.
- **Per-step files multiply small objects** — a 12-step lesson is 12 objects of
  ~50 KB. At the measured ~17 KB/s of MP3 that is a few hundred KB per lesson;
  storage is cheap relative to credits, but it is a growth curve to watch, and
  every one of those objects is a deletion obligation.
- **`NARRATION_DAILY_BUDGET_CHARS` set badly stops a child mid-lesson** → the
  budget is checked once per run, before any call, so a run that starts
  completes. AC 21's 429 is refused at the door, never mid-lesson.

---

## 10. What needs the owner's decision before implementation starts

1. **The SDK, or no dependency at all.** ADR-0020 recommends **plain `fetch`
   and no new dependency**: two endpoints, a measurement that already proved
   the exact wire shape on `fetch`, an SDK version the research could not pin,
   and a live test that would otherwise drift from production. **Approving the
   vendor and approving the dependency were framed as one decision; this
   proposal makes them two, and asks only for the vendor.** A yes to
   `@elevenlabs/elevenlabs-js` is also fine and changes only
   `lib/narration/provider.ts` — but it needs an explicit yes, per the Never
   list.
2. **AC 12 versus ADR-0015's pathname (§7.4).** The plan reads AC 12 as being
   about what reaches the vendor. If it is meant literally — no identifier in
   *our* object pathname either — ADR-0015 must be reopened before slice 1 and
   deletion needs a different mechanism.
3. **The retention window for `NARRATION_AUDIO`** (M0 owns it; M5 states no
   duration). The plan's default is "life of the ACTIVE profile", matching
   `LESSON_CONTENT`. A shorter window is buildable and adds one job step.
4. **`NARRATION_DAILY_BUDGET_CHARS = 20_000`** — a guess, set to catch a loop
   rather than to ration lessons. ~7 worst-case or ~14 typical lessons a day
   per profile.
5. **`DEFAULT_PERSONA_SLUG`.** Proposed: `professor-love` (Alice — Clear,
   Engaging Educator), as the most neutral educator voice for a child who has
   not chosen. This is also AC 3's fallback when a voice id stops resolving.
6. **The persona artwork** — six preset avatars in the M0 style. AC 2 governs
   the picture exactly as it governs the name: no likeness of a real person,
   including one that merely evokes one. Slice 1 seeds `PERSONA_ARTWORK_IDS`
   with placeholders; the picker looks unfinished until they exist.
7. **The §312.4 direct notice, the vendor-assessment row, and whether existing
   families must be re-noticed (§7.5).** The first two are hard preconditions
   for the first narration request. The third is a §312.5 question about a new
   recipient of a child's data and is the one item here that may need counsel.
8. **`NARRATION_SYNC_TOLERANCE_MS = 150`** stays a guess until §8.2 runs.
   Non-blocking, because it is configuration.
9. **Two placeholder persona names** — Professor Sunny and Professor Blaze —
   are the owner's to rename freely; the only constraint on a replacement is
   AC 2.

---

## 11. Assumptions to challenge at the retro

- **Per-step audio files.** They make cumulative drift impossible and the cache
  natural, and they buy that with a seam between every pair of steps. If §8.2
  finds the seam audible, the whole shape is worth re-arguing.
- **Narration on first open, not at authoring time.** Cheaper when a lesson is
  never watched, and it puts a wait in front of a child who just asked for a
  lesson. Nobody has measured which the child minds more.
- **The default persona is silent about itself.** A child who never opens the
  picker is taught by Professor Love and never learns they could change it,
  unless slice 11's entry point is genuinely visible.
- **Captions on by default is right; whether the toggle is discoverable is
  untested.** A child who finds them cluttering has to find the control.
- **`assertSpeakableNarration` refuses at authoring time.** If it refuses often,
  the prompt is wrong and the fix is the prompt, not the gate. Watch the
  `INVALID_SCRIPT` rate after it lands — M4's review found a failure code that
  was unreachable and pinned an observed rate at zero, which is the same
  measurement failing the other way.
