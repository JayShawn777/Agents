# Implementation plan: M2 (practice and mastery) through M7 (the adaptive loop)

- **Status:** Proposed — awaiting owner approval. No code has been written.
- **Date:** 2026-08-27
- **Author:** architect agent
- **Specs:** [m2-practice-and-mastery.md](../specs/m2-practice-and-mastery.md) (27 AC) ·
  [m3-chat-tutor.md](../specs/m3-chat-tutor.md) (21 AC) ·
  [m4-whiteboard-lessons.md](../specs/m4-whiteboard-lessons.md) (22 AC) ·
  [m5-narration-and-personas.md](../specs/m5-narration-and-personas.md) (22 AC) ·
  [m6-custom-voice.md](../specs/m6-custom-voice.md) (22 AC) ·
  [m7-adaptive-loop.md](../specs/m7-adaptive-loop.md) (23 AC) — **137 total**
- **New ADRs:** [0009](../adr/0009-bundled-common-core-taxonomy-with-closed-slate-skill-selection.md) taxonomy ·
  [0010](../adr/0010-mastery-as-a-monotonic-ratchet-over-per-skill-counters.md) mastery ·
  [0011](../adr/0011-two-stage-answer-grading-with-server-only-answer-keys.md) grading ·
  [0012](../adr/0012-bounded-chat-sessions-with-a-snapshotted-learner-context.md) chat bounds + cache ·
  [0013](../adr/0013-ndjson-chat-streaming-with-client-supplied-turn-keys.md) streaming ·
  [0014](../adr/0014-lessonscript-as-one-versioned-validated-json-document.md) LessonScript ·
  [0015](../adr/0015-per-profile-narration-cache-instead-of-a-global-content-address.md) narration cache
- **Carried forward, unchanged:** ADR-0005 (structured output), ADR-0006 (route
  handlers and the seven ordered checks), ADR-0007 (blob-first deletion,
  append-only consent), ADR-0008 (consent method interface).

---

## 0. Read this first

This is **one pass over six milestones, at two different depths on purpose.**

- **§1 (schema) is complete for all six.** Migrations are immutable once applied.
  A data model designed one milestone at a time accumulates corrective
  migrations instead of decisions, and the specific decisions that would have
  been expensive to get wrong — that `SkillMastery` is keyed on
  `(studentProfileId, skillCode)` and not on a set, that the learner context is
  a stored snapshot and not a render, that narration is cached per profile and
  not globally — are all cross-milestone. They are settled here.
- **§3.1–3.4, §4 and §5 (contract, components, file order) are complete for M2
  and M3 only.** Those two are next to build, well understood, and their
  contracts are fixed tightly enough that a frontend and a backend engineer can
  work in parallel without talking.
- **§3.5 gives M4–M7 shape only** — models, modules and seams. Their specs name
  real unknowns: whether a lesson can be authored inside a function timeout,
  whether the model places elements legibly at phone width, whether a voice can
  be created without a human step. **A detailed contract on top of an unmeasured
  assumption is a document that gets thrown away.** §9 says what must be
  measured before each of them can be written.

Five things gate everything below.

1. **M0's `RETENTION_POLICY` is missing every row these milestones need.** M2,
   M3, M4, M5, M6 and M7 all state — correctly, per the one-number-one-home rule
   — that they define no retention window and that M0 owns it. M0's array in
   `lib/config.ts` today has ten entries and **not one of them covers practice,
   attempts, mastery, transcripts, lesson scripts, playback, narration audio,
   voice samples, the recorded consent statement, learner profiles or activity
   sessions.** The existing bijection test (every windowed key has a job step and
   vice versa) will fail until each is added with a job step. §7.2 lists them.
   **This is an M0 edit, and it blocks M2.**
2. **The §312.4 direct notice must be edited before M3, again before M5, and
   again before M7.** M3 sends a child's free text to Anthropic; M5 introduces a
   second AI vendor; M7 sends the broadest view of a single child the app will
   ever assemble. M0 AC 13 requires the notice to name each recipient and what it
   receives. Each is an M0 change with a `DIRECT_NOTICE_VERSION` bump, not an
   M3/M5/M7 change.
3. **One new dependency, in M5 only** (§8). M2, M3, M4 and M7 add none.
4. **Extraction accuracy has still never been measured**, and M2's mastery, M7's
   parent report and every claim either makes rest on it. §10 is the judgement
   the owner asked for and it is not a footnote.
5. **The measurements in §9 are not optional for M4–M7.** Three of M4's five open
   questions, both of M5's blocking ones, and both of M6's are unmeasured vendor
   or model behaviour. Nothing about their contracts should be written down until
   they return.

Two rules from M0/M1 carry forward unchanged and are restated because every new
route depends on them:

- **A profile id in a URL is not authorization.** Every query touching student
  data resolves through `lib/auth/dal.ts`, scoped by `userId`. §5.0 adds five DAL
  functions and extends one; nothing else may load these rows.
- **`withAuth()`'s seven ordered checks (ADR-0006) are the contract**, including
  step 4 (consent-state gate) sitting above step 6 (body parse). Every new route
  in §3 names which hook does which check, because the ordering is the part two
  engineers resolve differently.

---

## 1. Prisma schema — all six milestones

Additions to `prisma/schema.prisma`. **Nothing existing is modified except three
additive changes, listed in §1.7.** The M0/M1 migration
(`20260826213116_0001_m0_m1_core`) is applied and is never edited.

### 1.1 M2 — practice and mastery

```prisma
enum PracticeSetStatus {
  GENERATING      // row exists, AI call in flight. Also the AC 26 rate-limit grant.
  READY           // generated, not yet started
  IN_PROGRESS     // at least one attempt
  COMPLETE        // AC 21 — the student reached the end
  FAILED          // AC 5/6 — zero problems persisted
}

enum AnswerFormat {
  NUMERIC
  EXPRESSION
  FRACTION
  SHORT_TEXT
  MULTIPLE_CHOICE
}

/// AC 14: UNSCORED is a first-class outcome, not an error. The student is never
/// told they are wrong on an UNSCORED attempt (ADR-0011 §3).
enum AttemptResult {
  CORRECT
  INCORRECT
  UNSCORED
}

/// Which stage of ADR-0011 decided this attempt. Feeds SkillMastery.modelGradedCount,
/// which is how the M7 parent report can be honest about its own evidence.
enum GradedBy {
  NORMALIZER
  MODEL
  UNGRADED
}

/// AC 18. Ordered. `MASTERY_LEVEL_ORDER` in lib/domain/enums.ts is the canonical
/// ordering — Prisma cannot compare enum values, so the ratchet uses
/// `level: { in: LEVELS_BELOW[next] }` (ADR-0010 §2).
enum MasteryLevel {
  NOT_STARTED
  BEGINNING
  DEVELOPING
  SECURE
}

model PracticeSet {
  id               String            @id @default(cuid())
  studentProfileId String
  /// AC 3: practice only ever comes from a CONFIRMED extraction. Cascade is
  /// AC 25: deleting the extraction deletes the practice built from it.
  extractionId     String
  status           PracticeSetStatus @default(GENERATING)

  /// Provenance of the authoring call. NEVER returned to a client (AC 6).
  model            String
  effort           String
  promptVersion    String
  /// ADR-0009 §3: which taxonomy generation produced these skill codes.
  taxonomyVersion  String
  generationAttempts Int             @default(0)
  /// Internal code, mapped to a fixed user-facing string at the API layer (AC 6).
  failureCode      String?
  inputTokens      Int?
  outputTokens     Int?

  startedAt        DateTime?
  /// Generation finished (any terminal status).
  completedAt      DateTime?
  /// AC 21: the student reached the end. A different axis from `completedAt`.
  finishedAt       DateTime?
  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt

  studentProfile StudentProfile    @relation(fields: [studentProfileId], references: [id], onDelete: Cascade)
  extraction     Extraction        @relation(fields: [extractionId], references: [id], onDelete: Cascade)
  problems       PracticeProblem[]

  /// AC 26's hourly cap counts rows here. The row is written BEFORE the AI call,
  /// so a failed generation still counts — the same reason UploadTokenGrant exists.
  @@index([studentProfileId, createdAt])
  @@index([extractionId])
  /// The lazy-reap query for a GENERATING set whose function died (mirrors reapIfStale).
  @@index([status, startedAt])
}

model PracticeProblem {
  id                       String       @id @default(cuid())
  practiceSetId            String
  ordinal                  Int
  /// AC 1: which extracted problem this was modelled on. SetNull rather than
  /// Cascade — the set already cascades from the extraction, so this FK only has
  /// to survive M1 AC 29's single-problem delete without taking the practice with it.
  sourceExtractedProblemId String?

  /// AC 7: exactly one primary skill code, from the bundled taxonomy. Constrained
  /// at generation time by a zod enum over the candidate slate (ADR-0009 §2), and
  /// re-checked against the same slate before persistence.
  skillCode                String
  /// LaTeX delimited $…$ / $$…$$, same convention as M1 (ADR-0005).
  text                     String
  containsMath             Boolean      @default(false)
  answerFormat             AnswerFormat
  /// MULTIPLE_CHOICE only; empty otherwise. NOT an answer key — the correct
  /// option is identified in PracticeAnswerKey, never by position here.
  choices                  String[]
  /// 0 = same level as the source, +1 = one step harder (the spec's assumption:
  /// the last problem in a set is one step harder). Driven by PRACTICE_SET_DIFFICULTY_LADDER.
  difficultyOffset         Int          @default(0)
  createdAt                DateTime     @default(now())

  practiceSet   PracticeSet        @relation(fields: [practiceSetId], references: [id], onDelete: Cascade)
  sourceProblem ExtractedProblem?  @relation(fields: [sourceExtractedProblemId], references: [id], onDelete: SetNull)
  answerKey     PracticeAnswerKey?
  attempts      Attempt[]
  lessons       Lesson[]

  @@unique([practiceSetId, ordinal])
  @@index([skillCode])
}

/// AC 17, the STRUCTURAL half. A separate table so that
/// `db.practiceProblem.findMany({ where: { practiceSetId } })` — the query a page
/// writes without thinking — cannot return an answer key, and so that a server
/// component passing a PracticeProblem row into a client component serialises no
/// key into the RSC flight payload. Reaching it requires typing
/// `include: { answerKey: true }`, which is one grep for a reviewer (ADR-0011 §5).
model PracticeAnswerKey {
  practiceProblemId String   @id
  canonicalAnswer   String
  /// AC 13: alternate written forms the author judged acceptable for this skill.
  acceptedForms     String[]
  /// AC 12: revealed only after ATTEMPTS_BEFORE_REVEAL incorrect attempts.
  workedSolution    String
  createdAt         DateTime @default(now())

  practiceProblem PracticeProblem @relation(fields: [practiceProblemId], references: [id], onDelete: Cascade)
}

model Attempt {
  id                String        @id @default(cuid())
  practiceProblemId String
  /// Denormalised. Ownership scoping and M7's aggregation are one index hit
  /// instead of a three-table join, and it is the same profile either way.
  studentProfileId  String
  /// AC 10: 1-based, never overwritten. The @@unique makes a double-submit a
  /// P2002 the handler converts into "return the existing attempt".
  attemptNumber     Int
  submittedAnswer   String
  result            AttemptResult
  gradedBy          GradedBy
  /// AC 11: shown to the student. Post-checked to exclude the canonical answer
  /// and every accepted form (ADR-0011 §4).
  hint              String?
  /// AC 12: this attempt is the one that triggered the reveal.
  revealed          Boolean       @default(false)
  elapsedMs         Int?
  /// M7 AC 14/AC 16 — exactly-once mastery application (ADR-0010 §3). Also stamped
  /// immediately, with NO counter change, for an attempt submitted after a reveal.
  appliedToMasteryAt DateTime?
  createdAt         DateTime      @default(now())

  practiceProblem PracticeProblem @relation(fields: [practiceProblemId], references: [id], onDelete: Cascade)
  studentProfile  StudentProfile  @relation(fields: [studentProfileId], references: [id], onDelete: Cascade)
  chatSessions    ChatSession[]

  @@unique([practiceProblemId, attemptNumber])
  @@index([studentProfileId, createdAt])
  @@index([practiceProblemId, createdAt])
}

/// AC 18. One record per (profile, skill). `level` is a RATCHET — assigned only a
/// value strictly higher than its current one (AC 19, ADR-0010 §2).
/// Removed ONLY on profile deletion, never on extraction deletion (ADR-0010 §6).
model SkillMastery {
  id                 String       @id @default(cuid())
  studentProfileId   String
  /// ADR-0009 §3: a bundled-taxonomy code. Deliberately no foreign key.
  skillCode          String

  attemptCount       Int          @default(0)
  correctCount       Int          @default(0)
  /// Resets to 0 on a wrong answer. NEVER rendered — AC 20 governs payloads,
  /// and this is an input to the ratchet, not an output.
  consecutiveCorrect Int          @default(0)
  /// How many of correctCount the MODEL decided rather than the deterministic
  /// normaliser. Server-only. The evidence floor for M7's parent report.
  modelGradedCount   Int          @default(0)
  level              MasteryLevel @default(NOT_STARTED)
  levelReachedAt     DateTime?
  lastPracticedAt    DateTime?

  createdAt          DateTime     @default(now())
  updatedAt          DateTime     @updatedAt

  studentProfile StudentProfile @relation(fields: [studentProfileId], references: [id], onDelete: Cascade)

  @@unique([studentProfileId, skillCode])
  @@index([studentProfileId, level])
}
```

### 1.2 M3 — the chat tutor

```prisma
/// AC 6: a session that hits a bound is CLOSED, and the reason is kept because
/// the wrap-up copy and the offered next action differ.
enum ChatSessionStatus {
  OPEN
  CLOSED_TURN_LIMIT
  CLOSED_TIME_LIMIT
  CLOSED_BY_STUDENT
}

enum ChatRole {
  USER
  ASSISTANT
}

model ChatSession {
  id                 String            @id @default(cuid())
  studentProfileId   String
  /// AC 1 / AC 16: bound to exactly ONE of these, and cannot be re-pointed.
  /// Prisma cannot express "exactly one"; the generated migration is hand-edited
  /// BEFORE it is applied to add
  ///   CHECK (num_nonnulls(extracted_problem_id, attempt_id) = 1)
  /// — see §1.8. Both cascade, which is AC 16's second half.
  extractedProblemId String?
  attemptId          String?

  status             ChatSessionStatus @default(OPEN)
  studentTurnCount   Int               @default(0)
  /// Stamped from config AT OPEN, not read per turn (ADR-0012 §1): a limit that
  /// shifts under a live conversation is a bug nobody can reproduce.
  maxStudentTurns    Int
  revealAfterTurns   Int
  expiresAt          DateTime

  /// ADR-0012 §2. The learner context RENDERED ONCE at open. Every turn sends
  /// these exact bytes, which is what makes AC 8's cache_read_input_tokens > 0
  /// true by construction. NEVER in a DTO.
  renderedContext       String
  contextHash           String
  contextVersion        String
  /// NULL until M7 exists.
  learnerProfileVersion Int?
  systemPromptVersion   String
  model                 String

  openedAt  DateTime  @default(now())
  closedAt  DateTime?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  studentProfile   StudentProfile    @relation(fields: [studentProfileId], references: [id], onDelete: Cascade)
  extractedProblem ExtractedProblem? @relation(fields: [extractedProblemId], references: [id], onDelete: Cascade)
  attempt          Attempt?          @relation(fields: [attemptId], references: [id], onDelete: Cascade)
  messages         ChatMessage[]

  @@index([studentProfileId, openedAt])
  /// The lazy-close query on GET (AC 6) and the retention sweep.
  @@index([status, expiresAt])
}

model ChatMessage {
  id             String   @id @default(cuid())
  sessionId      String
  role           ChatRole
  /// AC 11: full content in order, never a summary — M7 reads these.
  content        String
  sequence       Int
  /// AC 12: the stream was aborted and this is what had been generated.
  partial        Boolean  @default(false)
  /// AC 13: the output token cap was hit.
  truncated      Boolean  @default(false)
  /// AC 21: this assistant turn is the fixed safety response, not model output.
  safetyResponse Boolean  @default(false)
  /// ADR-0013 §3: client-supplied idempotency key on USER messages, NULL on
  /// assistant messages. Postgres treats NULLs as distinct in a unique index, so
  /// many assistant rows coexist without a partial index. A retried turn is a
  /// P2002 the handler converts into a replay, never a duplicate.
  clientTurnId   String?

  inputTokens      Int?
  outputTokens     Int?
  /// ADR-0012 §4 / research §5: persisted from day one. Zero across repeated
  /// turns is the ONLY signal that the cached prefix is varying.
  cacheReadTokens  Int?
  cacheWriteTokens Int?

  createdAt DateTime @default(now())

  session ChatSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@unique([sessionId, sequence])
  @@unique([sessionId, clientTurnId])
  @@index([sessionId, createdAt])
}
```

### 1.3 M4 — whiteboard lessons

```prisma
/// AC 6, verbatim: PENDING -> AUTHORING -> READY | FAILED.
enum LessonStatus {
  PENDING
  AUTHORING
  READY
  FAILED
}

model Lesson {
  id                 String       @id @default(cuid())
  studentProfileId   String
  /// AC 5 / AC 21: exactly one. Same hand-edited CHECK constraint as ChatSession.
  extractedProblemId String?
  practiceProblemId  String?

  status           LessonStatus @default(PENDING)
  currentVersionId String?      @unique

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  studentProfile   StudentProfile        @relation(fields: [studentProfileId], references: [id], onDelete: Cascade)
  extractedProblem ExtractedProblem?     @relation(fields: [extractedProblemId], references: [id], onDelete: Cascade)
  practiceProblem  PracticeProblem?      @relation(fields: [practiceProblemId], references: [id], onDelete: Cascade)
  versions         LessonScriptVersion[] @relation("LessonVersions")
  currentVersion   LessonScriptVersion?  @relation("LessonCurrentVersion", fields: [currentVersionId], references: [id], onDelete: SetNull)
  flags            LessonFlag[]
  playbacks        LessonPlayback[]

  @@index([studentProfileId, createdAt])
}

/// ADR-0014. ONE validated JSON document per authoring run. Steps are NOT rows:
/// the script is authored atomically, never edited, and always read whole, so
/// AC 2's "zero steps persisted" is a null column rather than a transaction.
/// Deliberately carries NO studentProfileId — ownership runs through Lesson, so
/// cross-student reuse is not designed out (M4 "out of scope").
model LessonScriptVersion {
  id              String       @id @default(cuid())
  lessonId        String
  version         Int
  status          LessonStatus @default(PENDING)

  /// NULL until READY. AC 3's closed vocabulary is enforced by the zod
  /// discriminated union that is simultaneously the model's output format.
  script          Json?
  /// Which primitive-vocabulary generation this document validates against.
  /// The player refuses an unknown one and offers regeneration, rather than
  /// drawing a blank canvas (ADR-0014 §3).
  schemaVersion   String
  stepCount       Int?
  totalDurationMs Int?

  /// AC 1: persisted with the source problem id (via Lesson), the model id, the
  /// effort setting and the prompt version.
  model         String
  effort        String
  promptVersion String
  failureCode   String?
  inputTokens   Int?
  outputTokens  Int?

  startedAt   DateTime?
  completedAt DateTime?
  createdAt   DateTime  @default(now())

  lesson     Lesson            @relation("LessonVersions", fields: [lessonId], references: [id], onDelete: Cascade)
  currentOf  Lesson?           @relation("LessonCurrentVersion")
  narrations LessonNarration[]
  flags      LessonFlag[]

  @@unique([lessonId, version])
  @@index([status, startedAt])
}

/// AC 18. `stepId` is the AUTHORED step id, not an array index — a regeneration
/// with a different step count would silently repoint an index.
model LessonFlag {
  id                    String   @id @default(cuid())
  lessonId              String
  lessonScriptVersionId String
  stepId                String?
  reason                String?  // bounded free text, zod-capped
  createdAt             DateTime @default(now())

  lesson  Lesson              @relation(fields: [lessonId], references: [id], onDelete: Cascade)
  version LessonScriptVersion @relation(fields: [lessonScriptVersionId], references: [id], onDelete: Cascade)

  @@index([lessonId, createdAt])
}

/// M4 "Data touched": start, completion and furthest step ONLY — not an event
/// stream. This is an engagement log about a minor with no stated business need
/// beyond product analytics, which is what §312.10 is aimed at. See §7.2: it
/// gets the shortest retention window in the table, and ADR-0014's follow-up
/// asks whether it should exist at all.
model LessonPlayback {
  id                    String    @id @default(cuid())
  lessonId              String
  lessonScriptVersionId String
  startedAt             DateTime  @default(now())
  completedAt           DateTime?
  furthestStepIndex     Int       @default(0)

  lesson Lesson @relation(fields: [lessonId], references: [id], onDelete: Cascade)

  @@index([lessonId, startedAt])
  @@index([startedAt])   // the retention sweep
}
```

### 1.4 M5 — narration and personas

```prisma
enum PersonaStatus {
  ACTIVE
  /// M6 AC 13: the vendor returned a voice needing further verification.
  PENDING_VERIFICATION
  /// M6 AC 18: consent revoked. Unselectable; existing narration still plays.
  REVOKED
  /// M5 AC 3: the provider voice id no longer resolves.
  UNAVAILABLE
}

/// M5 AC 1: a database row, NOT a literal in application code. The category's
/// stock voices are documented to expire on a published date; a voice id
/// compiled into the app is an outage with a calendar entry.
/// M6 extends this row rather than adding a parallel model (AC 12's isolation is
/// `ownerUserId`, and nothing downstream of the persona changes).
model Persona {
  id              String        @id @default(cuid())
  provider        String        // "elevenlabs"
  providerVoiceId String
  label           String
  description     String
  avatarId        String?
  status          PersonaStatus @default(ACTIVE)
  isDefault       Boolean       @default(false)
  sortOrder       Int           @default(0)

  /// NULL for the app-owned shared set. Set for an M6 cloned voice, which is
  /// then visible only to this account's profiles (M6 AC 12).
  ownerUserId String?
  revokedAt   DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  owner           User?            @relation(fields: [ownerUserId], references: [id], onDelete: Cascade)
  studentProfiles StudentProfile[]
  narrationAssets NarrationAsset[]
  customVoice     CustomVoice?

  @@unique([provider, providerVoiceId])
  @@index([ownerUserId])
}

/// ADR-0015. Cached PER STUDENT PROFILE, not globally content-addressed.
/// Deletion correctness beats a shared cache in the one data category where the
/// guarantee is the product.
model NarrationAsset {
  id               String @id @default(cuid())
  studentProfileId String
  personaId        String
  /// AC 7/8: sha256(narrationText \0 providerVoiceId \0 ttsModelId).
  cacheKey         String
  /// Denormalised so M6 AC 19 — "delete every cached narration generated with
  /// that voice id" — is one indexed query. Written once, never updated: a
  /// remapped persona leaves old assets keyed to the id they were made with,
  /// which is the historical truth M6 needs.
  providerVoiceId  String
  ttsModelId       String

  /// Blob pathname, never a URL. `students/<profileId>/narration/<cacheKey>.mp3`,
  /// so it is under the prefix the store-enumerating reconciler sweeps (M0 AC 43)
  /// and under the prefix deleteStudentData collects. NEVER in a DTO.
  pathname       String @unique
  contentType    String
  sizeBytes      Int
  durationMs     Int
  /// AC 13: OUR normalised cue format — { charOffset, startMs, endMs }[] plus
  /// derived word boundaries. The raw provider alignment payload is NEVER
  /// persisted: delete it and the lesson must still sync.
  cues           Json
  characterCount Int
  createdAt      DateTime @default(now())

  studentProfile   StudentProfile    @relation(fields: [studentProfileId], references: [id], onDelete: Cascade)
  persona          Persona           @relation(fields: [personaId], references: [id], onDelete: Cascade)
  lessonNarrations LessonNarration[]

  @@unique([studentProfileId, cacheKey])
  @@index([studentProfileId, createdAt])
  @@index([providerVoiceId])
}

/// Joins one step of one script version to the asset that narrates it.
/// `stepId` is the authored step id (ADR-0014 §5), not an index.
model LessonNarration {
  id                    String   @id @default(cuid())
  lessonScriptVersionId String
  stepId                String
  narrationAssetId      String
  /// Derived at generation time from the running sum of asset durations.
  /// AC 15's "no cumulative drift" is a property of this being stored, not recomputed.
  startOffsetMs         Int
  durationMs            Int
  createdAt             DateTime @default(now())

  version LessonScriptVersion @relation(fields: [lessonScriptVersionId], references: [id], onDelete: Cascade)
  asset   NarrationAsset      @relation(fields: [narrationAssetId], references: [id], onDelete: Cascade)

  @@unique([lessonScriptVersionId, stepId])
}
```

### 1.5 M6 — custom voice

```prisma
enum VoiceAuditEvent {
  CREATED
  REVOKED
  DELETED
  VENDOR_DELETE_FAILED
}

/// AC 5/6/7. The recorded spoken consent statement. NEVER transmitted to the TTS
/// vendor — it is our own artifact, held for our own account, never played to a
/// student, never transcribed (AC "out of scope").
model VoiceConsentRecording {
  id                    String  @id @default(cuid())
  userId                String
  /// Blob pathname under `users/<userId>/voice-consent/…`. NEVER in a DTO.
  pathname              String  @unique
  consentWordingVersion String
  durationMs            Int
  /// AC 7: read SERVER-side from headers, never accepted from the body.
  ipAddress             String?
  userAgent             String?
  /// AC 7: stamped once vendor creation succeeds.
  resultingProviderVoiceId String?
  /// AC 8: the appended ParentalConsent row carrying ConsentScope.VOICE_CLONING.
  /// Restrict, not Cascade — a consent record may not vanish out from under the
  /// recording that evidences it (same reasoning as DirectNotice, ADR-0007).
  parentalConsentId     String?
  createdAt             DateTime @default(now())

  user            User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  parentalConsent ParentalConsent? @relation(fields: [parentalConsentId], references: [id], onDelete: Restrict)
  customVoice     CustomVoice?

  @@index([userId, createdAt])
}

model CustomVoice {
  id                      String  @id @default(cuid())
  userId                  String
  personaId               String  @unique
  voiceConsentRecordingId String  @unique
  /// AC 11: the raw sample, uploaded browser-direct to private blob storage.
  /// Deleted promptly after successful creation per M0's VOICE_SAMPLE row — this
  /// is the most sensitive object the application will ever hold.
  samplePathname          String?
  sampleDeletedAt         DateTime?
  providerVoiceId         String
  /// AC 13: the vendor returned a voice needing further verification.
  requiresVerification    Boolean @default(false)
  createdAt               DateTime @default(now())

  user             User                  @relation(fields: [userId], references: [id], onDelete: Cascade)
  persona          Persona               @relation(fields: [personaId], references: [id], onDelete: Cascade)
  consentRecording VoiceConsentRecording @relation(fields: [voiceConsentRecordingId], references: [id], onDelete: Restrict)

  @@index([userId])
}

/// AC 21: "durable enough to answer 'who cloned this' after the fact." Like
/// DeletionAudit (ADR-0007 §4) it has NO foreign keys, so it survives the purge
/// it exists to record. `userId` is a plain nullable string, nulled by
/// deleteStudentData/account purge; `actorHash` is the HMAC that survives, using
/// the same AUDIT_PSEUDONYM_KEY as ConsentAuditArtifact.
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

### 1.6 M7 — the adaptive loop

```prisma
/// AC 1. Exactly one current record per profile, with a bounded number of
/// archived versions. Concurrency (AC 2, "only one summary is produced") is
/// handled by @@unique([studentProfileId, version]): a second concurrent run
/// computes the same next version and loses on P2002. StudentProfile
/// .summarisationClaimedAt is a best-effort lease that usually avoids the second
/// AI call; the unique constraint is the correctness backstop. Same shape as
/// Upload.pathname idempotency in lib/uploads/record-upload.ts.
model LearnerProfile {
  id               String  @id @default(cuid())
  studentProfileId String
  version          Int
  isCurrent        Boolean @default(true)

  summary                   String
  strengths                 String[]
  difficulties              String[]
  preferredExplanationStyle String

  /// AC 1: "the source counts it was derived from".
  sourceAttemptCount     Int
  sourceChatSessionCount Int
  sourceLessonCount      Int
  /// The share of source attempts decided by the MODEL rather than the
  /// deterministic normaliser. §10: the parent report must state this rather
  /// than imply certainty.
  modelGradedShare       Float

  /// AC 5 / ADR-0012 §2. The byte-stable rendering M3 snapshots onto
  /// ChatSession.renderedContext. STORED, not recomputed, so one profile version
  /// can never render two different byte strings.
  renderedContext String
  contextHash     String
  contextVersion  String

  model         String
  promptVersion String
  summarisedAt  DateTime @default(now())
  createdAt     DateTime @default(now())

  studentProfile StudentProfile       @relation(fields: [studentProfileId], references: [id], onDelete: Cascade)
  flags          LearnerProfileFlag[]

  @@unique([studentProfileId, version])
  @@index([studentProfileId, isCurrent])
  @@index([summarisedAt])   // the archived-version retention sweep
}

/// AC 19: the account owner marks the summary as inaccurate.
model LearnerProfileFlag {
  id               String   @id @default(cuid())
  learnerProfileId String
  note             String?
  createdAt        DateTime @default(now())

  learnerProfile LearnerProfile @relation(fields: [learnerProfileId], references: [id], onDelete: Cascade)

  @@index([learnerProfileId])
}

/// AC 18: time on task is derived from BOUNDED session records, each contributing
/// no more than ACTIVITY_SESSION_CAP_MINUTES. `countedMs` is the number the report
/// sums — never wall clock between first and last event. A tab left open all
/// afternoon must not be reported as study time.
model ActivitySession {
  id               String   @id @default(cuid())
  studentProfileId String
  startedAt        DateTime
  lastActivityAt   DateTime
  countedMs        Int      @default(0)
  createdAt        DateTime @default(now())

  studentProfile StudentProfile @relation(fields: [studentProfileId], references: [id], onDelete: Cascade)

  @@index([studentProfileId, startedAt])
  @@index([lastActivityAt])   // the open-session rollup and the retention sweep
}
```

**And, in the M7 migration only, added to `SkillMastery`:**

```prisma
  /// M7 AC 9/10. A SEPARATE AXIS from `level`, which is still a ratchet and still
  /// cannot fall (ADR-0010 §4). A failed review resets this index to 0 and
  /// consecutiveCorrect to 0; `level` is untouched, which is the whole of AC 12.
  reviewIntervalIndex Int       @default(0)
  reviewCount         Int       @default(0)
  nextReviewAt        DateTime?
  /// AC 13: SERVER-ONLY, always. Never in any DTO, asserted by an exact-key-set test.
  retentionEstimate   Float?

  @@index([studentProfileId, nextReviewAt])
```

These four columns land in **M7's migration, not M2's**, deliberately. A nullable
column added later is the cheapest migration there is, and a column that exists
for five milestones and is never written is a trap for a reviewer. What designing
the six schemas together actually bought is knowing that `SkillMastery` is keyed
`(studentProfileId, skillCode)` and is profile-scoped rather than set-scoped —
*that* would have been expensive to get wrong, and it is settled in §1.1.

### 1.7 Changes to existing models — all additive

| Model | Change | Milestone | Why |
|---|---|---|---|
| `StudentProfile` | `+ personaId String?` and the `Persona` relation | M5 | AC 4: the persona selection is persisted on the profile |
| `StudentProfile` | `+ summarisationClaimedAt DateTime?` | M7 | AC 2's best-effort lease, so the common case does not make two AI calls |
| `StudentProfile` | back-relations: `practiceSets`, `attempts`, `skillMastery`, `chatSessions`, `lessons`, `narrationAssets`, `learnerProfiles`, `activitySessions` | M2–M7 | required by Prisma |
| `ExtractedProblem` | back-relations: `practiceProblems`, `chatSessions`, `lessons` | M2–M4 | required by Prisma |
| `Extraction` | back-relation: `practiceSets` | M2 | required by Prisma |
| `User` | back-relations: `personas`, `customVoices`, `voiceConsentRecordings` | M5/M6 | required by Prisma |
| `ParentalConsent` | back-relation: `voiceConsentRecordings` | M6 | required by Prisma |
| `ConsentScope` enum | `+ VOICE_CLONING` | M6 | AC 8 / ADR-0007 §3: an append, never a rewrite of existing rows |

**No column is dropped, renamed or retyped anywhere in this plan.**

### 1.8 Migrations

One per milestone, so a milestone can ship without carrying unbuilt models:

| Migration | Adds | Destructive |
|---|---|---|
| `0002_m2_practice_and_mastery` | 5 enums, 5 models, 3 back-relation sets | **no** |
| `0003_m3_chat` | 2 enums, 2 models, + the hand-added `CHECK` on `ChatSession` | **no** |
| `0004_m4_lessons` | 1 enum, 4 models, + the hand-added `CHECK` on `Lesson` | **no** |
| `0005_m5_narration_personas` | 1 enum, 3 models, `StudentProfile.personaId` | **no** |
| `0006_m6_custom_voice` | 1 enum, 3 models, `ConsentScope.VOICE_CLONING` | **no** |
| `0007_m7_adaptive_loop` | 3 models, 4 columns + 1 index on `SkillMastery`, `StudentProfile.summarisationClaimedAt` | **no** |

Every migration is pure creation. **Nothing previously applied is edited** — the
guard hook blocks it anyway.

Three things to check at migrate time, in the same spirit as the M0/M1 plan's
enum-array warning:

- **`ALTER TYPE … ADD VALUE` cannot run inside a transaction block** in older
  Postgres. `0006`'s `ConsentScope` append must be verified against the target
  Postgres version before it is applied to Neon; if it fails, the workaround is a
  standalone statement in its own migration, decided **before** it is applied.
- **The two `CHECK` constraints** (`ChatSession`, `Lesson`) are hand-added to the
  generated SQL **before** `pnpm db:migrate` applies it. Prisma cannot express
  "exactly one of these two FKs". Editing an *unapplied* generated migration is
  fine; editing an applied one is not, and the guard hook enforces the
  difference.
- **`Json` columns** (`LessonScriptVersion.script`, `NarrationAsset.cues`) are
  `jsonb` under Prisma 7. Confirm at generation time; nothing depends on
  operator classes or indexes over them.

---

## 2. Error shape and message allowlists

`lib/errors.ts` is unchanged in structure. `ApiResult<T>`, `ApiError`,
`ERROR_CODES` and `ERROR_STATUS` are exactly as they are today. Three additions,
following the `EXTRACTION_FAILURE_MESSAGES` pattern already there:

```ts
export const GENERATION_FAILURE_CODES = ['REFUSED','PARSE_FAILED','TIMEOUT','UPSTREAM','INTERNAL','SLATE_EMPTY'] as const;
export const GENERATION_FAILURE_MESSAGES: Record<GenerationFailureCode, string>;

export const CHAT_FAILURE_CODES = ['REFUSED','TIMEOUT','UPSTREAM','INTERNAL','IDLE'] as const;
export const CHAT_FAILURE_MESSAGES: Record<ChatFailureCode, string>;

/// M3 AC 21. A FIXED string, not model output. Written by someone who is not an
/// engineer (§11). Directs the student to a trusted adult, offers no advice, no
/// diagnosis and no counselling, and does not continue tutoring in that turn.
export const DISTRESS_SAFETY_MESSAGE: string;

/// ADR-0011 §4. Substituted when a generated hint is found to contain the answer.
export const HINT_FALLBACK: string;
```

**The one documented exception to the envelope** is `POST /api/chat/sessions/
[sessionId]/messages`. Its success body is an NDJSON event stream, not
`{ ok: true, data }`. Every failure *before* the first byte is a normal
`ApiResult` with a real status; every failure *after* is a terminal
`{ type: 'error' }` event with an allowlisted message and the status stays 200.
See ADR-0013 §2. No other route may do this.

---

## 3. API contract

Auth column, unchanged from the M0/M1 plan: **Session** = valid session cookie
(401 otherwise). **Owner** = Session and the resource resolves under
`where: { …, userId: session.userId }` (404 otherwise). **Owner+ACTIVE** = Owner
and the owning profile's `status === 'ACTIVE'` (403 otherwise, checked **before**
the body is parsed). **Cron** = `Authorization: Bearer ${CRON_SECRET}`.

All responses carry `Cache-Control: no-store`. All non-GET handlers perform the
same-origin check inside `withAuth()`.

### 3.1 New DTOs — `lib/schemas/dto.ts`

```ts
export type PracticeSetDTO = {
  id: string;
  extractionId: string;
  status: PracticeSetStatus;
  problemCount: number;
  answeredCount: number;
  /// AC 22: ordinal of the first unanswered problem; null when none remain.
  resumeOrdinal: number | null;
  /// From GENERATION_FAILURE_MESSAGES only (AC 6). Never a model id or payload.
  failureMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
  // NOTE: model, effort, promptVersion, failureCode and token counts are NEVER in a DTO.
};

export type PracticeProblemDTO = {
  id: string;
  ordinal: number;
  /// Plain LaTeX-bearing text, for tests and for the composer.
  text: string;
  /// Server-rendered KaTeX HTML (ADR-0005: no KaTeX JS ships for this surface).
  textHtml: string;
  containsMath: boolean;
  answerFormat: AnswerFormat;
  choices: string[];
  skillCode: string;
  /// AC 9: what the UI renders. The raw code is carried but never displayed.
  skillDescriptor: string;
  skillGradeLevel: GradeLevel;
  attemptCount: number;
  revealed: boolean;
  /// AC 12/17: NON-NULL ONLY once `revealed` is true.
  workedSolution: string | null;
  workedSolutionHtml: string | null;
  // NOTE: canonicalAnswer and acceptedForms are NEVER in a DTO, in any state.
};

export type AttemptDTO = {
  id: string; practiceProblemId: string; attemptNumber: number;
  submittedAnswer: string; result: AttemptResult; createdAt: string;
  // NOTE: gradedBy and appliedToMasteryAt are NEVER in a DTO.
};

export type FeedbackDTO = {
  result: AttemptResult;
  /// Allowlisted framing copy. For UNSCORED this NEVER says the answer is wrong (AC 14).
  message: string;
  /// AC 11: post-checked to contain neither the canonical answer nor any accepted form.
  hint: string | null;
  hintHtml: string | null;
  retryOffered: boolean;
  attemptsRemainingBeforeReveal: number;
  revealAvailable: boolean;
};

export type SkillMasteryDTO = {
  skillCode: string;
  skillDescriptor: string;
  level: MasteryLevel;
  /// AC 20: a COUNT of problems practised — monotonic by construction.
  problemsPracticed: number;
  lastPracticedAt: string | null;
  // NOTE: correctCount, consecutiveCorrect, modelGradedCount, reviewIntervalIndex,
  // nextReviewAt and retentionEstimate are NEVER in a DTO (AC 20, M7 AC 13).
};

export type PracticeSetSummaryDTO = {
  skills: { skillCode: string; skillDescriptor: string; problemsAnswered: number }[];
  totalAnswered: number;
  /// AC 21: progress framing, from an allowlist. No score, no percentage, no streak.
  message: string;
};

export type ChatSessionDTO = {
  id: string;
  status: ChatSessionStatus;
  subject: { kind: 'EXTRACTED_PROBLEM' | 'ATTEMPT'; id: string };
  studentTurnCount: number;
  maxStudentTurns: number;
  expiresAt: string;
  openedAt: string;
  closedAt: string | null;
  // NOTE: renderedContext, contextHash, systemPromptVersion and model are NEVER in a DTO.
};

export type ChatMessageDTO = {
  id: string; role: ChatRole; content: string; contentHtml: string | null;
  sequence: number; partial: boolean; truncated: boolean;
  safetyResponse: boolean; createdAt: string;
  // NOTE: token counts and cache metrics are NEVER in a DTO.
};

/// ADR-0013 §1. The NDJSON wire format. One object per line.
export type ChatStreamEvent =
  | { type: 'turn';  userMessage: ChatMessageDTO; assistantMessageId: string }
  | { type: 'delta'; text: string }
  | { type: 'done';  message: ChatMessageDTO; session: ChatSessionDTO }
  | { type: 'error'; code: ErrorCode; message: string };

export type PracticeSetDetailResponse = {
  set: PracticeSetDTO; problems: PracticeProblemDTO[]; attempts: AttemptDTO[];
};
export type AttemptResponse = {
  attempt: AttemptDTO; feedback: FeedbackDTO; mastery: SkillMasteryDTO;
};
export type ChatSessionDetailResponse = {
  session: ChatSessionDTO; messages: ChatMessageDTO[];
};
```

Three DTO rules the parallel tracks must not renegotiate:

1. **No answer key, in any form, in any state, before the reveal gate has been
   passed on the server.** `workedSolution` is null until `revealed`; the
   canonical answer is never present at all. This is AC 17 and it is enforced by
   the separate `PracticeAnswerKey` table plus an exact-key-set test.
2. **No number in `SkillMasteryDTO` can fall.** Only `level` (a ratchet) and
   `problemsPracticed` (a count) are in it. `correctCount` looks harmless and is
   not: a wrong answer holds it flat while `attemptCount` rises, so any derived
   percentage falls, which is AC 20's second clause.
3. **`SkillMastery.attemptCount` is not a report number.** After an extraction is
   deleted it counts attempts that no longer exist (ADR-0010 §6). M7's parent
   report derives its counts from `Attempt` rows, always.

### 3.2 M2 route handlers — FIXED once approved

Continuing the M0/M1 plan's numbering (which ended at 28).

| # | Route | Method | Auth | Input (zod) | Success | Error |
|---|---|---|---|---|---|---|
| 29 | `/api/extractions/[extractionId]/practice-sets` | POST | **Owner+ACTIVE** | `z.object({}).strict()` | `202 { set: PracticeSetDTO }` with `status: GENERATING`. The row is written **before** the AI call, which is what makes it the rate-limit grant (AC 26). Generation is scheduled with `after()` | **403** if the owning profile is not `ACTIVE` (step 4, before body parse) · **404** cross-account or unknown extraction (`requireExtraction`) · **409** if `extraction.status !== 'CONFIRMED'` — step 5 `requireFlow`, **no set row and no AI call** (AC 3) · **429** above `PRACTICE_SETS_PER_HOUR` (AC 26), step 7, **no AI call** · 400 |
| 30 | `/api/practice-sets/[practiceSetId]` | GET | Owner | — | `200 PracticeSetDetailResponse`. Polled every 2s while `GENERATING`. Lazily transitions a stale `GENERATING` (older than `PRACTICE_GENERATION_TIMEOUT_MS + 30s`) to `FAILED`, mirroring `reapIfStale` | 401 · 404 (AC 24) |
| 31 | `/api/practice-sets/[practiceSetId]/retry` | POST | Owner+ACTIVE | `z.object({}).strict()` | `202 { set: PracticeSetDTO }`, `status: GENERATING`, `generationAttempts + 1`. **Deletes any problems from a prior partial write first** — there should never be any (AC 5), and this is the assertion | 400 · 401 · 404 · **409** unless status is `FAILED` · **429** above `MAX_PRACTICE_GENERATION_ATTEMPTS` |
| 32 | `/api/practice-problems/[problemId]/attempts` | POST | **Owner+ACTIVE** | `z.object({ answer: z.string().trim().min(1).max(PRACTICE_ANSWER_MAX_LENGTH), elapsedMs: z.number().int().min(0).max(ATTEMPT_MAX_ELAPSED_MS).optional() }).strict()` | `201 AttemptResponse`. Grading runs synchronously (ADR-0011): normaliser, then model on a miss, then `UNSCORED`. Mastery applied in the same transaction, exactly once. First `INCORRECT` returns a hint and **not** the answer (AC 11) | **400** on empty/whitespace — `.trim().min(1)` means **no attempt row is created** (AC 15) · **400** over-length (AC 16) · 401 · **403** non-`ACTIVE`, before body parse · 404 · **409** if the set is `FAILED` or `GENERATING` |
| 33 | `/api/practice-problems/[problemId]/reveal` | POST | Owner+ACTIVE | `z.object({}).strict()` | `200 { workedSolution, workedSolutionHtml, canonicalAnswer }` and the problem is marked revealed (AC 12) | **409 unless the count of `INCORRECT` attempts on this problem is `>= ATTEMPTS_BEFORE_REVEAL`** — step 5 `requireFlow`. **Without this gate AC 17 is decorative**: a client would simply call reveal first · 401 · 403 · 404 |
| 34 | `/api/practice-sets/[practiceSetId]/complete` | POST | Owner+ACTIVE | `z.object({}).strict()` | `200 { set: PracticeSetDTO, summary: PracticeSetSummaryDTO }`, `status: COMPLETE`, `finishedAt` stamped (AC 21). **Idempotent** — a repeat returns `200` with the same body and does not re-stamp | 400 · 401 · 403 · 404 · **409** if status is `GENERATING` or `FAILED` |

**Deliberately not endpoints** (ADR-0006: "no route handler exists to serve data a
server component already has"): the mastery display, the practice-set list, and
the practice-set page's initial load. All are server components reading through
the DAL. Endpoint 30 exists only because the `GENERATING` poll and the resume path
need a client-side read.

**Why `extractionId` is a path segment on #29 and not a body field.** `withAuth()`
runs the consent-state gate (step 4) and the flow precondition (step 5) *before*
the body is parsed (step 6). A body-carried `extractionId` could not be resolved
in time to make AC 3's 409 a `requireFlow`, and the check would have to move into
the handler where the ordering guarantee is lost. This is exactly the kind of
detail two engineers resolve differently, so it is fixed here.

### 3.3 M3 route handlers — FIXED once approved

| # | Route | Method | Auth | Input (zod) | Success | Error |
|---|---|---|---|---|---|---|
| 35 | `/api/extracted-problems/[problemId]/chat-sessions` | POST | **Owner+ACTIVE** | `z.object({}).strict()` | `201 ChatSessionDetailResponse`. Opens a session bound to the problem, stamps `maxStudentTurns`/`revealAfterTurns`/`expiresAt` from config, renders and stores `renderedContext` + `contextHash` (ADR-0012 §2), and writes the **templated** opening assistant message referring to that problem (AC 1) | 401 · **403** non-`ACTIVE` · **404** cross-account (AC 15) · **409** if the problem's extraction is not `CONFIRMED` · **429** above `CHAT_SESSIONS_PER_HOUR` |
| 36 | `/api/attempts/[attemptId]/chat-sessions` | POST | **Owner+ACTIVE** | `z.object({}).strict()` | as #35, bound to the attempt (AC 1, M2 AC 10's join point) | as #35 |
| 37 | `/api/chat/sessions/[sessionId]/messages` | POST | **Owner+ACTIVE** | `z.object({ clientTurnId: z.uuid(), content: z.string().trim().min(1).max(CHAT_MESSAGE_MAX_LENGTH) }).strict()` | **`200` with `Content-Type: application/x-ndjson`** — a stream of `ChatStreamEvent`, **not** an `ApiResult` (ADR-0013 §2). `export const maxDuration = 300`. A repeat of the same `clientTurnId` **replays** the stored turn and makes no second AI call | **400** malformed or over-length, **no AI call** (AC 10) · 401 · **403** non-`ACTIVE`, before body parse · 404 · **409** if `status !== 'OPEN'` or the session is past `expiresAt`/`maxStudentTurns` — **evaluated before the AI call** (AC 6) · **429** above `CHAT_MESSAGES_PER_HOUR`, **no AI call** (AC 20). Post-stream failures are a terminal `{type:'error'}` event (AC 18) |
| 38 | `/api/chat/sessions/[sessionId]` | GET | Owner | — | `200 ChatSessionDetailResponse`. Lazily closes a session past `expiresAt` (AC 6), the same pattern as `reapIfStale`. Serves reconnect, retry (AC 19) and the parent transcript read (AC 14) | 401 · 404 (AC 15) |
| 39 | `/api/chat/sessions/[sessionId]/close` | POST | Owner+ACTIVE | `z.object({}).strict()` | `200 ChatSessionDetailResponse` with `status: CLOSED_BY_STUDENT`, the templated wrap-up appended (AC 6). Idempotent | 400 · 401 · 403 · 404 · **409** if already closed |

**Totals: 11 new application endpoints across 11 route files.** Running total
across M0–M3: 38 application endpoints, plus the Auth.js catch-all, plus the two
server actions. **No new server actions.**

### 3.4 The stream contract, spelled out

Because it is the one departure from the envelope, and because the two tracks
build against it independently:

- Server writes one JSON object per line, `\n`-terminated, UTF-8.
- Order is always: exactly one `turn`, then zero or more `delta`, then exactly
  one of `done` or `error`. Never both. Never a `delta` after a terminal event.
- `turn` is emitted **before** the AI call, immediately after the two message rows
  are written. This is how the client learns the assistant message id and can
  reconcile after an abort.
- The client leaves the typing state on `done` **or** `error` **or** its own
  client-side idle timeout — never on stream end alone. A socket that dies with
  no terminal event is treated as an idle timeout.
- Aborting the request (component unmount, tab close) is what produces the
  server-side cancel. The server persists the accumulated text with
  `partial: true` (ADR-0013 §4).

### 3.5 M4–M7 — shape only, deliberately not a contract

Everything below names models, modules and seams. **No route, method, zod shape
or response body is fixed**, because each rests on an unmeasured assumption named
in §9. Writing them now produces a document that gets thrown away.

**M4 — lessons.** Roughly six endpoints: request a lesson against an extracted or
practice problem (`202`, `PENDING`); poll status; fetch a `READY` script version;
regenerate (a new version, previous stays playable); flag; record playback.
Modules: `lib/lessons/script-schema.ts` (the zod contract, ADR-0014 §2),
`lib/lessons/author.ts` (the status machine — the same shape as
`run-extraction.ts` and `generate.ts`, and the third instance of it, at which
point it should be extracted into one generic), `lib/lessons/validate.ts` (the
post-parse element-id referential check ADR-0014's follow-up requires),
`components/lessons/player/*` and one `CueSource` implementation. **The
`PENDING → AUTHORING → READY | FAILED` machine is specified now precisely so the
in-request-versus-queue answer changes the implementation and not the spec.**

**M5 — narration.** Roughly five endpoints: list personas; select a persona on a
profile; request narration for a lesson version (`202`); poll; mint a signed URL
for one asset (the same 5-minute `SIGNED_URL_TTL_MS` and the same "only place a
signed URL is emitted" rule as M0 endpoint 18). Modules: `lib/tts/port.ts` (a
`TtsPort` interface, so the vendor is one file exactly as `StoragePort` made
storage one file), `lib/tts/elevenlabs.ts`, `lib/narration/cache.ts` (the
per-profile key, ADR-0015), `lib/narration/cues.ts` (character-level alignment →
our normalised format, with the `"solve for x: 3x plus 5 equals 20"` fixture the
spec makes non-optional), and a **bounded** generation pool — concurrency, not
credits, is the documented scaling wall, and a `Promise.all` over steps fails
AC 9.

**M6 — custom voice.** Roughly six endpoints, all **account-owner scoped, never
profile scoped** (AC 3): start the flow; upload the consent recording
browser-direct; upload the sample browser-direct; approve and create; revoke;
delete. Modules: `lib/voice/consent.ts`, `lib/voice/create.ts`,
`lib/voice/delete.ts` (vendor-side first, then blobs, then rows — ADR-0007's
ordering with a third system in front). AC 2's "no navigation path from any
student-facing surface" is a route-group placement (`app/(app)/settings/voice/`)
plus a Playwright crawl, not a permission check.

**M7 — the adaptive loop.** Roughly six endpoints: the parent report; the learner
profile view; flag the summary as inaccurate; the review set (which **reuses M2's
generation and grading**, per the spec's own assumption, rather than a second
pipeline); complete a review set; an activity heartbeat. Modules:
`lib/learner/summarise.ts`, `lib/learner/render.ts` (**the same
`renderLearnerContext` M3 already uses, widened** — ADR-0012 §2),
`lib/review/schedule.ts` (the deterministic interval table),
`lib/activity/session.ts` (the capped rollup, AC 18), `lib/report/build.ts`
(counts derived from `Attempt` rows, never from `SkillMastery.attemptCount`).

---

## 4. Component tree — M2 and M3

Server components are the default. Every `"use client"` has a stated reason and
none imports `@/lib/db`.

```
── M2 ────────────────────────────────────────────────────────────────────────

app/(app)/students/[studentId]/page.tsx              server  EXISTING. Gains a mastery strip
                                                             and a "practice" entry point.
  components/practice/mastery-strip.tsx              server  AC 9/20. Renders SkillMasteryDTO:
                                                             descriptor + level badge + a COUNT.
                                                             No percentage, no bar that shrinks.
  components/practice/practice-set-list.tsx          server  the profile's sets, resumable (AC 22)

app/(app)/students/[studentId]/uploads/[uploadId]/page.tsx    server  EXISTING. Gains the CTA,
                                                             rendered only when the extraction is
                                                             CONFIRMED (AC 3 in the UI as well as
                                                             the API).
  components/practice/generate-practice-button.tsx   CLIENT  POST #29 then router.push. Needs a
                                                             pending state and an error state.

app/(app)/practice/[practiceSetId]/page.tsx          server  loads set + problems through the DAL.
                                                             SERVER-RENDERS each problem's KaTeX to
                                                             `textHtml` and passes the array down —
                                                             so no KaTeX JS ships for this surface
                                                             (ADR-0005). NEVER selects the answer key.
    components/practice/generating-state.tsx         CLIENT  polls #30 until terminal
    components/practice/practice-runner.tsx          CLIENT  THE one big client component in M2:
                                                             current ordinal, answer input, submit,
                                                             feedback, retry, reveal, next. Resumes
                                                             at `resumeOrdinal` (AC 22). Receives
                                                             pre-rendered problem HTML as props.
    components/practice/answer-input.tsx             CLIENT  switches on AnswerFormat; MULTIPLE_CHOICE
                                                             renders `choices` as buttons
    components/practice/feedback-panel.tsx           CLIENT  renders FeedbackDTO. Three distinct
                                                             visual states — CORRECT / INCORRECT /
                                                             UNSCORED — and the UNSCORED copy MUST NOT
                                                             read as "wrong" (AC 14)
    components/practice/reveal-panel.tsx             CLIENT  POST #33, gated on `revealAvailable`
    components/practice/set-summary.tsx              server  AC 21. Progress framing, no mark
    components/practice/failed-set.tsx               server  AC 6. Plain message + retry (#31)

── M3 ────────────────────────────────────────────────────────────────────────

app/(app)/chat/[sessionId]/page.tsx                  server  loads session + messages via DAL;
                                                             notFound() on a null (AC 15)
    components/chat/chat-transcript.tsx              server  stored messages. Math rendered
                                                             SERVER-side with KaTeX, as M1 does
    components/chat/chat-composer.tsx                CLIENT  textarea, send, abort. OWNS the NDJSON
                                                             reader and the AbortController; unmount
                                                             aborts, which is what triggers the
                                                             server-side partial persist (AC 12)
    components/chat/streaming-message.tsx            CLIENT  the in-flight assistant bubble. Plain
                                                             text while streaming; lazily imports
                                                             KaTeX and re-renders on `done`.
                                                             **This is the ONLY place KaTeX JS ships
                                                             to the browser** — see the note below
    components/chat/session-limit-banner.tsx         server  AC 6 wrap-up + the offered next action
    components/chat/truncated-notice.tsx             server  AC 13
    components/chat/chat-error.tsx                   CLIENT  AC 18/19: plain message + retry, which
                                                             re-sends the SAME clientTurnId

components/chat/open-chat-button.tsx                 CLIENT  POST #35 or #36 from a problem row or a
                                                             graded attempt, then router.push

app/(app)/students/[studentId]/chat/page.tsx         server  AC 14. The account owner's transcript
                                                             list for this profile.
    components/chat/session-list.tsx                 server  one row per session with its status
```

**The one deliberate departure from ADR-0005.** M1 renders LaTeX server-side so
no KaTeX JavaScript reaches the browser. That is impossible for a streaming reply:
partial LaTeX does not parse, and a token boundary lands mid-`\frac` constantly.
So `streaming-message.tsx` shows plain text during the stream and lazily imports
KaTeX to re-render once `done` arrives. The cost is one lazy chunk **on the chat
route only**; the stored transcript is still rendered on the server. This is a
decision, not an oversight, and it is why `ChatMessageDTO` carries both `content`
and a nullable `contentHtml`.

**shadcn components to add via the CLI:** `scroll-area` (the transcript and the
runner), `tooltip` (the mastery level explainer). Everything else the two
milestones need — `card`, `alert`, `badge`, `button`, `input`, `textarea`,
`dialog`, `progress`, `skeleton`, `separator` — already exists.

**Two DOM-level rules the frontend must not soften:**

- **No element of the practice surface may render a percentage, a score out of
  anything, a streak, or a progress bar whose fill can decrease** (AC 20). Not
  greyed out, not hidden — absent. The Playwright assertion is a regex sweep of
  the rendered page for `%` adjacent to a skill name.
- **The answer key never enters a client component's props**, in any state before
  the reveal. The runner receives `workedSolution: null` until the server says
  otherwise, and it fetches the reveal rather than holding it.

---

## 5. File-by-file implementation order — M2 and M3

### 5.0 Shared — must land before the tracks split

Both engineers import these; neither may edit them without re-agreeing the
contract. After S19, `pnpm typecheck` passes with no runtime code.

| # | File | What |
|---|---|---|
| S10 | `prisma/schema.prisma` + `pnpm db:migrate` | §1.1 and §1.2 verbatim → `0002_m2_practice_and_mastery`, `0003_m3_chat`. The `ChatSession` `CHECK` is hand-added to the generated SQL before it is applied (§1.8) |
| S11 | `lib/taxonomy/ccss-k8.json` + `lib/taxonomy/index.ts` | ADR-0009 §1. `resolveSkill`, `candidateSlate`, the `Skill` type. **Pure — no DB, no network, no `server-only`.** The frontend needs it for AC 9; the backend needs it for the slate |
| S12 | `lib/config.ts` | Every tunable in §7.1, **and the new `RETENTION_POLICY` rows in §7.2**. No literal anywhere else |
| S13 | `lib/errors.ts` | §2: `GENERATION_FAILURE_*`, `CHAT_FAILURE_*`, `DISTRESS_SAFETY_MESSAGE`, `HINT_FALLBACK` |
| S14 | `lib/domain/enums.ts` | Re-export the six new Prisma enums. `MASTERY_LEVEL_ORDER`, `MASTERY_LEVEL_LABELS`, `LEVELS_BELOW` (ADR-0010 §2), `ANSWER_FORMAT_LABELS` |
| S15 | `lib/ai/outbound.ts` | **`OutboundLearnerFacts`** — the type every prompt builder in M2, M3, M4 and M7 takes. It has **no name, id, avatar or email field**, so M2 AC 27 / M3 AC 7 / M4 AC 9 / M7 AC 4 are properties of the type rather than of a redaction step. Types only |
| S16 | `lib/math/render.ts` | The server-side KaTeX segment renderer, extracted from the existing `components/uploads/problem-list.tsx`. Both tracks need it; today it is inlined in one component |
| S17 | `lib/schemas/practice.ts`, `lib/schemas/chat.ts` | Every zod input schema in §3.2 and §3.3 |
| S18 | `lib/schemas/dto.ts` | §3.1 verbatim, **including `ChatStreamEvent`** |
| S19 | `lib/auth/dal.ts` | `requirePracticeSet`, `requirePracticeProblem`, `requireAttempt`, `requireChatSession`, `requireExtractedProblem`; and **`requireExtraction` extended to `include: { upload: { include: { studentProfile: true } } }`** so #29 can run its ACTIVE gate at step 4. Every one scoped by `userId`. **Signature-only in this phase; both tracks type against it** |

**S11 and S15 are the blocking pair.** The frontend cannot render a skill
descriptor without S11, and the backend cannot write a prompt builder without S15.
Neither is large; both must land first.

### 5.1 Backend track

| # | File | What |
|---|---|---|
| B25 | `lib/grading/normalize.ts` | **Pure. No DB, no network, no model.** ADR-0011 §1. The highest-value unit test in M2 and the right first task — it can start the moment S12 lands |
| B26 | `lib/ai/practice-schema.ts` | The per-request generation schema built over the candidate slate (ADR-0009 §2). A function of `(slate, setSize)`, not a module-scope constant |
| B27 | `lib/practice/prompt.ts` | The generation prompt + `PRACTICE_PROMPT_VERSION`. Takes `OutboundLearnerFacts` and the slate. Uses the **student-corrected** problem text where present (AC 4) |
| B28 | `lib/practice/generate.ts` | The status machine. **Mirror `lib/extraction/run-extraction.ts` closely** — refusal, null parse, timeout, typed SDK error, in that order; one terminal transaction; zero partial writes (AC 5); a `reapIfStale` twin for a killed function |
| B29 | `lib/practice/dto.ts` | DTO builders. **The module that guarantees no answer key crosses the boundary.** Its exact-key-set test is the AC 17 assertion |
| B30 | `app/api/extractions/[extractionId]/practice-sets/route.ts` | Endpoint 29. `requireFlow` = `CONFIRMED`; `rateLimit` = the hourly count over `PracticeSet` rows |
| B31 | `app/api/practice-sets/[practiceSetId]/route.ts`, `.../retry/route.ts`, `.../complete/route.ts` | Endpoints 30, 31, 34 |
| B32 | `lib/grading/adjudicate.ts` | ADR-0011 §2/§4. The low-effort model call, the three-verdict schema, and the **hint post-check** — exported, because M3 AC 3 uses the same function |
| B33 | `lib/grading/grade.ts` | Composes B25 → B32 → `UNSCORED`. The only module that reads `PracticeAnswerKey` |
| B34 | `lib/mastery/apply.ts` | ADR-0010 §2/§3. The ratchet and the exactly-once stamp. **The only module that may write `skillMastery`** — a reviewer grep, as with `parentalConsent.update` |
| B35 | `app/api/practice-problems/[problemId]/attempts/route.ts`, `.../reveal/route.ts` | Endpoints 32, 33. The reveal gate is a `requireFlow` |
| B36 | `lib/chat/context.ts` | ADR-0012 §2. `renderLearnerContext` (pure, deterministic, no clock), `hashContext`, `LEARNER_CONTEXT_VERSION`. **Unit-testable with no mocks and the file that AC 8 actually rests on** |
| B37 | `lib/chat/prompt.ts` | `TUTOR_SYSTEM_PROMPT` + version; the problem-as-data wrapper (AC 9); the AC 4 mid-conversation system message. **Its length is load-bearing** — a test asserts it exceeds `CHAT_SYSTEM_PROMPT_MIN_TOKENS` |
| B38 | `lib/chat/safety.ts` | AC 21. The distress check and the fixed message. Runs on the student's message **before** the AI call; a hit writes the fixed assistant reply and makes no call |
| B39 | `lib/chat/session.ts` | Open, close, limit evaluation, the templated opener and wrap-up, the lazy close |
| B40 | `lib/chat/stream.ts` | ADR-0013 §4/§5. Anthropic stream → NDJSON, abort → `after()` partial persist, truncation flag, idle timer, usage capture |
| B41 | `app/api/extracted-problems/[problemId]/chat-sessions/route.ts`, `app/api/attempts/[attemptId]/chat-sessions/route.ts` | Endpoints 35, 36. **Two routes, one `openChatSession()` service** — the ADR-0007 §4 pattern |
| B42 | `app/api/chat/sessions/[sessionId]/route.ts`, `.../messages/route.ts`, `.../close/route.ts` | Endpoints 37, 38, 39. `maxDuration = 300` on `messages` |
| B43 | `lib/jobs/enforce-retention.ts` | New job steps for every windowed `RETENTION_POLICY` row added in §7.2. **The existing bijection test fails until this lands** |
| B44 | `.env.example`, `docs/runbook.md` | No new env vars in M2/M3; the runbook gains the `RUN_LIVE_AI=1` cache-verification procedure |

### 5.2 Frontend track

| # | File | What |
|---|---|---|
| F18 | `components/ui/scroll-area.tsx`, `tooltip.tsx` | shadcn CLI adds |
| F19 | `lib/api/client.ts` | `apiStream<E>()` beside the existing `apiFetch<T>()`. **Buffers partial lines across chunk boundaries** — a naive `split('\n')` per chunk works locally and breaks on a slow network. Its own unit test with boundaries placed mid-JSON. Can start on day one; depends only on S18 |
| F20 | `components/practice/mastery-strip.tsx` + `student-status` additions | AC 9, AC 20. Depends only on S11, S14, S18 — the other good day-one task |
| F21 | `app/(app)/practice/[practiceSetId]/page.tsx` + `generating-state.tsx` + `failed-set.tsx` | AC 6, AC 22's server half |
| F22 | `components/practice/practice-runner.tsx` + `answer-input.tsx` + `feedback-panel.tsx` + `reveal-panel.tsx` | AC 10–17, AC 22. **The UNSCORED copy is the thing to get right** |
| F23 | `components/practice/set-summary.tsx` + `practice-set-list.tsx` + `generate-practice-button.tsx` | AC 1, AC 21, AC 23 |
| F24 | `app/(app)/chat/[sessionId]/page.tsx` + `chat-transcript.tsx` + `session-limit-banner.tsx` + `truncated-notice.tsx` | AC 1, AC 6, AC 13, AC 17 |
| F25 | `components/chat/chat-composer.tsx` + `streaming-message.tsx` + `chat-error.tsx` | AC 2, AC 12, AC 18, AC 19. The `AbortController`, the lazy KaTeX import, the same-`clientTurnId` retry |
| F26 | `components/chat/open-chat-button.tsx` | Entry from a confirmed problem and from a graded attempt |
| F27 | `app/(app)/students/[studentId]/chat/page.tsx` + `session-list.tsx` | AC 14 |

### 5.3 Typecheck order

`schema → generated enums → taxonomy + config + errors + domain enums → outbound
types + math render → zod schemas + DTOs → DAL signatures → server (services,
routes) → UI`. Each step compiles on its own. F19–F27 depend only on S11, S13,
S14, S16, S17, S18 — never on a backend file — which is what makes the split real
rather than nominal.

---

## 6. Verification plan

### 6.1 Covered by Vitest (unit and integration, Node, real local Postgres)

Route handlers are imported and called directly with a stubbed session, so every
status-code criterion is asserted literally. Anthropic is mocked in CI.

| Area | Criteria |
|---|---|
| Practice set created from a `CONFIRMED` extraction; every problem linked to a source problem; set scoped to one profile | M2 1 |
| Generated text is not identical to the source text, for every problem in a fixture set | M2 2 |
| Every non-`CONFIRMED` extraction status → **409**, zero `PracticeSet` rows, **zero AI calls** (asserted on the mock) | M2 3 |
| A student-corrected problem's **corrected** text is what appears in the captured outbound request | M2 4 |
| `parsed_output: null` → `FAILED`, **zero** `PracticeProblem` rows | M2 5 |
| Refusal and timeout → `FAILED`; the response `message` is a member of `GENERATION_FAILURE_MESSAGES`; no model id, payload or exception text anywhere in the body | M2 6 |
| A skill code outside the slate fails the zod enum; a code outside the grade band is unreachable because the slate was built from it | M2 7, 8 |
| `PracticeProblemDTO` carries `skillDescriptor`; `resolveSkill` round-trips every code in the file | M2 9 |
| Second attempt creates a second row; the first row is byte-identical afterwards | M2 10 |
| First `INCORRECT` → retry offered, and `feedback.hint` contains **neither** the canonical answer **nor** any accepted form | M2 11 |
| `ATTEMPTS_BEFORE_REVEAL` reached → reveal available; below it → **409** | M2 12 |
| **The AC 13 equivalence fixture table**, table-driven against `normalize.ts`. Pure, no mocks, no DB | M2 13 |
| `UNSURE` / refusal / timeout → `UNSCORED`, `message` does not say "wrong", no counter decremented | M2 14 |
| Empty and whitespace-only bodies → **400**, **no `Attempt` row** | M2 15 |
| Over-length body → **400** with the typed shape | M2 16 |
| **The full practice-set page payload is serialised and asserted not to contain the canonical answer string**, in every pre-reveal state — the RSC path, not just the JSON path | M2 17 |
| `SkillMastery` field-by-field after a graded sequence; one row per (profile, skill) | M2 18 |
| **`SECURE` then five wrong answers → still `SECURE`**, stored and in the DTO | M2 19 |
| **`SkillMasteryDTO`'s key set asserted exactly**, so no percentage, count-that-falls or server-only field can be added by a future convenience | M2 20, M7 13 |
| Summary on completion; `status: COMPLETE`; idempotent repeat | M2 21 |
| Resume: `resumeOrdinal` is the first unanswered problem, prior attempts intact | M2 22 |
| Set size equals `PRACTICE_SET_SIZE` and does not grow | M2 23 |
| Ownership scoping, A against B, on set / problem / attempt / mastery | M2 24 · M3 15 |
| Cascades: profile deletion and extraction deletion each remove exactly the rows §1.1 says, and **`SkillMastery` survives extraction deletion** (ADR-0010 §6) | M2 25 |
| Hourly cap → **429**, **zero AI calls**, counting `FAILED` sets | M2 26 |
| **The captured outbound request contains grade, subject and problem text and does NOT contain the profile's display name, id, avatar id or the account email** — one helper, applied to generation, grading, chat and (later) authoring and summarisation | M2 27 · M3 7 · M4 9 · M7 4 |
| Session opens bound to the problem; the opener refers to it | M3 1 |
| Deltas arrive as multiple events before the terminal event (asserted on the NDJSON stream, not the browser) | M3 2 |
| "Just tell me the answer" fixture → the reply contains neither the stored key nor any accepted form, and does contain a question mark | M3 3 |
| After `revealAfterTurns`, the captured request carries the mid-conversation system message **and the `system` array is unchanged** | M3 4 |
| Off-topic fixtures → decline-and-redirect (fixture-based; see §6.3) | M3 5 |
| Turn limit and time limit each → session closed, wrap-up appended, further POST → **409** | M3 6 |
| **The `system` array is byte-identical across three turns**, and `contextHash` equals `hashContext(renderLearnerContext(facts))`. Free, deterministic, in CI | M3 8 |
| An injection string in the extracted text appears in `messages[]`, **never** in `system[]` | M3 9 |
| Over-length message → **400**, **no AI call** | M3 10 |
| Both messages persisted with role, content, sequence, timestamps and token counts, in order | M3 11 |
| **Abort mid-stream → exactly one user row, exactly one assistant row marked `partial`; the same `clientTurnId` re-sent concurrently produces one turn and one generation** | M3 12 |
| `stop_reason: 'max_tokens'` → `truncated: true` on the row and in `done` | M3 13 |
| Owner reads a full transcript for their own profile | M3 14 |
| Cascades: profile deletion and source-problem deletion each remove sessions and messages | M3 16 |
| `contentHtml` renders `$…$` as KaTeX markup for a stored message | M3 17 |
| Refusal and upstream error → a terminal `error` event with an allowlisted message; no model id or payload | M3 18 |
| Idle timeout fires, the stream terminates, the turn is retryable | M3 19 |
| Hourly message cap → **429**, **no AI call** | M3 20 |
| Distress fixtures → the fixed message, `safetyResponse: true`, **no AI call**, no advice | M3 21 |
| **`apiStream` with chunk boundaries deliberately placed mid-JSON and mid-line** | ADR-0013 |
| **Every windowed `RETENTION_POLICY` key has a job step and vice versa** — the existing bijection test, now covering §7.2's new rows | M0 44, 45 |
| Each new retention window changed in config changes what the job deletes, and only that category, against a frozen clock | M0 45 |

### 6.2 Covered by Playwright

| Area | Criteria |
|---|---|
| Practice CTA absent unless the extraction is `CONFIRMED` | M2 3 |
| Generating → ready poll; failed set shows a plain message and a retry | M2 6 |
| The runner: answer, wrong, hint without the answer, retry, third wrong, reveal | M2 11, 12 |
| **A regex sweep of the practice and student pages for a percentage, an `n/m` score or a streak adjacent to a skill name — asserted absent** | M2 20 |
| Set summary at the end; the copy contains no mark | M2 21 |
| Leave mid-set, return, resume at the right problem with prior attempts shown | M2 22 |
| Chat: text appears incrementally (assert the bubble's text grows across at least two intervals) | M3 2 |
| **Close the tab mid-stream, reload: exactly one turn, marked incomplete** | M3 12 |
| Session limit banner and the offered next action | M3 6 |
| Truncation notice | M3 13 |
| Parent opens a profile's chat history and reads a full transcript | M3 14 |
| Math renders as math in a stored reply and in a problem prompt | M2 9 · M3 17 |
| No microphone permission is requested anywhere (carried forward for M5/M6) | M5/M6 |

### 6.3 Not automatically testable — stated plainly rather than implied

This list is longer than M0/M1's and it matters more, because M0/M1's untestable
parts were legal adequacy and vendor behaviour, while these are **whether the
product works**.

**Inherited, and now load-bearing:**

- **M1 extraction accuracy is still unmeasured**, and everything in M2 rests on
  it. A misread source problem produces six confidently wrong practice problems,
  a skill code for the wrong skill, and a mastery record about something the
  child was never asked. The `CONFIRMED` gate and M1's correction affordance are
  the only mitigations and both depend on a child noticing. **§9.0 makes this a
  measurement inside M2, not a note for M7.**

**New, and specific to these two milestones:**

- **Whether a generated problem is a *good* problem.** AC 2 tests non-identity.
  A set of six well-formed, correctly-tagged, pedagogically useless problems
  passes every test in §6.1. Only a human reading a fixture set catches it.
- **Whether the chosen skill code is the *right* code.** ADR-0009's closed slate
  makes an *invalid* code impossible and does nothing about a *wrong* one. This
  is the single most consequential unmeasured thing in M2, because a wrong code
  silently splits or merges mastery records.
- **The grader's real accuracy on child-written answers.** AC 13's fixture table
  tests the deterministic normaliser exhaustively — that test is strong and will
  still be true in a year. Stage two is tested against a mock, which proves the
  plumbing. **`UNSCORED` rate per skill is the production metric that tells us
  the grader is failing, and there is no other signal.**
- **AC 11's intent.** We assert the hint does not *contain* the answer. A hint
  that trivially derives it ("it's one more than five") passes and fails the
  point.
- **AC 3 and AC 5 beyond our fixtures.** A jailbreak we did not think of is not
  covered. AC 9's injection test uses one canonical string; it proves the
  plumbing carries extracted text as data, not that the tutor is robust.
- **AC 8's actual cache hit.** CI proves our bytes do not vary. Only the
  `RUN_LIVE_AI=1` test proves Anthropic cached them. **Stated plainly: passing CI
  does not mean caching works.** `cacheReadTokens` is persisted per message from
  day one precisely because this failure is silent and expensive.
- **AC 21's distress detection has false negatives and false positives and
  neither is measurable in CI.** A false negative is a child in distress being
  tutored about fractions. The fixed message's copy must be written by someone
  who is not an engineer, and the owner must answer whether the account holder is
  notified — M3's spec says that decision is **blocking for real users**.
- **AC 2's first-token budget** depends on Anthropic latency. Measured (§9), not
  asserted.
- **Whether any of this teaches anything.** No test in this repository can assert
  that a practice set improved a child's understanding, that a hint helped, or
  that `SECURE` corresponds to a real capability. The suite proves the machine
  does what the spec says. The spec is a hypothesis about learning, and it says
  so.
- **The cumulative question.** M7's parent report will be a durable narrative
  judgement of a child built on M2's mastery, built on M2's grading, built on M1's
  extraction — none of which is measured end to end. §10.

---

## 7. Configuration

### 7.1 New tunables — `lib/config.ts`, and nowhere else

| Constant | Value | Source |
|---|---|---|
| `TAXONOMY_VERSION` | `'ccss-2010.k8.1'` | ADR-0009 |
| `SKILL_GRADE_BAND` | `1` | M2 AC 8 — **assumption** |
| `GRADABLE_SUBJECTS` | `['MATH','SCIENCE']` | M2 open question — **assumption** |
| `PRACTICE_SET_SIZE` | `6` | M2 AC 23 — **assumption** |
| `PRACTICE_SET_DIFFICULTY_LADDER` | `[0,0,0,0,0,1]` | M2 open question — same level, last one harder |
| `ATTEMPTS_BEFORE_REVEAL` | `3` | M2 AC 12 — **assumption** |
| `PRACTICE_ANSWER_MAX_LENGTH` | `500` | M2 AC 16 |
| `ATTEMPT_MAX_ELAPSED_MS` | `3_600_000` | bound on a client-supplied number |
| `PRACTICE_SETS_PER_HOUR` | `5` | M2 AC 26 — **assumption** |
| `PRACTICE_GENERATION_TIMEOUT_MS` | `120_000` | M2 open question — **pending §9.1** |
| `PRACTICE_MODEL` / `PRACTICE_EFFORT` | `'claude-opus-5'` / `'high'` | research §1, §6 |
| `MAX_PRACTICE_GENERATION_ATTEMPTS` | `3` | mirrors `MAX_EXTRACTION_ATTEMPTS` |
| `GRADING_MODEL` / `GRADING_EFFORT` | `'claude-opus-5'` / `'low'` | ADR-0011 §2 — mechanical route |
| `GRADING_TIMEOUT_MS` | `15_000` | ADR-0011 — the interactive path |
| `HINT_MAX_LENGTH` | `240` | ADR-0011 §2 — **assumption** |
| `MASTERY_LADDER` | `[{BEGINNING,1},{DEVELOPING,3},{SECURE,5}]` | ADR-0010 §2 — **assumption, re-set from the first fixture run** |
| `MASTERY_MIN_ATTEMPTS_FOR_REPORT` | `4` | §10 — the evidence floor |
| `CHAT_MAX_STUDENT_TURNS` | `20` | M3 AC 6 — **assumption** |
| `CHAT_MAX_SESSION_MINUTES` | `20` | M3 AC 6 — **assumption**, research §7 (Synthesis) |
| `CHAT_REVEAL_AFTER_TURNS` | `3` | M3 AC 4 — matches `ATTEMPTS_BEFORE_REVEAL` |
| `CHAT_MESSAGE_MAX_LENGTH` | `2_000` | M3 AC 10 |
| `CHAT_MESSAGES_PER_HOUR` | `60` | M3 AC 20 — **assumption** |
| `CHAT_SESSIONS_PER_HOUR` | `10` | not an AC; the cost bound on session opens |
| `CHAT_FIRST_TOKEN_BUDGET_MS` | `3_000` | M3 AC 2 — **pending §9.1** |
| `CHAT_IDLE_TIMEOUT_MS` | `20_000` | M3 AC 19 — **pending §9.1** |
| `CHAT_MAX_OUTPUT_TOKENS` | `4_000` | M3 AC 13 |
| `CHAT_MODEL` | `'claude-opus-5'` | research §1 |
| `CHAT_CACHE_TTL` | `'1h'` | ADR-0012 §3 |
| `CHAT_SYSTEM_PROMPT_MIN_TOKENS` | `1_024` | research §5 — **below this, caching silently no-ops** |

**Named now, valued when their milestone's measurements return (§9):**
`LESSON_MIN_STEPS`, `LESSON_MAX_STEPS`, `NARRATION_CHAR_CAP`,
`LESSON_MIN_STEP_MS`, `LESSON_MAX_STEP_MS`, `LESSON_MAX_OPS_PER_STEP`,
`LESSONS_PER_HOUR`, `LESSON_AUTHORING_TIMEOUT_MS`, `LESSON_SCHEMA_VERSION`,
`TTS_MODEL`, `TTS_MAX_CONCURRENCY`, `TTS_CHAR_CAP`, `NARRATION_SYNC_TOLERANCE_MS`,
`NARRATION_DAILY_BUDGET_CHARS`, `DEFAULT_PERSONA_ID`, `VOICE_SAMPLE_MIN_MS`,
`VOICE_SAMPLE_MAX_MS`, `CUSTOM_VOICES_PER_ACCOUNT`, `VOICE_CREATE_ATTEMPTS_PER_DAY`,
`VOICE_CONSENT_WORDING_VERSION`, `REVIEW_INTERVALS_DAYS`, `REVIEW_SET_SIZE`,
`SUMMARISE_AFTER_ATTEMPTS`, `SUMMARISE_MIN_INTERVAL_HOURS`,
`SUMMARISE_DAILY_BUDGET`, `ARCHIVED_SUMMARY_VERSIONS`,
`ACTIVITY_SESSION_IDLE_MINUTES`, `ACTIVITY_SESSION_CAP_MINUTES`.

### 7.2 `RETENTION_POLICY` — the rows M0 is missing

**Every one of these is an M0 edit** (one number, one home), and **the first four
block M2**. Adding a windowed row without a matching job step fails the existing
bijection test, which is the desired behaviour.

| New key | Window | Anchor | Job step needed | Blocks |
|---|---|---|---|---|
| `PRACTICE_CONTENT` | life of the `ACTIVE` profile | — | no | **M2** |
| `ATTEMPT_HISTORY` | life of the `ACTIVE` profile | — | no | **M2** |
| `MASTERY_RECORD` | life of the `ACTIVE` profile | — | no | **M2** |
| `CHAT_TRANSCRIPT` | `CHAT_TRANSCRIPT_RETENTION_DAYS` (**180, assumption**) | `ChatSession.openedAt` | **yes** | **M3** |
| `LESSON_SCRIPT` | life of the source problem | — | no | M4 |
| `PLAYBACK_EVENT` | `PLAYBACK_EVENT_RETENTION_DAYS` (**30, assumption**) | `startedAt` | **yes** | M4 |
| `NARRATION_AUDIO` | life of the source lesson | — | no (deleted with the lesson) | M5 |
| `VOICE_SAMPLE` | `VOICE_SAMPLE_RETENTION_DAYS` (**7, assumption**) | `CustomVoice.createdAt` | **yes** | M6 |
| `VOICE_CONSENT_RECORDING` | `VOICE_CONSENT_RETENTION_DAYS` (**needs counsel**) | `createdAt` | **yes** | M6 |
| `LEARNER_PROFILE_CURRENT` | life of the `ACTIVE` profile | — | no | M7 |
| `LEARNER_PROFILE_ARCHIVE` | `ARCHIVED_SUMMARY_VERSIONS` most recent | `summarisedAt` | **yes** | M7 |
| `ACTIVITY_SESSION` | `ACTIVITY_RETENTION_DAYS` (**90, assumption**) | `lastActivityAt` | **yes** | M7 |

Two of these deserve a second look rather than a default:

- **`CHAT_TRANSCRIPT` is deliberately windowed rather than "life of the profile".**
  M3's spec argues transcripts are a weaker fit for that reasoning than extracted
  text, because M7 needs the *summary*, not every message from March. 180 days is
  a guess and it should be the owner's.
- **`PLAYBACK_EVENT` gets the shortest window in the table.** M4's spec says an
  engagement log about a child accruing indefinitely with no business need beyond
  product analytics is exactly what §312.10 is aimed at, and says to default to
  collecting less. ADR-0014's follow-up asks whether the table should exist.

---

## 8. Dependencies

**M2, M3, M4 and M7 add no dependencies.** Everything they need —
`@anthropic-ai/sdk`, `zod`, `katex`, `server-only` — is already approved.

| Package | Purpose | ADR | Needed for | Notes / risk |
|---|---|---|---|---|
| `@elevenlabs/elevenlabs-js@^2` | TTS with character-level timestamps and instant voice cloning | pending (M5) | **M5, M6** | **BLOCKING for M5.** The unscoped `elevenlabs` package is deprecated. Version is unconfirmed — run `pnpm view` before installing. Confined to `lib/tts/elevenlabs.ts` behind a `TtsPort`, so a Cartesia swap is one file |

**Explicitly considered and not proposed:**

- **`ai` + `@ai-sdk/anthropic` (the Vercel AI SDK).** Would shrink M3's UI
  substantially and is the right tool for chat in general. Rejected in ADR-0013
  because it sits between us and the three things M3 is strict about —
  `cache_read_input_tokens`, the exact `stop_reason`, and abort-time partial
  persistence with our own idempotency key. **Named as the most likely future
  approval** if a second streaming surface appears.
- **A computer-algebra library (`mathjs`, `nerdamer`).** Rejected in ADR-0011: its
  failure mode is a confident false negative — a right answer marked wrong,
  buried in a third-party library. Named as the revisit trigger if measured
  `UNSCORED` rates on expression answers are high.
- **A CASE client.** Rejected in ADR-0009: a network call and a new vendor for a
  lookup table.
- **A job queue.** Not needed for M2 or M3 (`after()` and streaming). **May become
  necessary for M4** depending on §9.1's answer, and that would be a substantial
  new dependency, a new approval, and a new operational surface.
- **A rate-limit service or Redis.** All four new caps are Postgres counts, like
  M1's.

Not a dependency: the bundled Common Core JSON is checked-in data, not a package.
But **its licence must be read** (ADR-0009 follow-up).

---

## 9. What must be measured

### 9.0 The one that gates everything — run it inside M2

**Extraction accuracy on a real worksheet corpus.** ~50 real worksheets: varied
handwriting, phone photos at real angles, math and non-math, at least one page
per grade band we claim to serve. Hand-label the expected problems. Score
problem-level precision and recall, plus a per-problem "text is materially
correct" judgement.

M2's spec calls this *"non-blocking for building M2; blocking for believing its
output."* M7's calls it *"blocking for the claim."* **It should run during M2, not
before M7** — it is roughly a day of work, it is the cheapest risk reduction in
the whole plan, and every milestone after it inherits the number. See §10.

### 9.1 Before M3's constants are fixed (not before M3 is built)

One script on a **deployed preview function**, not localhost. Five tutoring turns
across three fixture problems. Record: time to first delta, total wall clock, output
tokens, and `cache_read_input_tokens` on turns 2–5.

Sets `CHAT_FIRST_TOKEN_BUDGET_MS`, `CHAT_IDLE_TIMEOUT_MS`,
`CHAT_MAX_OUTPUT_TOKENS`. **If a turn does not fit inside `maxDuration`,** the
transport falls back to the polled background job named in ADR-0013's
alternatives — the message rows and the session machine are already shaped for it,
so the change is confined to `lib/chat/stream.ts` and the composer.

### 9.2 Before M4's contract can be written — five measurements

M4's contract must not be written until these return. Each is pass/fail with a
stated threshold, in the manner of the M0/M1 plan's storage spike.

| # | Measurement | Decides | If it fails |
|---|---|---|---|
| **M4-1** | **Authoring latency.** `messages.parse()` with the ADR-0014 schema over 20 fixture problems, at `high` and at `xhigh`, five runs each, on a deployed preview function. Record p50/p95 wall clock and output tokens | Whether authoring runs in-request with `after()` or needs a queue. **The research names this the single biggest unvalidated assumption in the whole plan** | p95 above the duration limit → lower the effort first; if that is not enough, **a job queue enters M4** — a new dependency, a new approval and a new operational surface. AC 6's status machine is already specified so the *spec* does not change |
| **M4-2** | **Renderer target.** Prototype one fixture lesson twice: inline SVG with `foreignObject` for KaTeX, and canvas 2D with an absolutely-positioned DOM math layer. Check determinism, `prefers-reduced-motion`, and the static text view | **Canvas 2D cannot draw KaTeX output** — KaTeX emits HTML and CSS, and AC 14 requires real mathematics. This is a genuine gap in the spec's "canvas" framing | Whichever survives becomes a new ADR. May need a dependency. ADR-0014 keeps the stored document renderer-agnostic so the choice stays reversible |
| **M4-3** | **Placement legibility.** Render 20 fixture scripts at 375 px and 1280 px. Count elements outside the canvas bounds and pairs of overlapping bounding boxes | AC 13, and whether a deterministic layout pass is required scope | **Threshold: if more than 5% of scripts have any out-of-bounds element or illegible overlap, a layout pass is required** — real work nobody has scoped, and it must be counted before M4 is committed to |
| **M4-4** | **Vocabulary sufficiency.** Author 20 lessons against the eight primitives in ADR-0014 §2. Count schema rejections, and have a human judge how often the explanation needed something the set does not have | AC 3's closed set. **It must be frozen before authoring prompts are written, because widening it later invalidates every stored script** | Bump `LESSON_SCHEMA_VERSION` and widen — **cheap now, expensive after a single lesson has shipped** |
| **M4-5** | **Answer correctness.** For the same 20, compare the final expression written on the canvas against the known answer key | AC 17. *"A lesson that teaches the method to a wrong conclusion is worse than no lesson"* | Below 100% → an authoring-time verification pass (compare the final `write` op against the key, reject and regenerate) becomes part of the contract |

### 9.3 Before M5 and M6 — vendor behaviour, all unmeasured

| # | Measurement | Blocks |
|---|---|---|
| **M5-1** | Does `/with-timestamps` work with the model we intend to use? The research could **not** confirm it for the fast model and calls it a one-request experiment that constrains the architecture | The model choice, and whether any future low-latency synced surface is possible at all |
| **M5-2** | `GET /v2/voices?voice_type=default` on a **real, newly created** account. The legacy default voices expire 2026-12-31 and may not be available to accounts created after March 2026 | AC 1's persona list cannot be populated from anything until this returns |
| **M6-1** | **Is an API-created instant-cloned voice immediately usable, or blocked pending a human captcha in the vendor's dashboard?** The research calls this *"the highest-risk unknown in this document"* | If a human step is required, **the parent-facing flow as designed does not work and M6 needs rethinking.** AC 13 makes the pending case survivable rather than assuming it away |
| **M6-2** | Instant-cloning slots per plan tier | If the cap is low and account-wide, it is a hard ceiling on how many families can ever use the feature. **Verify before promising it to anyone** |

### 9.4 Before M7's report is shown to a paying parent

§9.0's number, plus: the measured share of mastery levels that rest on
model-graded rather than normaliser-graded attempts (`modelGradedShare`, already a
column). See §10.

---

## 10. The judgement the owner asked for: is the stack sound?

The specs flag that M2's grading sits on unmeasured M1 extraction, and that M7's
parent report sits on top of both. Plainly:

**The stack is sound as engineering and unsound as a claim.**

Building M2 and M3 on M1 is fine. A misread problem produces a bad practice set;
the student sees six problems that do not look like their homework, or a hint
that makes no sense, and the blast radius is one session. The error is *visible to
the person experiencing it* and it is *recoverable* — M1's correction affordance
exists, the `CONFIRMED` gate exists, and a child who says "this isn't my problem"
has somewhere to go. That is an acceptable place to be while we measure.

**M7's parent report is different in kind, not in degree.** It converts three
layers of unmeasured inference into a durable, authoritative-looking narrative
judgement of a child, shown to the person paying, who has no way to audit it. Two
things compound at once: the error accumulates *and* the audience loses the
ability to detect it. A child can tell when a practice problem is nonsense. A
parent cannot tell that "struggles with unlike denominators" is an artefact of a
6 misread as a 5 three weeks ago. And a parent will act on it — that is the whole
point of the report — by pushing a child on a difficulty they may not have.

M7's own open question says this and says it well: *"A confident parent report
built on a stack of unvalidated inference is worse than no report, because it will
be believed."* I agree with that sentence and I do not think the plan currently
honours it, so four things should change.

**1. Move the extraction-accuracy measurement into M2, not M7 (§9.0).** It is a
day of work. Every milestone after it inherits the number, and it converts a
question we are carrying through five milestones into an answer we carry through
five milestones. There is no reason to defer it and one very good reason not to:
by M7 the schema, the prompts and the copy will all have been built on an
assumption, and finding out then is finding out too late to be cheap.

**2. Make provenance a first-class field, not a footnote.** Already in this plan
and worth naming as a deliberate response to this question:
`SkillMastery.modelGradedCount` (§1.1) and `LearnerProfile.modelGradedShare`
(§1.6) let the report state how much of what it says rests on a machine's opinion
that nobody checked. A column that records provenance and is never surfaced is
worse than nothing, because it creates the appearance of rigour — so it must
reach the parent surface.

**3. Put an evidence floor under everything the parent sees.**
`MASTERY_MIN_ATTEMPTS_FOR_REPORT` (§7.1): a skill does not appear in the report's
"getting better" list, and does not display above `BEGINNING` to anyone, until it
has enough attempts and **at least one graded by the deterministic normaliser
rather than the model**. A conclusion drawn from two model-graded attempts on a
possibly-misread problem is not evidence, and the report should not carry it.

**4. Change the report's voice: lead with facts, label the inference.** M7 AC 15
asks for four things — skills practised, skills reaching each level, time on task,
what the app is focusing on next. **All four are countable facts**, and AC 16
already demands that each count equal the count of the underlying rows. AC 19's
plain-language summary is the only *inference* in the milestone, and it is the
part most likely to be wrong and most likely to be believed.

So: lead with the counts, derived from `Attempt` rows (never from
`SkillMastery.attemptCount` — ADR-0010 §6). Present the narrative summary
**below** them, explicitly as what the app currently believes, next to AC 19's
"tell us if this is wrong" control, and never as the headline. That is not
hedging; it is the difference between a report that is honest about its own
epistemics and one that launders a model's guess into a parent's belief about
their child.

**One thing I am not recommending:** cutting M7. The adaptive loop is the
product's actual claim and the review scheduling in particular rests on the
solid part of the stack — `Attempt` rows are facts about what a child typed, not
inferences. It is the *narrative judgement* that needs the floor, not the loop.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| **M0's `RETENTION_POLICY` has no row for anything M2–M7 creates**, and each spec correctly declined to state one | §7.2. Four rows block M2, one blocks M3. The existing bijection test fails until each windowed row has a job step, which is the desired behaviour |
| **The §312.4 direct notice does not cover chat content, a second AI vendor, or M7's summarisation** — all three are new descriptions of what a third party receives | Three separate M0 edits with `DIRECT_NOTICE_VERSION` bumps, each before its milestone ships. Existing consent rows keep the version they were served (ADR-0007) |
| **A wrong-but-valid skill code silently splits or merges a mastery record** and nothing detects it | ADR-0009's slate makes an invalid code impossible and a wrong one undetectable. Named in §6.3. Only a human reading a fixture set catches it |
| **The prompt cache fails silently and costs ten times more**, with the product working perfectly | ADR-0012's snapshot makes the prefix a stored string. `contextHash` equality is asserted in CI; `cacheReadTokens` is persisted per message from day one. **CI cannot prove the provider cached it** |
| **An answer key reaches the browser through the RSC flight payload**, which no JSON-level DTO rule sees | ADR-0011 §5: a separate `PracticeAnswerKey` table. The dangerous query cannot return it. Plus a test that serialises the whole page payload and greps for the key |
| **A `UNSCORED` epidemic is invisible.** The grader fails and children quietly get no feedback | Logged per skill from the first deploy. It is the only signal, and it is a production metric, not a test |
| **AC 21's distress path has false negatives**, and a false negative is a child in distress being tutored about fractions | A fixed, non-model message; the check runs before the AI call. The copy is written by someone who is not an engineer. **The owner must decide whether the account holder is notified — M3 calls this blocking for real users** |
| **A partial assistant reply is persisted and a parent reads it** as the tutor's considered answer | ADR-0013 §4's choice, made explicitly. The transcript must visually mark `partial`, not render it plainly |
| **Chat streaming may not fit inside `maxDuration`** | §9.1 measures it. The polled fallback is named in ADR-0013 and the schema already supports it |
| **Lesson authoring may not fit inside a function invocation**, which would drag a job queue into M4 | §9.2 M4-1. AC 6's status machine is specified so the answer changes the implementation, not the spec — but the queue is real scope and must be counted before M4 is committed |
| **Canvas 2D cannot render KaTeX**, and AC 14 requires real mathematics on the whiteboard | §9.2 M4-2. ADR-0014 keeps the stored document renderer-agnostic so this stays reversible |
| **Widening the drawing vocabulary invalidates every stored script** | `LessonScriptVersion.schemaVersion` + a player that refuses an unknown one. Cheap before the first lesson ships, expensive after — hence M4-4 |
| **A vendor-side human captcha would break M6's parent flow entirely** | §9.3 M6-1. The research calls it the highest-risk unknown in the integration. AC 13 makes the pending case survivable rather than assuming it away |
| **A narration audio object whose row was never written is invisible to every deletion path** | ADR-0015: per-profile scoping puts every object under `students/<profileId>/`, and the reconciler's prefix must be extended. M5's own open question marks this blocking |
| **A future model with a blob and no entry in the deletion registry orphans a child's data** | ADR-0015 §"registry": `PROFILE_BLOB_SOURCES` plus a test asserting every model with a `pathname` column appears in it. Fails CI rather than producing an orphan |
| **`SkillMastery.attemptCount` outlives the attempts it counted** after an extraction is deleted | ADR-0010 §6, and a DTO rule: the report derives counts from `Attempt`, always |
| **`MASTERY_LADDER` at 5-consecutive with a 6-problem set means one set can carry a skill from nothing to `SECURE`** | Almost certainly too fast. Re-set from the first fixture run, not shipped at the assumption |
| **Cost.** Six generated problems (~$0.09), a grading call on every ambiguous answer, and a cached chat turn (~$0.03) per turn, times 20 turns | Hourly caps on sets, messages and sessions; `effort: 'low'` on grading; the cached prefix. **None of it is metered per account and there is no budget alarm** — that is a product decision, not a design one |
| **Everything in §6.3.** The suite proves the machine does what the spec says; it cannot prove the product teaches | Stated, not implied. §10 |

---

## 12. Needs approval before any code is written

**Dependencies:** `@elevenlabs/elevenlabs-js` — **M5 only, and not until §9.3's two
measurements return.** M2, M3, M4 and M7 add nothing. Explicitly recommended
*against* for now: the Vercel AI SDK (ADR-0013) and a computer-algebra library
(ADR-0011), each with a named revisit trigger.

**Migrations:** `0002` … `0007`, one per milestone, **all creation-only, none
destructive**. Two contain a hand-added `CHECK` constraint written into the
generated SQL before it is applied; one appends a `ConsentScope` enum value. No
applied migration is edited.

**Scope decisions the owner must make, in rough order of urgency:**

1. **PRODUCT, blocking M2.** The retention rows in §7.2 — four of them block M2,
   one blocks M3. `CHAT_TRANSCRIPT_RETENTION_DAYS` in particular is a real
   decision, not a default.
2. **PRODUCT, blocking M2 being believed.** Approve §9.0 — measuring extraction
   accuracy inside M2 rather than before M7. §10.
3. **PRODUCT, blocking M3 for real users.** AC 21: is the account holder notified
   on a distress signal? M3's spec does not decide it and says it must be decided
   before real users. And who writes the fixed message.
4. **PRODUCT, blocking M7's report design.** ADR-0010's follow-up: does the parent
   see a decay-aware view while the child sees a stable level? M7 calls this the
   central design question of the milestone.
5. **LEGAL, before descriptors reach a parent.** The Common Core licence and its
   attribution requirement (ADR-0009).
6. **LEGAL, before M6.** How long may the recorded consent statement be kept? It
   is evidence of authorisation *and* a recording of an adult's voice, and it
   needs its own retention row with its own stated business need.
7. **INFRASTRUCTURE, before M4 is committed.** The Vercel plan sets the function
   duration ceiling, which is what §9.2's M4-1 is measured against — and therefore
   whether M4 needs a job queue.
8. **PRODUCT.** Every value marked **assumption** in §7.1. Most are harmless;
   `MASTERY_LADDER`, `ATTEMPTS_BEFORE_REVEAL` and the three hourly caps are the
   ones a child will actually feel.

**One thing this plan does not do and cannot:** tell you whether any of it
teaches anything. Every criterion in §6.1 and §6.2 can pass while the product
fails at its purpose, and §6.3 says which ones. The measurements in §9 close some
of that gap. Nothing closes all of it except watching a real child use it.
