# Implementation plan: M0 (accounts, profiles, consent, storage) + M1 (upload and extract)

- **Status:** Proposed — awaiting owner approval. No code has been written.
- **Date:** 2026-08-26
- **Revised:** 2026-08-26 — rewritten against the revised M0 spec (36 → 52 AC).
  See §0.1 for what moved.
- **Author:** architect agent
- **Specs:** [m0-accounts-and-profiles.md](../specs/m0-accounts-and-profiles.md) (52 AC),
  [m1-upload-and-extract.md](../specs/m1-upload-and-extract.md) (36 AC)
- **ADRs:** [0002](../adr/0002-passwordless-auth-with-authjs-and-database-sessions.md) auth ·
  [0003](../adr/0003-private-vercel-blob-with-client-direct-upload.md) storage ·
  [0004](../adr/0004-client-side-heic-conversion-with-lazy-loaded-heic-to.md) HEIC ·
  [0005](../adr/0005-extracted-problem-model-and-structured-output-contract.md) extraction ·
  [0006](../adr/0006-route-handlers-for-mutations-not-server-actions.md) API surface ·
  [0007](../adr/0007-deletion-order-append-only-consent-and-store-enumerating-reconciliation.md) deletion ·
  [0008](../adr/0008-swappable-verifiable-parental-consent-method.md) consent method

---

## 0. Read this first

Four things gate everything below.

1. **The spike in §9 must run before any of M0 AC 34–43 or any of M1 is built.**
   Every Vercel Blob signature in the research is documentation-derived. Both
   specs mark this BLOCKING. **Nothing in the spike changed in this revision.**
2. **Seven new dependencies need the owner's approval (§8).** Nothing is
   installed and nothing will be installed until then.
3. **The consent method is not decided and cannot be, by us (ADR-0008).** M0 is
   built against the `ConsentMethodProvider` interface with `EMAIL_PLUS` as the
   first implementation. If the owner picks `PAYMENT_CARD`, **billing enters M0**
   and the spec's non-goal is void — that is a scope decision to make before the
   engineers start, not after.
4. **Two documents are acceptance criteria** (AC 51, AC 52).
   `docs/security-program.md` does not exist and has no named owner. It is not
   code and no engineer will produce it by accident.

The whole design rests on two rules:

- **A student profile id in a URL is not authorization.** Every query touching
  student data resolves through `requireStudentProfile(id)`, which is
  `db.studentProfile.findFirst({ where: { id, userId: session.user.id } })`.
  There is no other way to load a profile in server code.
- **Nothing about a child is collected before consent is verified.** The
  schema expresses this as nullable columns, the API expresses it as a 403 at
  step 4 of `withAuth()` (ADR-0006), and the UI expresses it as a four-step
  flow. All three must agree or the criterion is met by luck.

### 0.1 What this revision changed

| Area | Before | Now |
|---|---|---|
| Flow | one form → profile + consent | age gate → direct notice → consent → profile detail |
| Statuses | `CONSENT_REQUIRED`, `ACTIVE` | `NOTICE_PENDING`, `CONSENT_PENDING`, `ACTIVE`, `CONSENT_WITHDRAWN` |
| Consent record | name, relationship, scopes, text version | + `method`, `methodEvidence`, `verifiedAt`, `noticeVersion`, `supersedesConsentId` |
| Consent method | an in-app attestation | a swappable provider behind an interface (ADR-0008) |
| Notice | part of the consent page | its own `DirectNotice` model, versioned, emailed, and a hard precondition |
| Pre-consent data | kept forever | purged at `PRE_CONSENT_PURGE_DAYS` (14) |
| Deletion | one path, 30-day grace | three paths: closure (30d), §312.6 (immediate), profile delete (immediate) |
| Retention | two flat numbers | a tiered `RETENTION_POLICY` table that also renders the public page |
| Source files | 365 days from upload | 14 days from **successful extraction** |
| Endpoints | 20 | 28 |

**Unchanged and deliberately not re-litigated:** the storage design and its
spike (§9), the HEIC pipeline, the extraction contract, the error shape, the
route-handler decision, blob-first deletion, the store-enumerating reconciler.

---

## 1. Prisma schema

Complete proposed contents of `prisma/schema.prisma` for M0 + M1. The generator
and datasource blocks are unchanged from what is in the repo today.

```prisma
generator client {
  provider = "prisma-client"
  output   = "../lib/generated/prisma"
}

datasource db {
  provider = "postgresql"
}

// ───────────────────────────── enums ─────────────────────────────

enum GradeLevel {
  KINDERGARTEN
  GRADE_1
  GRADE_2
  GRADE_3
  GRADE_4
  GRADE_5
  GRADE_6
  GRADE_7
  GRADE_8
  GRADE_9
  GRADE_10
  GRADE_11
  GRADE_12
  ADULT_LEARNER
}

/// Coarse age band only. A precise date of birth is never collected (M0 "Never stored").
/// This is the ONLY learner data collected before consent (AC 8, AC 9).
enum AgeBand {
  UNDER_13
  AGE_13_17
  ADULT
}

enum Subject {
  MATH
  SCIENCE
  ENGLISH_LANGUAGE_ARTS
  READING
  WRITING
  HISTORY
  SOCIAL_STUDIES
  FOREIGN_LANGUAGE
  COMPUTER_SCIENCE
  OTHER
}

/// Per the spec's acceptance-criteria preamble:
/// NOTICE_PENDING → CONSENT_PENDING → ACTIVE, plus CONSENT_WITHDRAWN.
/// CONSENT_REQUIRED from the previous draft is gone: it conflated "no notice yet"
/// with "notice given, consent not verified", which now have different consequences.
enum StudentProfileStatus {
  NOTICE_PENDING
  CONSENT_PENDING
  ACTIVE
  CONSENT_WITHDRAWN
}

enum ConsentRelationship {
  PARENT
  LEGAL_GUARDIAN
  OTHER_CAREGIVER
  SELF
}

/// Append a value here for M6 voice cloning. Never rewrite existing rows. (ADR-0007)
enum ConsentScope {
  DATA_PROCESSING
}

/// Method shapes enumerated in 16 CFR §312.5(b)(2). The subsection LETTERING is
/// deliberately NOT encoded — the research inferred it and never read the list.
/// Confirm these labels against eCFR before any of them reaches parent-facing copy.
/// Append-only: removing a value is a destructive migration against legal evidence.
/// See ADR-0008.
enum ConsentMethod {
  SIGNED_FORM
  PAYMENT_CARD
  TOLL_FREE_PHONE
  VIDEO_CONFERENCE
  GOV_ID_CHECK
  KBA
  FMVPI
  EMAIL_PLUS
  TEXT_PLUS
}

/// Which deletion happened. The distinction IS the evidence (ADR-0007 §4).
enum DeletionKind {
  ACCOUNT_CLOSURE            // AC 47 — 30-day recovery window
  PARENTAL_DELETION_REQUEST  // AC 48 — §312.6, no recovery window, never queued
  PROFILE_DELETED            // AC 31, AC 46
  PRE_CONSENT_PURGE          // AC 22
  RETENTION_EXPIRY           // AC 45
}

enum UploadStatus {
  PENDING         // token issued, bytes may exist, not yet confirmed
  STORED          // confirmed; head() verified the object
  FAILED          // orphan threshold passed with no confirmation, or client reported failure
  SOURCE_DELETED  // bytes removed by retention or by the user; problem text retained
}

enum ExtractionStatus {
  PENDING
  RUNNING
  COMPLETE
  COMPLETE_EMPTY
  FAILED
  CONFIRMED
}

// ─────────────────── auth (Auth.js v5, ADR-0002) ───────────────────

model User {
  id                   String    @id @default(cuid())
  email                String    @unique
  emailVerified        DateTime?
  name                 String?
  image                String?

  /// AC 6: stamped from the AdultAttestation that produced the first sign-in link.
  /// An account-holder age gate. NOT consent. (ADR-0002, ADR-0008)
  adultAttestedAt      DateTime?

  /// AC 47: account CLOSURE only. Sign-in is refused while this is set and the
  /// recovery window is live. A §312.6 deletion request NEVER sets this. (ADR-0007 §4)
  closureRequestedAt   DateTime?

  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  accounts        Account[]
  sessions        Session[]
  studentProfiles StudentProfile[]
  consentsGiven   ParentalConsent[]
  noticesReceived DirectNotice[]

  @@index([closureRequestedAt])
}

/// Required by @auth/prisma-adapter. Unused in M0 — no OAuth provider is configured.
model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
  @@index([userId])
}

/// AC 5 / AC 47: sessions are rows, so sign-out and closure revoke server-side.
model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

/// AC 4: Auth.js deletes the row on redemption (single use); maxAge 15 min sets expiry.
/// NOTHING in the consent flow may reuse this table (ADR-0002 revision note).
model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}

/// AC 6: written by signInWithEmail BEFORE a link is dispatched. Without one, no email
/// is sent, so no token exists, so no User row can be created.
model AdultAttestation {
  id         String   @id @default(cuid())
  email      String
  attestedAt DateTime @default(now())
  expiresAt  DateTime
  ipAddress  String?
  userAgent  String?

  @@index([email, expiresAt])
}

// ──────────────────────── student profiles ────────────────────────

model StudentProfile {
  id          String               @id @default(cuid())
  userId      String

  /// AC 9: with userId, status and createdAt, the ONLY thing a pending record holds.
  ageBand     AgeBand

  status      StudentProfileStatus @default(NOTICE_PENDING)

  /// AC 9 / AC 25: NULL until the profile is ACTIVE and the owner fills the detail
  /// step. Nullability is the schema-level expression of "collected only after
  /// consent is verified" — it is not a convenience.
  displayName String?
  gradeLevel  GradeLevel?
  subjects    Subject[]            // empty until ACTIVE; 1–8 enforced by zod (AC 28)
  avatarId    String?              // preset id from AVATAR_IDS; never an uploaded image (AC 29)

  /// Stamped once, when status first becomes ACTIVE. Used by nothing security-critical;
  /// exists so "time to consent" is answerable without reading the consent table.
  activatedAt DateTime?

  createdAt   DateTime             @default(now())
  updatedAt   DateTime             @updatedAt

  user     User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  notices  DirectNotice[]
  consents ParentalConsent[]
  uploads  Upload[]
  grants   UploadTokenGrant[]

  @@index([userId, createdAt])
  /// The pre-consent purge job's query (AC 22). Without it that job seq-scans.
  @@index([status, createdAt])
}

/// AC 12–15. The §312.4 direct notice actually served to this account owner for this
/// student. A consent record cannot exist without one (AC 15), which is why this is a
/// table and not a boolean.
model DirectNotice {
  id               String    @id @default(cuid())
  studentProfileId String
  userId           String

  /// AC 14: changing the notice text means a NEW version identifier. Existing rows
  /// keep the version actually served to them; the copy is resolved from this string,
  /// never from "whatever is deployed now".
  noticeVersion    String

  /// When the screen was presented and acknowledged.
  presentedAt      DateTime  @default(now())
  /// AC 14: when the same content was emailed. NULL until the provider accepts it.
  /// See §10 for the deliberate reading of AC 14 this represents.
  sentAt           DateTime?
  emailDeliveryRef String?

  ipAddress        String?
  userAgent        String?

  studentProfile StudentProfile    @relation(fields: [studentProfileId], references: [id], onDelete: Cascade)
  user           User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  consents       ParentalConsent[]

  @@index([studentProfileId, presentedAt])
  @@index([sentAt])   // the notice-email retry job
}

/// APPEND-ONLY, with exactly one permitted mutation: the one-time verifiedAt stamp
/// (ADR-0007 §3). Never deleted while the account lives. Withdrawal appends a new row;
/// the prior row is byte-identical afterwards (AC 24).
model ParentalConsent {
  id                  String              @id @default(cuid())
  studentProfileId    String
  /// The signed-in adult who performed the action, kept for auditability.
  userId              String

  /// AC 15 / AC 17: the notice this consent was given against. Restrict, not Cascade —
  /// a notice may not vanish out from under a live consent record.
  directNoticeId      String
  /// Denormalised so the version survives the notice row's own retention (AC 17).
  noticeVersion       String

  consentingAdultName String
  relationship        ConsentRelationship
  scopes              ConsentScope[]
  consentTextVersion  String              // e.g. "2026-08-26.1" — new wording, new version

  /// AC 16/17: recorded on the row, NEVER inferred from configuration at read time.
  /// This is what lets the deployed method change without invalidating history.
  method              ConsentMethod
  /// AC 17: a method-specific REFERENCE — processor transaction id, vendor
  /// verification id, signed-form pathname, consumed-challenge id. Never a live
  /// credential (ADR-0008 §4).
  methodEvidence      String?

  submittedAt         DateTime            @default(now())
  /// AC 18/19: NULL until the corroborating step completes. The profile is ACTIVE
  /// only when this is set. Stamped by a conditional UPDATE ... WHERE verified_at IS NULL.
  verifiedAt          DateTime?
  /// AC 24: set only on an appended withdrawal row.
  withdrawnAt         DateTime?
  supersedesConsentId String?

  ipAddress           String?             // read server-side from headers, never from the body
  userAgent           String?

  studentProfile StudentProfile @relation(fields: [studentProfileId], references: [id], onDelete: Cascade)
  user           User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  directNotice   DirectNotice   @relation(fields: [directNoticeId], references: [id], onDelete: Restrict)
  challenge      ConsentVerificationChallenge?

  @@index([studentProfileId, submittedAt])
  @@index([verifiedAt])
}

/// The pending corroborating step. Holds a HASH of the token, never the token —
/// for EMAIL_PLUS that token IS parental consent (ADR-0008 §4).
model ConsentVerificationChallenge {
  id                String        @id @default(cuid())
  parentalConsentId String        @unique
  method            ConsentMethod
  /// SHA-256 of the token that was emailed or texted.
  tokenHash         String        @unique
  expiresAt         DateTime
  consumedAt        DateTime?
  attemptCount      Int           @default(0)
  createdAt         DateTime      @default(now())

  parentalConsent ParentalConsent @relation(fields: [parentalConsentId], references: [id], onDelete: Cascade)

  @@index([expiresAt])
}

// ─────────────────────── uploads and extraction ───────────────────────

/// Exists so the TOKEN endpoint can be rate limited (M1 AC 17). Counting Upload rows
/// would only count uploads that were confirmed. Pruned after 24h by the reconciler.
model UploadTokenGrant {
  id                String   @id @default(cuid())
  studentProfileId  String
  requestedPathname String
  createdAt         DateTime @default(now())

  studentProfile StudentProfile @relation(fields: [studentProfileId], references: [id], onDelete: Cascade)

  @@index([studentProfileId, createdAt])
}

model Upload {
  id               String       @id @default(cuid())
  studentProfileId String
  /// Storage PATHNAME, never a fully-qualified URL (AC 39). Unique → confirm is idempotent.
  pathname         String       @unique
  /// contentType and sizeBytes come from storage.head(), never from the client.
  contentType      String
  sizeBytes        Int
  originalFilename String
  pageCount        Int?         // PDFs only; null for images
  status           UploadStatus @default(PENDING)

  /// RETENTION ANCHOR. Stamped when this upload's extraction reaches COMPLETE,
  /// COMPLETE_EMPTY or CONFIRMED. The source-file window is measured from HERE, not
  /// from createdAt: the spec's table says "14 days after successful extraction".
  extractedAt      DateTime?
  sourceDeletedAt  DateTime?

  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt

  studentProfile StudentProfile @relation(fields: [studentProfileId], references: [id], onDelete: Cascade)
  extraction     Extraction?

  @@index([studentProfileId, createdAt])
  @@index([status, createdAt])
  /// The retention sweep's query (AC 45, M1 AC 36).
  @@index([status, extractedAt])
}

model Extraction {
  id           String           @id @default(cuid())
  uploadId     String           @unique
  status       ExtractionStatus @default(PENDING)
  model        String           // "claude-opus-5"
  attemptCount Int              @default(0)
  startedAt    DateTime?
  completedAt  DateTime?
  /// Internal code (REFUSED | PARSE_FAILED | TIMEOUT | UPSTREAM | INTERNAL). Mapped to a
  /// fixed user-facing string at the API layer; never returned verbatim (M1 AC 24).
  failureCode  String?
  inputTokens  Int?
  outputTokens Int?
  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt

  upload   Upload             @relation(fields: [uploadId], references: [id], onDelete: Cascade)
  problems ExtractedProblem[]

  @@index([status, startedAt])
}

model ExtractedProblem {
  id                String   @id @default(cuid())
  extractionId      String
  /// Position on the page as reported by the model. NEVER renumbered after a delete —
  /// that is what "stable, non-colliding" means in M1 AC 29.
  ordinal           Int
  label             String?  // "4", "4a", "Question 3"
  /// Problem text. Mathematics is LaTeX delimited $…$ / $$…$$ (M1 AC 21, ADR-0005).
  text              String
  containsMath      Boolean  @default(false)
  subject           Subject?
  problemType       String?  // free text; the skill taxonomy is M2's job
  /// M1 AC 22: the student's handwritten answer, structurally separate. Nothing reads it in M1.
  studentAnswerText String?
  confidence        Float
  studentCorrected  Boolean  @default(false)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  extraction Extraction @relation(fields: [extractionId], references: [id], onDelete: Cascade)

  @@unique([extractionId, ordinal])
  @@index([extractionId])
}

// ──────────────────────────── audit ────────────────────────────

/// AC 47/48: must SURVIVE the purge, so there is deliberately no relation to User or
/// StudentProfile and deliberately no email, no name, nothing about the child.
/// `kind` is the only evidence that a §312.6 request was honoured promptly. (ADR-0007 §4)
model DeletionAudit {
  id          String       @id @default(cuid())
  kind        DeletionKind
  /// Opaque userId or studentProfileId. Not a foreign key, on purpose.
  subjectRef  String
  requestedAt DateTime     @default(now())
  completedAt DateTime?

  @@index([subjectRef])
  @@index([kind, completedAt])
}

/// AC 50: what survives a deletion in place of the consent record. No foreign keys,
/// no studentProfileId, no name, no relationship, no IP, no user agent.
/// ASSUMPTION pending counsel — CONSENT_AUDIT_RETENTION_DAYS = 0 degrades this to
/// "purged with everything else" with no schema change. (ADR-0007 §6)
model ConsentAuditArtifact {
  id                 String        @id @default(cuid())
  consentTextVersion String
  noticeVersion      String
  method             ConsentMethod
  submittedAt        DateTime
  verifiedAt         DateTime?
  withdrawnAt        DateTime?
  /// HMAC-SHA256(account identifier, AUDIT_PSEUDONYM_KEY). Not the email. Not reversible.
  adultIdentityHash  String
  deletedAt          DateTime      @default(now())
  purgeAfter         DateTime

  @@index([purgeAfter])
}
```

### Non-obvious modelling choices, explained

| Choice | Why |
|---|---|
| `displayName`, `gradeLevel`, `avatarId` **nullable**; `subjects` empty | AC 9 requires the pending record's profile fields to be "all empty in the database". Nullability is the enforcement, not a convenience. **Consequence the frontend must handle: an `ACTIVE` profile can still have a null display name** until the detail step is completed (AC 25 collects them *after* activation). |
| `AgeBand` is the only pre-consent learner field | AC 8/9. `ADULT` → AC 10's immediate `ACTIVE`. No grade level at the gate — grade implies age and the previous draft derived the branch from it. |
| `DirectNotice` as a table, not a boolean | AC 15 makes "no notice ⇒ no consent" a hard precondition, and AC 14 requires the served version to survive a copy change. A boolean cannot do either. |
| `DirectNotice.sentAt` nullable | The record is written when the notice is presented; `sentAt` is stamped when the mail provider accepts. Consent is gated on the **record**, not on `sentAt`. See §10 — this is a deliberate reading of AC 14 and it has a risk attached. |
| `ParentalConsent.verifiedAt` nullable + `method` + `methodEvidence` | AC 17/18/19. `ACTIVE` is a function of `verifiedAt`, never of the submission. |
| `method` on the row, not in config | AC 16. A record written under a superseded method must stay valid with no migration; that is only true if nothing re-derives the method at read time (ADR-0008 §6). |
| `noticeVersion` denormalised onto the consent row | AC 17 requires the notice version *on the consent record*. Denormalising means the two tables can have different retention windows without losing evidence. |
| `directNoticeId` with `onDelete: Restrict` | A consent record whose notice was deleted is unprovable. Restrict turns that into a loud failure instead of a silent one. |
| `ConsentVerificationChallenge` separate, hash-only | For `EMAIL_PLUS` the token *is* consent. It gets the same treatment as a sign-in token: hashed at rest, short TTL, single use (ADR-0008 §4). |
| `subjects Subject[]` (Postgres enum array) | Multi-select 1–8 with no join table. Cardinality is enforced by zod (AC 28), because the database cannot express "1 to 8". |
| `avatarId String`, not an enum | The preset set is app-bundled artwork that will change more often than a migration should. zod validates against `AVATAR_IDS`, so a bad value is still a 400 (AC 29). |
| `Upload.extractedAt` | The retention anchor moved from "upload time" to "successful extraction" (spec retention table). Without this column the job cannot express the new window without joining `Extraction` on every sweep. |
| `DeletionKind` on `DeletionAudit` | Three deletion paths with three timelines; the audit distinction is the only proof we honoured a §312.6 request rather than a closure (ADR-0007 §4). |
| `DeletionAudit` / `ConsentAuditArtifact` with no FKs | A foreign key would cascade them away during the purge they exist to record. |
| `@@index([status, createdAt])` on `StudentProfile` | The pre-consent purge (AC 22) queries exactly this pair on every run. |
| `Account` model retained | Required by `@auth/prisma-adapter` to compile. Unused in M0. |

**Migration:** `0001_m0_m1_core`, created with `pnpm db:migrate` against the local
`prisma dev` database. **Destructive: no.** The database currently has zero
models, so this is pure creation — no drops, no renames, no data loss. Applied to
Neon afterwards with `pnpm db:migrate:prod`. Do not add it to the Vercel build
command (runbook §4).

**No migration is edited by this revision** — the previous plan's migration was
never generated or applied. There is exactly one migration and it is still the
first one.

**Risk to check at migrate time:** `Subject[]` and `ConsentScope[]` are Postgres
enum arrays under Prisma 7. If the generated SQL or client surprises us, the
fallback is `String[]` with a zod-validated allowlist, decided before the
migration is applied — never after.

---

## 2. The typed error shape (defined once)

`lib/errors.ts` — imported by every route handler, every server action and the
client fetch wrapper. Nothing defines its own error type. **Unchanged from the
previous plan.**

```ts
export const ERROR_CODES = [
  'UNAUTHENTICATED',   // 401
  'FORBIDDEN',         // 403
  'NOT_FOUND',         // 404
  'VALIDATION_ERROR',  // 400
  'CONFLICT',          // 409
  'RATE_LIMITED',      // 429
  'UPSTREAM_ERROR',    // 502
  'INTERNAL_ERROR',    // 500
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ApiError = {
  code: ErrorCode;
  /// Always safe to render to a student or parent. Never an exception message,
  /// a model identifier, a stack trace or a provider payload (M1 AC 24).
  message: string;
  /// Present only for VALIDATION_ERROR. Keys are input field paths.
  fieldErrors?: Record<string, string[]>;
};

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };
```

- Every response body — success or failure — is an `ApiResult<T>`.
- Server actions return the same union, so the frontend has one shape to handle.
- `ERROR_STATUS: Record<ErrorCode, number>` is the single status map.
- One Vitest helper, `expectApiError(res, code, status)`, is applied to every
  handler so the shape cannot drift.

---

## 3. API contract — FIXED once approved

Auth column: **Session** = a valid session cookie is required (401 otherwise).
**Owner** = Session *and* the named resource resolves under
`where: { …, userId: session.user.id }` (404 otherwise). **Owner+ACTIVE** =
Owner *and* `status === 'ACTIVE'` (403 otherwise, checked **before** the body is
parsed — ADR-0006). **Cron** = `Authorization: Bearer ${CRON_SECRET}` (401
otherwise). **Provider** = the storage or consent provider's signed callback,
verified by signature. **Token** = a single-use consent challenge token; no
session required.

All responses carry `Cache-Control: no-store`. All non-GET handlers perform a
same-origin `Origin` check inside `withAuth()` (ADR-0006).

Shared DTOs live in `lib/schemas/dto.ts` and are the only shapes crossing the
boundary:

```ts
type StudentProfileDTO = {
  id: string;
  ageBand: AgeBand;
  status: StudentProfileStatus;
  /// NULL until the detail step is completed, which can only happen once ACTIVE.
  /// The frontend MUST render a "finish setting up" state for a null displayName.
  displayName: string | null;
  gradeLevel: GradeLevel | null;
  subjects: Subject[];          // [] until the detail step
  avatarId: string | null;
  /// Derived, so the client never re-implements the state machine:
  nextStep: 'NOTICE' | 'CONSENT' | 'CONSENT_PENDING' | 'PROFILE_DETAILS' | 'NONE';
  canUpload: boolean;           // === (status === 'ACTIVE')
  createdAt: string;
};
type DirectNoticeDTO = {
  id: string; noticeVersion: string; presentedAt: string; sentAt: string | null;
};
type ConsentDTO = {
  id: string; method: ConsentMethod; consentTextVersion: string;
  noticeVersion: string; relationship: ConsentRelationship;
  submittedAt: string; verifiedAt: string | null; withdrawnAt: string | null;
  // NOTE: methodEvidence, ipAddress and userAgent are NEVER in a DTO.
};
type UploadDTO = {
  id: string; studentProfileId: string; originalFilename: string;
  contentType: string; sizeBytes: number; pageCount: number | null;
  status: UploadStatus; createdAt: string;   // NOTE: pathname is never in a DTO
};
type ExtractionDTO = {
  id: string; uploadId: string; status: ExtractionStatus;
  failureMessage: string | null;             // from the fixed allowlist only
  problemCount: number; completedAt: string | null;
};
type ExtractedProblemDTO = {
  id: string; ordinal: number; label: string | null; text: string;
  containsMath: boolean; subject: Subject | null; problemType: string | null;
  studentAnswerText: string | null; confidence: number;
  lowConfidence: boolean; studentCorrected: boolean;
};
```

`Upload.pathname`, `ParentalConsent.methodEvidence`, the consent challenge token
and any signed URL **never** appear in a DTO, in HTML, or in any client payload.

### 3.1 Server actions (exactly two — ADR-0002/0006)

| Action | Module | Auth | Input (zod) | Success | Error |
|---|---|---|---|---|---|
| `signInWithEmail` | `lib/auth/actions.ts` | none | `z.object({ email: z.email(), isAdult: z.literal(true) })` | `{ ok: true, data: { sent: true } }`, then `redirect('/sign-in/sent')` | `{ ok: false, error: ApiError }` with `VALIDATION_ERROR` or `RATE_LIMITED`. Identical response for known and unknown addresses (AC 2). |
| `signOutSession` | `lib/auth/actions.ts` | Session | `z.object({})` | deletes the `Session` row, then `redirect('/')` | never throws to the client |

### 3.2 Route handlers

| # | Route | Method | Auth | Input (zod) | Success | Error |
|---|---|---|---|---|---|---|
| 1 | `/api/auth/[...nextauth]` | GET, POST | — | Auth.js internal | Auth.js internal | Auth.js internal; `pages.error = '/sign-in/error'` (AC 4) |
| 2 | `/api/students` | POST | Session | **`{ ageBand: z.enum(AgeBand) }` — and nothing else. `.strict()`, so a body carrying `displayName`, `gradeLevel`, `subjects` or `avatarId` is a 400.** (AC 8, AC 9) | `201 { student: StudentProfileDTO }`. `ageBand === ADULT` → `status: ACTIVE`, `nextStep: 'PROFILE_DETAILS'` (AC 10). Otherwise `status: NOTICE_PENDING`, `nextStep: 'NOTICE'`, and `displayName`/`gradeLevel`/`avatarId` null and `subjects` `[]` in the database (AC 9) | 400 `VALIDATION_ERROR` · 401 |
| 3 | `/api/students/[studentId]` | GET | Owner | — | `200 { student: StudentProfileDTO, consent: ConsentDTO \| null, notice: DirectNoticeDTO \| null }` | 401 · 404 (AC 31/32) |
| 4 | `/api/students/[studentId]` | PATCH | **Owner+ACTIVE** | `{ displayName: z.string().trim().min(1).max(40), gradeLevel: z.enum(GradeLevel), subjects: z.array(z.enum(Subject)).min(1).max(8).refine(unique), avatarId: z.enum(AVATAR_IDS) }` — all keys `.optional()`, `.strict()`, at least one key. `ageBand` is **not** patchable | `200 { student: StudentProfileDTO }` (AC 25, AC 30) | **403 before parsing if status ≠ ACTIVE, and nothing persisted (AC 11)** · 400 (AC 26/27/28/29) · 401 · 404 (AC 32) |
| 5 | `/api/students/[studentId]` | DELETE | Owner | — | `200 { deleted: true }` — `deleteStudentData(id, PROFILE_DELETED)`; blobs before rows (ADR-0007), cascades take notices/consents/uploads/extractions/problems, `ConsentAuditArtifact` written (AC 31, AC 46, AC 50, M1 AC 35) | 401 · 404 · 502 `UPSTREAM_ERROR` if storage deletion fails (rows retained, retryable) |
| 6 | `/api/students/[studentId]/data-deletion` | POST | Owner | `{ confirm: z.literal(true), acknowledgeIrreversible: z.literal(true) }` | `200 { deleted: true }` — identical destruction to #5 with `kind: PARENTAL_DELETION_REQUEST`. **No recovery window, no queue, not routed through account closure** (AC 48, AC 49) | 400 · 401 · 404 · 502 |
| 7 | `/api/students/[studentId]/notice` | POST | Owner | `{ noticeVersion: z.string().max(32), acknowledged: z.literal(true) }` | `201 { notice: DirectNoticeDTO }` — writes the `DirectNotice` row and dispatches the notice email. **The profile stays in `NOTICE_PENDING`**; status advances only when consent is submitted. Repeat calls append another notice row and are not an error (AC 12, 13, 14) | 400 · 401 · 404 · **409** if `noticeVersion` ≠ the deployed `DIRECT_NOTICE_VERSION` (the parent read stale copy; re-render and retry) · **502** if the mail provider rejects — *the record is still written with `sentAt: null` and retried by endpoint 28* |
| 8 | `/api/students/[studentId]/consent` | POST | Owner | `{ directNoticeId: z.cuid(), noticeVersion: z.string().max(32), consentTextVersion: z.string().max(32), consentingAdultName: z.string().trim().min(1).max(80), relationship: z.enum(ConsentRelationship), scopes: z.array(z.enum(ConsentScope)).min(1).refine(includes DATA_PROCESSING), method: z.enum(ConsentMethod).refine(eq CONSENT_METHOD), methodInput: provider.extraInputSchema, affirmed: z.literal(true) }` | `202 { student: StudentProfileDTO, consent: ConsentDTO }` — row written with `verifiedAt: null`, status `CONSENT_PENDING`, `provider.begin()` run in the same transaction (AC 17, AC 18). IP and user agent are read **server-side** from headers and are never accepted from the body | **400** if the body omits the notice binding or the method block — *this is the AC 20 case; see ADR-0006 "Resolving AC 18 against AC 20"* · **409** if no `DirectNotice` exists for this profile, and no consent row is written (AC 15) · **409** if `consentTextVersion` or `noticeVersion` is stale, or the profile is already `ACTIVE` · 401 · 404 |
| 9 | `/api/consent/verify` | POST | **Token** (public, rate limited) | `{ token: z.string().min(32).max(256) }` | `200 { verified: true }` — `provider.corroborate()`, then the conditional stamp `verifiedAt = max(now, submittedAt+1ms)` and `status = ACTIVE` in one transaction (AC 19). Idempotent: a replay of an already-consumed token by the same holder returns `200 { verified: true }` without a second stamp | 400 · **409** `EXPIRED` · 404 unknown token · 429 |
| 10 | `/api/consent/decline` | POST | Token | `{ token: z.string() }` | `200 { declined: true }` — consumes the challenge, leaves `verifiedAt` null and the profile in `CONSENT_PENDING` (AC 21). The "this was not me" action in the confirmation message | 400 · 404 · 409 · 429 |
| 11 | `/api/consent/callback/[method]` | POST | **Provider** (signature-verified) | method-specific, validated by `provider.corroborate()` | `200 { received: true }` — the same stamp path as #9. **Specified now, implemented only when a non-`EMAIL_PLUS` method ships** (AC 16, AC 19) | 400 · 401 bad signature · 409 |
| 12 | `/api/students/[studentId]/consent/withdraw` | POST | Owner | `{ confirm: z.literal(true) }` | `201 { student: StudentProfileDTO }` with `status: CONSENT_WITHDRAWN`; **appends** a new row copying `method`/versions/scopes with `withdrawnAt` and `supersedesConsentId` set, prior row untouched (AC 24) | 400 · 401 · 404 · 409 if status is not `ACTIVE` |
| 13 | `/api/account/closure` | POST | Session | `{ confirm: z.literal(true) }` | `202 { closureRequestedAt, purgeAfter, recoveryWindowDays }` — sets `closureRequestedAt`, deletes all `Session` rows, writes `DeletionAudit { kind: ACCOUNT_CLOSURE }` (AC 47). **`purgeAfter` and `recoveryWindowDays` are returned so the confirmation screen states the window rather than hard-coding it** | 400 · 401 · 409 if already closing |
| 14 | `/api/blob/upload` | POST | Session (client-token event) / Provider (`upload-completed` event) | body discriminated on `type`. For `blob.generate-client-token`, `clientPayload` is `{ studentProfileId: z.cuid(), originalFilename: z.string().min(1).max(255) }`; the proposed pathname must match `^students/<authorizedId>/uploads/[A-Za-z0-9-]+\.[a-z0-9]+$` | `200` with the provider's token JSON. Constraints returned: `access:'private'`, `allowedContentTypes:['image/jpeg','image/png','image/webp','application/pdf']`, `maximumSizeInBytes: 20_971_520`, `addRandomSuffix:true` (AC 37) | 400 · **401** with no token anywhere in the body (AC 34) · **403** cross-account (AC 35, M1 AC 12) · **403** status is not exactly `ACTIVE` — tested positively, covering `NOTICE_PENDING`, `CONSENT_PENDING`, `CONSENT_WITHDRAWN` (AC 36, M1 AC 11) · **429** hourly cap (M1 AC 17) |
| 15 | `/api/uploads/confirm` | POST | Owner+ACTIVE (of `studentProfileId`) | `{ studentProfileId: z.cuid(), pathname: z.string().max(512), originalFilename: z.string().min(1).max(255) }` | `201 { upload: UploadDTO, extractionId }` on first call; `200` with the same body on repeat (M1 AC 15). Server calls `head(pathname)` for `contentType`/`sizeBytes`; PDFs are page-counted and rejected above the limit. Schedules extraction with `after()` | 400 · 401 · 403 · 404 object not found in store · **409** PDF page limit (M1 AC 10) · disallowed content type → 400 |
| 16 | `/api/uploads/[uploadId]` | GET | Owner (via `upload.studentProfile.userId`) | — | `200 { upload: UploadDTO, extraction: ExtractionDTO \| null }` | 401 · **404** cross-account (M1 AC 33) |
| 17 | `/api/uploads/[uploadId]` | DELETE | Owner | — | `200 { deleted: true }` — marks `SOURCE_DELETED`, deletes the blob, then deletes the row and cascades (M1 AC 34) | 401 · 404 · 502 |
| 18 | `/api/uploads/[uploadId]/preview-url` | GET | Owner | — | `200 { url, expiresAt }` where `expiresAt - now <= 5 min` (AC 41, M1 AC 32). `Cache-Control: no-store`. The only place a signed URL is ever emitted | 401 · 404 · 409 if `status === SOURCE_DELETED` |
| 19 | `/api/extractions/[extractionId]` | GET | Owner | — | `200 { extraction: ExtractionDTO, problems: ExtractedProblemDTO[] }`. Polled every 2s while non-terminal. Lazily transitions a stale `RUNNING` to `FAILED`/`TIMEOUT` (M1 AC 27) | 401 · 404 (M1 AC 33) |
| 20 | `/api/extractions/[extractionId]/retry` | POST | Owner | `{}` | `202 { extraction: ExtractionDTO }` with `status: PENDING`, `attemptCount + 1` | 401 · 404 · 409 if status is not `FAILED` · 429 above `MAX_EXTRACTION_ATTEMPTS` |
| 21 | `/api/extractions/[extractionId]/confirm` | POST | Owner | `{ confirm: z.literal(true) }` | `200 { extraction: ExtractionDTO }` with `status: CONFIRMED` — the M2 handoff point (M1 AC 30). **Also stamps `Upload.extractedAt` if not already set** | 400 · 401 · 404 · 409 unless status is `COMPLETE` |
| 22 | `/api/extractions/[extractionId]/problems/[problemId]` | PATCH | Owner | `{ text: z.string().trim().min(1).max(2000) }` | `200 { problem: ExtractedProblemDTO }` with `studentCorrected: true` (M1 AC 28) | 400 · 401 · 404 |
| 23 | `/api/extractions/[extractionId]/problems/[problemId]` | DELETE | Owner | — | `200 { deleted: true }`. Ordinals of the survivors are **not** renumbered (M1 AC 29) | 401 · 404 |
| 24 | `/api/cron/reconcile-blobs` | GET | Cron | — | `200 { scanned, orphansDeleted, uploadsFailed, grantsPruned }` (AC 43, M1 AC 16) | 401 · 502 |
| 25 | `/api/cron/purge-pre-consent` | GET | Cron | — | `200 { profilesPurged, blobsDeleted }` — profiles with `status NOT IN (ACTIVE, CONSENT_WITHDRAWN)` older than `PRE_CONSENT_PURGE_DAYS` (AC 22, AC 23) | 401 · 502 |
| 26 | `/api/cron/purge-closed-accounts` | GET | Cron | — | `200 { purged }` (AC 47) | 401 · 502 |
| 27 | `/api/cron/enforce-retention` | GET | Cron | — | `200 { byCategory: Record<string, number> }` — walks `RETENTION_POLICY`; source files are swept on `extractedAt`, not `createdAt` (AC 45, M1 AC 36); also expires `ConsentAuditArtifact` past `purgeAfter` and unconsumed `ConsentVerificationChallenge` rows | 401 · 502 |
| 28 | `/api/cron/retry-notice-emails` | GET | Cron | — | `200 { retried, sent }` — `DirectNotice` rows with `sentAt IS NULL` (AC 14) | 401 · 502 |

**Totals: 27 application endpoints across 23 route files, plus the Auth.js
catch-all, plus 2 server actions.** (Was 20 across 17.)

Three contract rules the parallel tracks must not renegotiate:

1. **404 vs 403 vs 409.** Cross-account access is always **404**. **403** is used
   only when the caller genuinely owns the resource but the operation is barred
   by consent state (profile fields before `ACTIVE`, an upload token for a
   non-`ACTIVE` profile). **409** is used when the resource is at the wrong step
   of a flow, or a version the client holds is stale, and the fix is another
   request. The full order of checks is in ADR-0006.
2. **An affirmation is never sufficient input to any endpoint.** No route turns
   a self-assertion into an `ACTIVE` profile. Activation happens only in #9 or
   #11, from evidence a provider produced.
3. **Failure messages** returned to the browser come from a fixed allowlist in
   `lib/errors.ts`. No exception text, model identifier, provider payload or
   stack trace is ever placed in a response body (M1 AC 24).

---

## 4. Component tree

Server components are the default. Every `"use client"` below has a stated
reason, and none of them import `@/lib/db`.

```
app/layout.tsx                                        server   root shell, katex.min.css
app/page.tsx                                          server   landing; link to /sign-in
app/retention/page.tsx                                server   AC 44. PUBLIC, no sign-in. Renders
                                                               RETENTION_POLICY from lib/config.ts —
                                                               the same array the jobs walk, so the
                                                               published page cannot describe a window
                                                               the code does not enforce.
app/privacy/page.tsx                                  server   public privacy policy; links /retention
proxy.ts                                              (edge)   OPTIMISTIC cookie-presence redirect only.
                                                               Never the authorization boundary (ADR-0002).
                                                               Matcher must EXCLUDE /retention, /privacy
                                                               and /consent/*.

app/(auth)/
  sign-in/page.tsx                                    server   renders the form; already-signed-in → /dashboard
    components/auth/sign-in-form.tsx                  CLIENT   useActionState for pending/field errors and the
                                                               18+ checkbox; needs interactivity (AC 2, AC 6)
  sign-in/sent/page.tsx                               server   static "check your email"; identical for known and
                                                               unknown addresses (AC 2)
  sign-in/error/page.tsx                              server   expired or already-used link (AC 4)

app/(public)/
  consent/verify/[token]/page.tsx                     server   AC 19. PUBLIC, no session — the parent may open the
                                                               confirmation message on another device. Renders the
                                                               method's copy and TWO explicit controls.
    components/consent/verify-actions.tsx             CLIENT   "Yes, I consent" → POST /api/consent/verify;
                                                               "This was not me" → POST /api/consent/decline.
                                                               MUST be a POST: a mutating GET would let a corporate
                                                               mail scanner grant parental consent (ADR-0008 §5).
  consent/verify/done/page.tsx                        server   terminal states: verified / expired / already used

app/(app)/layout.tsx                                  server   nav shell. Does NOT gate access — Next 16 docs warn
                                                               layouts do not re-render on navigation and do not
                                                               control whether children render. Each page calls the DAL.
    components/nav/user-menu.tsx                      CLIENT   dropdown + sign-out form action; menu open state

  dashboard/page.tsx                                  server   requireUser() → profiles scoped by userId (AC 7/33)
    components/students/student-card.tsx              server   renders status. MUST handle a null displayName for an
                                                               ACTIVE profile ("finish setting up") and for every
                                                               pre-consent status ("waiting for your consent")
    components/students/student-status-badge.tsx      server   one badge per StudentProfileStatus (AC 9/18/24)
    components/students/delete-student-dialog.tsx     CLIENT   confirm dialog + DELETE + router.refresh() (AC 31)

  ── the four-step add-a-student flow, in spec order ──
  students/new/page.tsx                               server   STEP 1. Age gate ONLY.
    components/students/age-gate-form.tsx             CLIENT   radio group over AgeBand. AC 8 is a DOM assertion:
                                                               no name/grade/subject/avatar control anywhere in this
                                                               tree, NO defaultValue, NO defaultChecked, and no copy
                                                               that hints which band unlocks more. Submits to #2.
  students/[studentId]/notice/page.tsx                server   STEP 2. §312.4 direct notice, rendered server-side from
                                                               the versioned copy module (AC 12, 13). Redirects to the
                                                               dashboard unless status is NOTICE_PENDING.
    components/consent/direct-notice.tsx              server   THE notice text. Names Anthropic / Vercel / Neon / the
                                                               email provider and what each receives (AC 13). Links
                                                               /retention (AC 12) and /privacy. Exports
                                                               DIRECT_NOTICE_VERSION beside the copy.
    components/consent/notice-acknowledge.tsx         CLIENT   "I have read this" → POST #7 → step 3
  students/[studentId]/consent/page.tsx               server   STEP 3. Server-resolves the configured provider and
                                                               renders provider.stepCopyId. Redirects back to step 2
                                                               if no DirectNotice exists (AC 15).
    components/consent/consent-text.tsx               server   the disclosure itself; CONSENT_TEXT_VERSION beside it
    components/consent/consent-form.tsx               CLIENT   name, relationship, affirm, plus the provider's extra
                                                               fields; POST #8 → CONSENT_PENDING (AC 17/18)
  students/[studentId]/consent/pending/page.tsx       server   STEP 3b. "Check your email" for EMAIL_PLUS; method-neutral
                                                               copy resolved from the provider (AC 18). Polls nothing —
                                                               the parent returns via the link.
  students/[studentId]/profile/page.tsx               server   STEP 4. Redirects unless status is ACTIVE.
    components/students/student-detail-form.tsx       CLIENT   controlled multi-field form, live validation, submit
                                                               state, PATCH #4 (AC 25/26/30)
    components/students/avatar-picker.tsx             CLIENT   selection state over AVATAR_IDS. Renders <button>s only —
                                                               NO file input exists anywhere in the tree (AC 29)
    components/students/subject-multiselect.tsx       CLIENT   1–8 selection state (AC 28)
  ── end of flow ──

  students/[studentId]/edit/page.tsx                  server   same form as step 4, for an already-complete profile (AC 30)
  students/[studentId]/consent/withdraw/page.tsx      server   shell
    components/consent/withdraw-consent-form.tsx      CLIENT   confirm + POST #12 (AC 24)
  students/[studentId]/privacy/page.tsx               server   AC 49. The parent's §312.6 surface, reachable FROM THE
                                                               STUDENT PROFILE. Shows the consent record, the notice
                                                               version, and the deletion action. Account closure is not
                                                               mentioned here.
    components/consent/delete-child-data-dialog.tsx   CLIENT   AC 48. Typed confirmation. Copy states the deletion is
                                                               IMMEDIATE AND IRREVERSIBLE and names no recovery window,
                                                               because there is none. POST #6.

  students/[studentId]/page.tsx                       server   student home; upload list; blocks the CTA for any status
                                                               other than ACTIVE (AC 36, M1 AC 11)
    components/uploads/upload-list.tsx                server   uploads + extraction status per row

  students/[studentId]/uploads/new/page.tsx           server   shell; passes status and limits as props
    components/uploads/upload-panel.tsx               CLIENT   the whole reason client-direct upload exists: file input
                                                               with capture, magic-byte sniff, lazy HEIC convert, lazy
                                                               PDF page count, upload() with onUploadProgress, confirm
                                                               call, error states (M1 AC 1–11)

  students/[studentId]/uploads/[uploadId]/page.tsx    server   results page; loads upload + extraction + problems
    components/uploads/extraction-status.tsx          CLIENT   polls GET #19 until terminal (M1 AC 18)
    components/uploads/problem-list.tsx               server   renders LaTeX with katex.renderToString — no KaTeX JS
                                                               ships to the browser (M1 AC 21, ADR-0005)
    components/uploads/problem-row-actions.tsx        CLIENT   inline edit textarea + delete (M1 AC 28/29)
    components/uploads/low-confidence-badge.tsx       server   flag below LOW_CONFIDENCE_THRESHOLD (M1 AC 26)
    components/uploads/upload-preview.tsx             CLIENT   fetches the signed URL on demand and holds it in memory
                                                               only; never server-rendered into HTML (M1 AC 31/32)
    components/uploads/confirm-extraction-button.tsx  CLIENT   POST #21 → CONFIRMED (M1 AC 30)
    components/uploads/empty-extraction.tsx           server   "we could not find any problems" + retake (M1 AC 25)

  settings/page.tsx                                   server   account
    components/account/close-account-dialog.tsx       CLIENT   AC 47. Typed confirmation. Copy STATES the recovery
                                                               window length and its purpose, taken from the API
                                                               response, not hard-coded. Named "Close account",
                                                               never "Delete my data", and it links to the per-student
                                                               §312.6 path so closure is not the only route (AC 49).
```

shadcn/ui components to add via the CLI (source copied into `components/ui/`,
not dependencies): `input`, `label`, `checkbox`, `radio-group`, `select`, `card`,
`dialog`, `alert`, `badge`, `progress`, `textarea`, `skeleton`, `separator`,
`table`, `sonner`. `button` already exists. (`radio-group`, `separator` and
`table` are new: the age gate, the notice and the retention page.)

**Client components never import `@/lib/db`.** Prisma enum values reach the
browser through `@/lib/generated/prisma/enums`, the generated browser-safe
entrypoint, re-exported from `lib/domain/enums.ts`.

**Two DOM-level rules the frontend must not soften:**

- The age-gate step's rendered tree contains **no** input for display name,
  grade, subject or avatar, and no preselected band (AC 8). Not disabled, not
  hidden — absent.
- The avatar picker contains **no** `<input type="file">` anywhere (AC 29).

---

## 5. File-by-file implementation order

### 5.0 Shared — must land before the tracks split

These are the contract. Both engineers import them; neither may edit them
without re-agreeing the contract.

| # | File | What |
|---|---|---|
| S1 | *(the spike, §9)* | Confirms or replaces ADR-0003 before any storage code |
| S2 | `prisma/schema.prisma` + `pnpm db:migrate` | §1 verbatim → migration `0001_m0_m1_core` |
| S3 | `lib/errors.ts` | `ApiError`, `ApiResult`, `ERROR_STATUS`, the user-facing message allowlist |
| S4 | `lib/config.ts` | Every tunable in §7, **including `RETENTION_POLICY` and `CONSENT_METHOD`**. No literals anywhere else |
| S5 | `lib/domain/enums.ts` | `AVATAR_IDS`, label maps, re-exports from `lib/generated/prisma/enums` |
| S6 | `lib/consent/methods/port.ts` | `ConsentMethodProvider`, `ConsentContext`, `BeginResult`, `CorroborationResult` (ADR-0008 §2). **Types only — no implementation.** Both tracks depend on it |
| S7 | `lib/schemas/*.ts` | Every zod input schema in §3, one file per resource |
| S8 | `lib/schemas/dto.ts` | The DTO types in §3, including `nextStep` and the nullable profile fields |
| S9 | `lib/storage/port.ts` | `StoragePort` interface + `ClientUploadPolicy` (ADR-0003) |

After S9, `pnpm typecheck` passes with no runtime code. The tracks then run in
parallel.

**S6 and S8 are the new blocking pair.** The frontend cannot render the flow
without `nextStep` and the provider's `stepCopyId`; the backend cannot write the
consent service without the port. Neither is large; both must land first.

### 5.1 Backend track

| # | File | What |
|---|---|---|
| B1 | `lib/auth/config.ts` | `NextAuth({ adapter, session: { strategy:'database' }, providers:[magicLink], callbacks:{ signIn }, pages })`; 15-minute `maxAge`; **closure refusal keyed on `closureRequestedAt` only** |
| B2 | `lib/email/client.ts`, `send-magic-link.ts`, `send-direct-notice.ts`, `send-consent-confirmation.ts` | `fetch` to the Resend API; console output in non-production. **Three distinct message types, three distinct token spaces** (ADR-0002) |
| B3 | `app/api/auth/[...nextauth]/route.ts` | Auth.js handlers |
| B4 | `lib/auth/dal.ts` | `import 'server-only'`; cached `verifySession`, `requireUser`, `requireStudentProfile`, `requireActiveStudentProfile`, `requireUpload`, `requireExtraction` — every one scoped by `userId` |
| B5 | `lib/auth/actions.ts` | `signInWithEmail` (writes `AdultAttestation`, then `signIn`), `signOutSession` |
| B6 | `proxy.ts` | Optimistic cookie redirect; matcher excludes `_next`, static assets, `/api/*`, `/retention`, `/privacy`, `/consent/*` |
| B7 | `lib/api/handler.ts` | `withAuth()`: the seven ordered checks from ADR-0006, including the **consent-state gate above body parsing**, plus a `public` mode for endpoints #9/#10 |
| B8 | `app/api/students/route.ts`, `app/api/students/[studentId]/route.ts` | Endpoints 2–5. #2 is age-band-only and `.strict()` |
| B9 | `lib/notice/service.ts` + the notice copy module + `app/api/students/[studentId]/notice/route.ts` | Endpoint 7. Notice record + email dispatch. `DIRECT_NOTICE_VERSION` lives with the copy, not in config |
| B10 | `lib/consent/methods/email-plus.ts` + `registry.ts` | The first `ConsentMethodProvider` (ADR-0008 §7). Token generation, SHA-256 hashing, TTL, single use |
| B11 | `lib/consent/service.ts` | `submitConsent`, `verifyConsent`, `declineConsent`, `withdrawConsent`. **The only module that may `UPDATE parental_consent`, and only the `verified_at IS NULL` stamp** (ADR-0007 §3) |
| B12 | `app/api/students/[studentId]/consent/route.ts`, `.../withdraw/route.ts`, `app/api/consent/verify/route.ts`, `.../decline/route.ts`, `.../callback/[method]/route.ts` | Endpoints 8–12 |
| B13 | `lib/deletion/service.ts` | `deleteStudentData(studentProfileId, kind)` — blobs first, `ConsentAuditArtifact`, `DeletionAudit`, then rows. **One function, three callers** (ADR-0007 §4) |
| B14 | `app/api/students/[studentId]/data-deletion/route.ts`, `app/api/account/closure/route.ts` | Endpoints 6, 13 |
| B15 | `lib/storage/vercel-blob.ts` | The `StoragePort` implementation, written against the **verified** signatures from the spike |
| B16 | `lib/uploads/rate-limit.ts` + `app/api/blob/upload/route.ts` | Endpoint 14; `UploadTokenGrant` write, hourly cap, pathname assertion, positive `ACTIVE` test |
| B17 | `lib/uploads/record-upload.ts` + `app/api/uploads/confirm/route.ts` | Endpoint 15; idempotent upsert on `pathname` (catch P2002 → re-read), `head()` verification, PDF page count, `after()` scheduling |
| B18 | `app/api/uploads/[uploadId]/route.ts`, `.../preview-url/route.ts` | Endpoints 16–18; blob-first deletion |
| B19 | `lib/ai/client.ts`, `lib/ai/extraction-schema.ts`, `lib/ai/prompt.ts` | Anthropic client with `timeout` and `maxRetries: 0`; the zod contract from ADR-0005; the extraction prompt |
| B20 | `lib/extraction/run-extraction.ts` | Status machine, refusal/null/timeout handling, single-transaction terminal write, **`Upload.extractedAt` stamp on success** |
| B21 | `app/api/extractions/**` | Endpoints 19–23 |
| B22 | `lib/jobs/reconcile-blobs.ts`, `purge-pre-consent.ts`, `purge-closed-accounts.ts`, `enforce-retention.ts`, `retry-notice-emails.ts` | Pure functions taking a `StoragePort` and a clock, so they are unit-testable with a fake and a frozen time |
| B23 | `app/api/cron/*/route.ts` ×5 + `vercel.json` | Endpoints 24–28 |
| B24 | `.env.example`, `docs/runbook.md` | New env vars and the cron/job operations section |

### 5.2 Frontend track

| # | File | What |
|---|---|---|
| F1 | `components/ui/*` | shadcn CLI adds (§4 list) |
| F2 | `lib/api/client.ts` | `apiFetch<T>(): Promise<ApiResult<T>>` — the only place `ApiError` is unwrapped |
| F3 | `app/(auth)/sign-in/**` + `components/auth/sign-in-form.tsx` | AC 1–6 |
| F4 | `app/(app)/layout.tsx` + `components/nav/user-menu.tsx` | Shell and sign-out |
| F5 | `app/retention/page.tsx` + `app/privacy/page.tsx` | **AC 44.** Pure render of `RETENTION_POLICY`. No auth, no data access — buildable on day one |
| F6 | `app/(app)/dashboard/page.tsx` + `student-card.tsx` + `student-status-badge.tsx` + `delete-student-dialog.tsx` | AC 7, 31, 32, 33 — including the null-displayName states |
| F7 | `students/new/page.tsx` + `age-gate-form.tsx` | **AC 8, 9, 10.** The DOM assertions live here |
| F8 | `students/[studentId]/notice/page.tsx` + `direct-notice.tsx` + `notice-acknowledge.tsx` | AC 12, 13, 14 |
| F9 | `consent/page.tsx` + `consent-text.tsx` + `consent-form.tsx` + `consent/pending/page.tsx` | AC 15, 17, 18, 20, 21 |
| F10 | `app/(public)/consent/verify/[token]/**` | AC 19, 21. Public, session-free, POST-only actions |
| F11 | `students/[studentId]/profile/page.tsx` + `student-detail-form.tsx` + `avatar-picker.tsx` + `subject-multiselect.tsx` + `edit/page.tsx` | AC 25–30 |
| F12 | `students/[studentId]/privacy/page.tsx` + `delete-child-data-dialog.tsx` + the withdraw pages | AC 24, 48, 49 |
| F13 | `app/(app)/students/[studentId]/page.tsx` + `upload-list.tsx` | AC 36 / M1 AC 11 gating on all three non-ACTIVE statuses |
| F14 | `lib/uploads/sniff.ts`, `convert-heic.ts`, `pdf-page-count.ts`, `client-validate.ts` | **Pure, no React, no network** — the highest-value unit tests in M1 (M1 AC 4, 5, 6, 7, 10) |
| F15 | `components/uploads/upload-panel.tsx` | M1 AC 1–9 |
| F16 | `students/[studentId]/uploads/[uploadId]/page.tsx` + the six result components | M1 AC 18, 21, 25, 26, 28, 29, 30, 31 |
| F17 | `app/(app)/settings/page.tsx` + `close-account-dialog.tsx` | AC 47 UI, with the window length taken from the API response |

F5 and F14 can both start on day one — F5 depends only on S4, F14 only on S4 and
browser APIs — and are the right first frontend tasks while auth is being wired.

### 5.3 Typecheck order

`schema → generated enums → lib/schemas + lib/errors + lib/config → consent port
→ storage port → server (dal, handler, services, routes) → UI`. Each step
compiles on its own. Frontend F2–F17 depend only on S3, S5, S6, S7, S8 — never
on backend files — which is what makes the split real.

---

## 6. Verification plan

### Covered by Vitest (unit and integration, Node environment, real local Postgres)

Route handlers are imported and called directly with a stubbed session, so the
status-code criteria are asserted literally rather than through a browser. Jobs
take an injected clock, so every retention window is tested by moving time
rather than by waiting.

| Area | Criteria |
|---|---|
| Age-gate endpoint rejects any body key beyond `ageBand`; pending row has null name/grade/avatar and empty subjects | M0 9 |
| Adult band activates immediately with no notice and no consent row | M0 10 |
| Profile-detail POST against every non-`ACTIVE` status → 403, nothing persisted, **including with an invalid body** (check order) | M0 11 |
| Consent endpoint with no `DirectNotice` → typed error, no consent row | M0 15 |
| **Method swap:** run the whole flow twice with two different `CONSENT_METHOD` values; assert new flows use the new method, old rows still read, old profiles still `ACTIVE`, and no migration ran | M0 16 |
| Consent record field-by-field, including `method`, `methodEvidence`, `noticeVersion`, `submittedAt` | M0 17 |
| Submission leaves `verifiedAt` null and status `CONSENT_PENDING` | M0 18 |
| Corroboration stamps `verifiedAt` strictly after `submittedAt` and only then activates; replay is idempotent | M0 19 |
| Bare `{name, relationship, affirmed}` POST → 400, no row, no activation | M0 20 |
| Decline / abandon leaves no verified record and no profile fields | M0 21 |
| Pre-consent purge with a frozen clock; `ACTIVE` rows untouched; window shortened in config widens the sweep | M0 22, 23 |
| Withdrawal appends, prior row byte-identical, status `CONSENT_WITHDRAWN` | M0 24 |
| zod input schemas | M0 26, 27, 28, 29 |
| Ownership scoping (A cannot touch B) | M0 32, 35 · M1 12, 33 |
| Dashboard payload contains only the caller's profiles | M0 33 |
| Upload-token authorization: 401, cross-account 403, **each of the three non-`ACTIVE` statuses** 403 | M0 34, 35, 36 · M1 17 |
| Confirm idempotency and `head()`-derived fields | M1 13, 15 |
| PDF page limit rejection | M1 10 |
| Magic-byte HEIC sniffer (hand-built `Uint8Array` fixtures) | M1 4 |
| Client validation helpers (size, type) | M1 6, 7 |
| Extraction handling with a mocked Anthropic client; `extractedAt` stamped on success | M1 18–25, 27 |
| Ordinal stability after delete | M1 29 |
| Extraction confirm transition | M1 30 |
| Retention page renders every `RETENTION_POLICY` row; **a test asserts every windowed category has a corresponding job step and vice versa** | M0 44 |
| Each retention window changed in config changes what the job deletes, and only that category | M0 45 |
| Profile deletion removes every object under the prefix and every row, against a fake `StoragePort` | M0 46 · M1 35 |
| Account closure: sessions dropped, sign-in refused inside the window, purge after it, `DeletionAudit` survives | M0 47 |
| **§312.6 deletion: rows gone at confirmation time, `closureRequestedAt` NOT set, no cron run needed, audit `kind` is `PARENTAL_DELETION_REQUEST`** | M0 48 |
| Consent pseudonymisation: after either deletion path, only the AC 50 fields remain and the hash is not the email | M0 50 |
| Reconciler / purge / retention against a fake `StoragePort` | M0 43 · M1 16, 34, 36 |
| Error-shape conformance (one helper, every handler) | M0 11, 27 · M1 17, 24 |
| Signed-URL TTL arithmetic (`expiresAt - now <= 5 min`) | M0 41 · M1 32 |
| **`docs/security-program.md` exists, has a named coordinator, and carries a risk-assessment date and a review date within the previous 12 months**; its vendor section names all four vendors with a date each | M0 51, 52 — *structure only, see below* |

### Covered by Playwright

| Area | Criteria |
|---|---|
| Signed-out `/dashboard` redirect, no account data in the body | M0 1 |
| Sign-in email flow — the token is read from `VerificationToken` in a fixture, no mail server | M0 2, 3, 4, 5 |
| 18+ attestation blocks submission and writes no `User` row | M0 6 |
| Empty dashboard and the "add a student" CTA | M0 7 |
| **Age-gate DOM:** no name/grade/subject/avatar control in the step's DOM, no checked radio, no `defaultValue` | M0 8 |
| Adult band skips notice and consent entirely | M0 10 |
| Direct notice renders before any consent control is reachable; names Anthropic, Vercel, Neon and the email provider; links `/retention` and `/privacy` | M0 12, 13 |
| Navigating directly to the consent URL from `NOTICE_PENDING` bounces to the notice | M0 15 |
| Full happy path: gate → notice → consent → pending → verify link → `ACTIVE` → detail form → dashboard | M0 9, 14, 18, 19, 25 |
| Profile edit persists across reload; delete → 404 | M0 30, 31 |
| No file input in the avatar picker DOM | M0 29 |
| `/retention` renders signed-out | M0 44 |
| Deletion path is reachable from the student profile without visiting settings; closure dialog states the window; the two are not the same control | M0 47, 48, 49 |
| Upload screen: `accept` attribute, camera option, disabled for each non-`ACTIVE` status | M0 36 · M1 1, 11 |
| **Byte routing** — `page.on('request')` asserts a request to `*.blob.vercel-storage.com` and no same-origin request body over 1 MB | M1 2 |
| HEIC upload stores a JPEG; HEIC renamed `.jpg` still converts | M1 3, 4 |
| No HEIC chunk requested for a JPEG upload | M1 5 |
| Oversize and wrong-type rejection messages | M1 6, 7 |
| Progress indicator reaches 100% | M1 8 |
| Retry after a simulated network abort succeeds | M1 9 |
| Persistence without the provider callback (localhost) | M1 14 |
| Low-confidence flag, edit, delete, confirm | M1 26, 28, 29, 30 |

### Not automatically testable — stated plainly rather than implied

**New in this revision:**

- **AC 8, the neutrality half.** "No copy states or implies which selection
  unlocks more of the product" is a judgement, not an assertion. Playwright can
  and does prove the *structural* half — no other input in the DOM, no
  preselection, no default. A human must read the copy, and it should be pinned
  by a snapshot so it cannot drift silently.
- **AC 12 and AC 13, the substance.** We can assert that the notice screen
  contains the strings "Anthropic", "Vercel", "Neon" and the email provider's
  name, that it links `/retention` and `/privacy`, and that it renders before any
  consent control. **We cannot assert that the description is accurate or
  adequate.** Snapshot-pinned against `DIRECT_NOTICE_VERSION`; a human — ideally
  counsel — must read it.
- **AC 14, the email.** Dispatch is asserted by stubbing the mail client. That
  the message is actually delivered, and that a parent receives it, is not
  tested and cannot be in CI.
- **AC 16 beyond two methods.** The swap is tested by running the flow under
  `EMAIL_PLUS` and under a fake second provider. That a *real* `PAYMENT_CARD` or
  vendor method drops in cleanly is untested until one exists — the interface is
  a hypothesis until its second real implementation.
- **AC 19 for methods we have not built.** Only `EMAIL_PLUS` corroboration is
  end-to-end. The others are exercised against a fake provider, which proves the
  service, not the method.
- **Whether any of this is legally sufficient.** No test in this repository can
  assert that our consent method satisfies §312.5, that our notice satisfies
  §312.4, or that our retention windows are defensible. **The suite proves the
  code does what the spec says; the spec is an unreviewed guess in exactly the
  places it says it is.**
- **AC 51 and AC 52, the substance.** A Vitest test can assert the file exists,
  has a named coordinator line, and carries dates within the previous 12 months,
  and that the vendor section names four vendors each with a date. **It cannot
  assess whether the risk assessment is real or whether the vendor assessment
  was diligent.** Those are the parts that matter and they are human work. The
  structural test exists so the document cannot silently go stale, not so it can
  be declared done by CI.
- **AC 46 / 48's "within 24 hours".** Job *logic* is fully unit tested against a
  fake `StoragePort` with an injected clock. Real blob deletion and the 24-hour
  bound depend on Vercel Cron and are verified by one manual rehearsal on a
  preview deployment. **Cron scheduling itself is not testable.**
- **AC 50's adequacy.** We test that the pseudonymised artifact contains only the
  listed fields. Whether keeping it at all is lawful is an open question marked
  ASSUMPTION in the spec.

**Carried over, unchanged:**

- **M0 AC 3 (`Secure` flag).** Playwright runs over HTTP locally. We assert
  `HttpOnly` and `SameSite=Lax` in e2e and assert the production cookie name is
  `__Secure-authjs.session-token` in a config unit test. **The `Secure` flag
  itself is verified manually once on a preview deployment.**
- **M0 AC 38, 40, 42.** These test the storage *provider*, not our code — that a
  25 MB write is rejected, that an unauthenticated fetch of a private URL fails,
  that a `get`-signed URL cannot be replayed as a `put`. They are proven once in
  the spike (§9 S2, S4, S5) and re-run by an integration test that **skips
  unless `BLOB_READ_WRITE_TOKEN` is present**, so CI does not silently claim
  coverage it does not have.
- **M0 AC 2 (non-disclosure of account existence).** We assert byte-identical
  responses and identical redirects for a known and an unknown address. **A
  timing side channel is not tested.**
- **M1 AC 19/20 (extraction fidelity).** Tested as exact-set equality against
  three committed fixture worksheets with hand-written expected output.
  **Real-world extraction accuracy is unmeasured and this suite does not
  measure it.** Anthropic is mocked in CI; one opt-in live test runs behind
  `RUN_LIVE_AI=1`.
- **M1 AC 3/4 on a real device.** Chromium executes the wasm decoder, which is
  the useful part, but iOS Safari's memory ceiling on a 12 MP HEIC is the real
  risk and requires a physical iPhone.
- **M1 AC 27 (function duration).** Whether a `high`-effort call fits inside the
  limit is measured in §9 spike B, not asserted by a test.

---

## 7. Configuration module

`lib/config.ts` — every number the specs marked as an assumption lives here and
nowhere else. **AC 45 makes this a compliance surface, not a convenience:** no
duration may be a literal in application code.

| Constant | Value | Source |
|---|---|---|
| `CONSENT_METHOD` | `'EMAIL_PLUS'` (from `process.env`, zod-validated against the enum at load) | **M0 AC 16, ADR-0008.** A bad value fails the boot |
| `CONSENT_TEXT_VERSION` | `'2026-08-26.1'` | M0 AC 17 |
| `CONSENT_CHALLENGE_TTL_HOURS` | `72` | M0 AC 19 — **assumption**; long enough for a parent to find the email |
| `PRE_CONSENT_PURGE_DAYS` | `14` | M0 AC 22/23 — **assumption**, from the FTC's Microsoft/Xbox order |
| `CONSENT_AUDIT_RETENTION_DAYS` | `0` | M0 AC 50 — **needs counsel.** `0` = purged with everything else |
| `ACCOUNT_CLOSURE_RECOVERY_DAYS` | `30` | M0 AC 47 — **assumption**; returned to the client so the copy is never hard-coded |
| `SOURCE_FILE_RETENTION_DAYS_AFTER_EXTRACTION` | `14` | M0 retention table — **assumption**, supersedes M1's 365 |
| `DELETION_AUDIT_RETENTION_DAYS` | `365` | M0 AC 47 — **assumption** |
| `RETENTION_POLICY` | the table below | M0 AC 44/45 |
| `MAX_UPLOAD_BYTES` | `20 * 1024 * 1024` | M0 AC 37 (product assumption) |
| `ALLOWED_UPLOAD_CONTENT_TYPES` | `['image/jpeg','image/png','image/webp','application/pdf']` | M0 AC 37 |
| `ACCEPTED_PICKER_TYPES` | the above + `image/heic`, `image/heif` | M1 AC 1 |
| `SIGNED_URL_TTL_MS` | `5 * 60_000` | M0 AC 41 (product assumption) |
| `ORPHAN_THRESHOLD_MINUTES` | `60` | M0 AC 43 |
| `PDF_PAGE_LIMIT` | `20` | M1 open question — **assumption** |
| `UPLOADS_PER_HOUR` | `10` | M1 AC 17 — **assumption** |
| `LOW_CONFIDENCE_THRESHOLD` | `0.7` | M1 AC 26 — **assumption** |
| `EXTRACTION_TIMEOUT_MS` | `120_000` | M1 AC 27 — pending spike B |
| `EXTRACTION_MODEL` | `'claude-opus-5'` | research; no date suffix, ever |
| `EXTRACTION_EFFORT` | `'high'` | research §6 |
| `MAX_EXTRACTION_ATTEMPTS` | `3` | M1 AC 23/27 |
| `MAGIC_LINK_TTL_SECONDS` | `900` | M0 AC 4 |
| `HEIC_JPEG_QUALITY` | `0.85` | ADR-0004 |
| `AVATAR_IDS` | preset ids | M0 AC 29 |

`DIRECT_NOTICE_VERSION` deliberately lives **beside the notice copy**, not here,
so a copy edit and a version bump are the same diff.

### `RETENTION_POLICY` — one array, two consumers

```ts
export const RETENTION_POLICY = [
  { key: 'PRE_CONSENT',       purpose: '…', businessNeed: '…', windowDays: PRE_CONSENT_PURGE_DAYS,                          anchor: 'createdAt'   },
  { key: 'SOURCE_FILE',       purpose: '…', businessNeed: '…', windowDays: SOURCE_FILE_RETENTION_DAYS_AFTER_EXTRACTION,     anchor: 'extractedAt' },
  { key: 'EXTRACTED_TEXT',    purpose: '…', businessNeed: '…', windowDays: null, note: 'life of the ACTIVE profile' },
  { key: 'PROFILE_FIELDS',    purpose: '…', businessNeed: '…', windowDays: null, note: 'life of the ACTIVE profile' },
  { key: 'DIRECT_NOTICE',     purpose: '…', businessNeed: '…', windowDays: DELETION_AUDIT_RETENTION_DAYS, anchor: 'deletedAt' },
  { key: 'CONSENT_FULL',      purpose: '…', businessNeed: '…', windowDays: null, note: 'life of the ACTIVE profile' },
  { key: 'CONSENT_PSEUDONYM', purpose: '…', businessNeed: '…', windowDays: CONSENT_AUDIT_RETENTION_DAYS,  anchor: 'purgeAfter' },
  { key: 'ACCOUNT_SESSION',   purpose: '…', businessNeed: '…', windowDays: null },
  { key: 'CLOSED_ACCOUNT',    purpose: '…', businessNeed: '…', windowDays: ACCOUNT_CLOSURE_RECOVERY_DAYS, anchor: 'closureRequestedAt' },
  { key: 'DELETION_AUDIT',    purpose: '…', businessNeed: '…', windowDays: DELETION_AUDIT_RETENTION_DAYS, anchor: 'completedAt' },
] as const;
```

`app/retention/page.tsx` renders it (AC 44). `lib/jobs/enforce-retention.ts`
walks it (AC 45). A unit test asserts every `key` with a non-null `windowDays`
has a job step and vice versa, so the published policy cannot describe a window
nothing enforces — which is the §5-deception risk the research flags.

New environment variables (all server-only; **none** may be `NEXT_PUBLIC_`):
`AUTH_SECRET`, `AUTH_URL`, `AUTH_RESEND_KEY`, `EMAIL_FROM`,
`BLOB_READ_WRITE_TOKEN`, `ANTHROPIC_API_KEY`, `CRON_SECRET`,
**`CONSENT_METHOD`**, **`AUDIT_PSEUDONYM_KEY`**.

---

## 8. Dependency table — every one needs the owner's approval

Nothing here is installed. **Do not run an install command until the owner
approves.** pnpm only. **This revision adds no new dependencies** — `EMAIL_PLUS`
needs only `crypto.subtle` and the existing Resend `fetch` path.

| Package | Purpose | ADR | Needed for | Notes / risk |
|---|---|---|---|---|
| `next-auth@^5` | Sign-in, database sessions, magic-link provider | 0002 | **M0** | Long-running beta. `strategy: 'database'`; AC 5 is unachievable with JWT sessions |
| `@auth/prisma-adapter` | Auth.js ↔ Prisma | 0002 | **M0** | May not typecheck against the Prisma 7 generated client. Contingency: hand-write the `Adapter` interface (~15 functions). No `any` |
| `@vercel/blob@^2.8` | Private store, client-direct upload, signed URLs, `list`/`head`/`del` | 0003 | **M0** | Every signature unverified until §9 spike A. Confined to `lib/storage/vercel-blob.ts` |
| `@anthropic-ai/sdk` | Vision extraction with `messages.parse()` | 0005 | **M1** | Requires `ANTHROPIC_API_KEY`, server-only |
| `heic-to` | Browser HEIC → JPEG | 0004 | **M1** | Sizeable wasm decoder. **Dynamically imported only**. Fallback `heic2any` |
| `pdf-lib` | PDF page count | 0004 | **M1** | Dynamically imported client-side; also used server-side at confirm time |
| `katex` + `@types/katex` | Render extracted LaTeX | 0005 | **M1** | Used **server-side** via `renderToString`; only `katex.min.css` reaches the browser |
| `server-only` | Compile-time guard that the DAL never reaches a client bundle | 0006 | **M0** | ~1 KB, no transitive deps. Recommended for a children's-data codebase |
| `react-hook-form` + `@hookform/resolvers` | **Optional.** Only if we use shadcn's `form` component | — | M0 | **Recommend declining for M0.** Note the consent flow adds three more forms, so revisit if form code becomes unpleasant |

**Deferred, and each would be a new approval when its method is chosen
(ADR-0008):** a payment processor SDK for `PAYMENT_CARD` — *which also drags
billing into M0* — an SMS provider for `TEXT_PLUS`, or an identity vendor SDK
for `GOV_ID_CHECK` / `FMVPI` / `KBA`. Each also becomes a new named third party
in the direct notice (AC 13) and a new row in the vendor capability assessment
(AC 52).

Not dependencies: shadcn/ui components are source files copied by the CLI.

Not proposed, and deliberately so: no Redis or rate-limit service (the hourly cap
and the consent-verify limit are Postgres counts), no queue (extraction uses
`after()`), no mail SDK (`fetch` to Resend), no image-processing library on the
server, no `zod` (already installed at `^4.4.3`).

---

## 9. The spike

**Unchanged by this revision.** Nothing in the consent rework touches storage.

M0 blocking open question: **client-side `upload()` with `access: 'private'`
is unverified end to end.** If it fails, the storage design and all of M1
change. Nothing in M0 AC 34–43 or in M1 is written until spike A returns.

### Spike A — private blob, client-direct

**Timebox:** one day. **Branch:** `spike/private-blob`. **Merged artefacts:**
`docs/research/vercel-blob-verified.md` and a status change on ADR-0003. All
spike code is thrown away.

**Prerequisite:** owner approval for `@vercel/blob`.

**Setup** — the smallest thing that can answer the question:
1. `pnpm add @vercel/blob`.
2. Read `node_modules/@vercel/blob/dist/index.d.ts` and `client.d.ts`. Copy the
   **actual** signatures of `put`, `upload`, `handleUpload`, `head`, `list`,
   `del`, `get`, `issueSignedToken`, `presignUrl` into the research file. This
   step alone justifies the spike: every signature in the current research is
   doc-derived.
3. Create a **private** Blob store in the Vercel dashboard. Link it to a
   throwaway preview deployment, not to localhost — `onUploadCompleted` cannot
   fire against localhost.
4. One throwaway page and one throwaway `POST /api/spike/upload` calling
   `handleUpload` with `access: 'private'`,
   `allowedContentTypes: ['image/jpeg']`, `maximumSizeInBytes: 20 MB`,
   `addRandomSuffix: true`.

**Assertions.** Each is pass/fail and each is recorded.

| # | Assertion | Proves |
|---|---|---|
| S1 | A 6 MB JPEG uploads from the browser; DevTools shows bytes going to `*.blob.vercel-storage.com`, and no request to our own origin carries a body over 1 MB | **The question itself.** M1 AC 2 |
| S2 | `curl` the returned private URL with no credentials → status ≠ 200 and no bytes | M0 AC 40 |
| S3 | A `get`-signed URL with `validUntil = now + 60s` returns 200; after 61s it does not | M0 AC 41 |
| S4 | That same signed URL replayed as a `PUT` is rejected | M0 AC 42 |
| S5 | With the issued token, a 25 MB file and a `text/plain` file are both rejected and no object is created | M0 AC 38 |
| S6 | Two uploads of the same filename both succeed with distinct pathnames | M1 AC 9 |
| S7 | `onUploadCompleted` fires on the preview deployment and does **not** fire on localhost | M1 AC 14 — justifies the confirm route |
| S8 | `head(pathname)` on a private object returns real `contentType` and `size` server-side | endpoint 15's trust model |
| S9 | `list()` exposes `uploadedAt` per object and paginates by cursor | M0 AC 43 — the reconciler depends on both |

**If it fails**, the branch taken is determined by which assertion failed:

- **S1 or S2 fails** — private stores cannot accept browser uploads, or private
  URLs are readable. **Switch to Supabase Storage private buckets**
  (`createSignedUploadUrl` + `createSignedUrl`), the designated fallback in
  ADR-0003 and the research. Costs: `@supabase/supabase-js`, a second vendor,
  Pro plan from day one, **and a fifth name in the direct notice (AC 13) plus a
  fifth vendor assessment (AC 52)**. The Prisma schema, every route, every DTO
  and every component are unchanged, because only `lib/storage/vercel-blob.ts`
  is replaced by `lib/storage/supabase.ts` behind the same `StoragePort`.
  ADR-0003 is superseded by a new ADR; the plan is otherwise untouched. This is
  why the port lands in the shared phase and not in the backend track.
- **S3 or S4 fails** — signed URLs are unusable or replayable. Drop signed URLs
  entirely and **proxy preview bytes** through
  `GET /api/uploads/[uploadId]/preview` using server-side `get()`. M1 explicitly
  allows this. Endpoint 18 changes shape; nothing else does.
- **S5 fails** — provider-side constraints are not enforced. Re-verify size and
  type at confirm time via `head()` and delete violating objects immediately.
  AC 38 degrades from "the write is rejected" to "the object is deleted within
  seconds" and **must be renegotiated with the owner**, not silently accepted.
- **S7 behaves unexpectedly** — no change; the confirm route is already the
  primary path.
- **S9 fails** — the reconciler cannot use object age. Fall back to reconciling
  against `UploadTokenGrant` rows older than the threshold, and record the
  reduced guarantee: objects from a grant we never recorded become invisible,
  which is a real weakening of AC 43 and must be flagged to the owner.

### Spike B — extraction latency (smaller, runs in parallel, non-blocking)

**Prerequisite:** owner approval for `@anthropic-ai/sdk` and an
`ANTHROPIC_API_KEY`.

One script: call `messages.parse()` with the ADR-0005 schema against three
fixture worksheets at `effort: 'high'`, five times each, on a deployed preview
function. Record p50 and p95 wall clock and token usage. Set
`EXTRACTION_TIMEOUT_MS` from the measurement rather than from the guess.

**If p95 exceeds the function duration limit:** extraction moves out of
`after()` and into a queued background job. The status machine in §1 and the
polling endpoint (19) are already specified for exactly this, so the change is
confined to `lib/extraction/run-extraction.ts` and its trigger. Nothing else
moves. Lowering `effort` to `medium` is the cheaper mitigation to try first.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| **The consent method is undecided and depends on a legal question nobody has answered.** We may build `EMAIL_PLUS` and be told we may not use it | ADR-0008's provider interface. The write-off is bounded at roughly a day. **The legal question must be in front of counsel now, not at launch** |
| **If `PAYMENT_CARD` is chosen, billing enters M0** — a processor, a discrete charge, a refund path, a webhook, and a stated non-goal becomes a dependency | Flag it before any code is written. It is a scope decision, not an implementation detail |
| **A mail scanner could follow a confirmation link and grant parental consent** | The link opens a page; consent is a POST from an explicit control (ADR-0008 §5). This is why the flow is not a one-click GET |
| **The consent challenge token is a bearer credential that grants parental consent** | SHA-256 at rest, single use, 72-hour TTL, attempt counter, rate limit on the only public mutation in the app |
| **Email deliverability is now on the compliance path, not just the sign-in path.** A Resend outage stops parents completing consent | `DirectNotice` is written with `sentAt` null and retried by endpoint 28; consent is gated on the record, not on `sentAt`. **This is a deliberate reading of AC 14 and it should be confirmed:** the parent has seen the notice on screen, but if the email never lands we have not literally satisfied "the same notice content is emailed" |
| **A profile can be `ACTIVE` with a null display name** — the two-phase creation the spec requires | `StudentProfileDTO.displayName` is `string \| null` in the contract, `nextStep: 'PROFILE_DETAILS'` tells the UI what to render, and the dashboard has an explicit "finish setting up" state. **If the frontend assumes a string, this is a runtime crash on the happy path** |
| **The 14-day pre-consent purge silently destroys a family's half-finished signup** | Accepted; it is the point. A reminder email before the purge is a product decision, not a design one, and is not in this plan |
| **Cron on Hobby runs at most daily**, so "14 days" is really "14 days plus up to one cron interval", and the orphan threshold is not 60 minutes in practice | AC 46/48's 24-hour bound is still met; a tighter window needs Pro. An infrastructure decision the owner should make knowingly |
| **`verifiedAt` is a documented exception to append-only consent** | Conditional `WHERE verified_at IS NULL`, confined to `lib/consent/service.ts`, plus a reviewer grep for any other `parentalConsent.update` |
| **A §312.6 deletion request could be quietly routed into the closure queue by a well-meaning refactor** | Two routes, one destructor, `DeletionAudit.kind`, and a Vitest test asserting `closureRequestedAt` is *not* set and no cron run is required |
| **The published retention page could describe a window the code does not enforce** — a separate §5 deception risk per the research | One `RETENTION_POLICY` array drives both, with a test asserting the job covers every windowed category |
| Private client upload is unverified — the whole storage design rests on it | Spike A before any storage code; `StoragePort` makes a provider swap one file |
| `@auth/prisma-adapter` may not typecheck against Prisma 7's generated client | Hand-write the `Adapter` interface. **Never cast to `any`.** Detected on first install |
| A `high`-effort extraction may not fit inside the function duration | Spike B measures it; the status machine + lazy timeout means the failure is a `FAILED` with a retry |
| Prisma cascades delete rows without deleting blobs, silently creating orphans | Blob-first deletion (ADR-0007) plus the store-enumerating reconciler as backstop |
| iOS Safari may run out of memory decoding a 12 MP HEIC | Lazy import, a real error message, physical-device testing before M1 is done |
| A signed URL is a bearer credential; one leak into a log or cached HTML exposes a child's schoolwork | Minted only in endpoint 18 with `no-store`, held in client memory only, never server-rendered, 5-minute TTL, never logged |
| `Subject[]`/`ConsentScope[]` enum arrays under Prisma 7 are unproven here | Verified when the migration is generated, before it is applied. Fallback is `String[]` with a zod allowlist |
| Fixture-based extraction tests can imply accuracy we have not measured | Stated explicitly in §6 |
| A forgotten `userId` scope anywhere leaks a minor's data | Only `lib/auth/dal.ts` may load student-owned rows; a reviewer audits one file plus a grep for handlers that bypass it |
| **`docs/security-program.md` has no owner and is an acceptance criterion** | AC 51 needs a *named person*. Nothing an engineer writes satisfies it. Raise it with the owner in the same conversation as the dependency approvals |

---

## 11. Needs approval before any code is written

**Dependencies** (§8): `next-auth@^5`, `@auth/prisma-adapter`, `@vercel/blob`,
`@anthropic-ai/sdk`, `heic-to`, `pdf-lib`, `katex` + `@types/katex`,
`server-only`. Optional and currently recommended *against* for M0:
`react-hook-form` + `@hookform/resolvers`. **No new dependency is introduced by
this revision.**

**Migration:** `0001_m0_m1_core` — creation only, **not destructive**, on a
database with zero models today. No previously applied migration is edited,
because none has been applied.

**Decisions still open** — the build proceeds because each is configuration or
is behind the ADR-0008 interface, but each is currently a guess:

1. **LEGAL, blocking for public launch.** Is sending a child's schoolwork to
   Anthropic a "disclosure" under §312.2? It selects the available consent
   methods and therefore the cost per parent.
2. **PRODUCT, blocking before M0 is done.** Which consent method ships first?
   **If `PAYMENT_CARD`, billing enters M0.**
3. **PRODUCT, blocking for AC 51.** Who is the named information-security
   coordinator, and who writes `docs/security-program.md`?
4. **PRODUCT, blocking before any child data flows.** Is children's data ever
   used to train, fine-tune or evaluate any model? Write the answer down.
5. **LEGAL.** How long may a pseudonymised consent artifact be retained after
   deletion? Currently `CONSENT_AUDIT_RETENTION_DAYS = 0`.
6. **LEGAL.** Are we mixed-audience or child-directed? It decides whether the
   FTC's age-verification policy statement shelters the pre-consent age gate.
7. **PRODUCT.** Pre-consent purge window — assumed 14 days.
8. **PRODUCT.** Source-file retention — assumed 14 days after successful
   extraction. (M1's spec was revised on 2026-08-26 and now points at M0's
   retention table rather than restating a figure, so this is settled in
   structure — only the number itself is still an assumption.)
9. **PRODUCT.** PDF page limit (20), hourly upload cap (10).
10. **INFRASTRUCTURE.** Vercel plan, which sets the achievable cron frequency and
    whether Private Blob is available on Hobby at all.

**One thing this plan does not do and cannot:** confirm that the
`ConsentMethod` enum labels match the actual enumerated methods in
§312.5(b)(2). The research inferred the subsection lettering from search
summaries and says so. Someone must read eCFR before those labels appear in
anything a parent or a regulator reads.
