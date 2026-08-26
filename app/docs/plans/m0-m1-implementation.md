# Implementation plan: M0 (accounts, profiles, consent, storage) + M1 (upload and extract)

- **Status:** Proposed — awaiting owner approval. No code has been written.
- **Date:** 2026-08-26
- **Author:** architect agent
- **Specs:** [m0-accounts-and-profiles.md](../specs/m0-accounts-and-profiles.md) (36 AC),
  [m1-upload-and-extract.md](../specs/m1-upload-and-extract.md) (36 AC)
- **ADRs:** [0002](../adr/0002-passwordless-auth-with-authjs-and-database-sessions.md) auth ·
  [0003](../adr/0003-private-vercel-blob-with-client-direct-upload.md) storage ·
  [0004](../adr/0004-client-side-heic-conversion-with-lazy-loaded-heic-to.md) HEIC ·
  [0005](../adr/0005-extracted-problem-model-and-structured-output-contract.md) extraction ·
  [0006](../adr/0006-route-handlers-for-mutations-not-server-actions.md) API surface ·
  [0007](../adr/0007-deletion-order-append-only-consent-and-store-enumerating-reconciliation.md) deletion

---

## 0. Read this first

Three things gate everything below.

1. **The spike in §9 must run before any of M0 AC 25–36 or any of M1 is built.**
   Every Vercel Blob signature in the research is documentation-derived. Both
   specs mark this BLOCKING.
2. **Seven new dependencies need the owner's approval (§8).** Nothing is
   installed and nothing will be installed until then.
3. **Six answers are needed from the owner (§10)** — some are product decisions,
   two are legal. The build is not blocked on most of them because they are
   configuration, but they are guesses until answered.

The whole design rests on one rule: **a student profile id in a URL is not
authorization.** Every query touching student data resolves through
`requireStudentProfile(id)`, which is
`db.studentProfile.findFirst({ where: { id, userId: session.user.id } })`. There
is no other way to load a profile in server code.

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

enum StudentProfileStatus {
  CONSENT_REQUIRED
  ACTIVE
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
  adultAttestedAt      DateTime?

  /// AC 36: soft delete. Sign-in is refused while this is set and the grace period is live.
  deletionRequestedAt  DateTime?

  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  accounts        Account[]
  sessions        Session[]
  studentProfiles StudentProfile[]
  consentsGiven   ParentalConsent[]

  @@index([deletionRequestedAt])
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

/// AC 5 / AC 36: sessions are rows, so sign-out and account deletion revoke server-side.
model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

/// AC 4: Auth.js deletes the row on redemption (single use); maxAge 15 min sets expiry.
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
  displayName String               // 1–40 chars, enforced by zod at the boundary (AC 9)
  gradeLevel  GradeLevel
  ageBand     AgeBand
  subjects    Subject[]            // 1–8, enforced by zod (AC 11)
  avatarId    String               // preset id from AVATAR_IDS; never an uploaded image (AC 12)
  status      StudentProfileStatus @default(CONSENT_REQUIRED)
  createdAt   DateTime             @default(now())
  updatedAt   DateTime             @updatedAt

  user     User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  consents ParentalConsent[]
  uploads  Upload[]
  grants   UploadTokenGrant[]

  @@index([userId, createdAt])
}

/// APPEND-ONLY (ADR-0007). Never updated, never deleted while the account lives.
/// Withdrawal appends a new row with withdrawnAt set; the prior row is unchanged (AC 23).
model ParentalConsent {
  id                  String              @id @default(cuid())
  studentProfileId    String
  /// The signed-in adult who performed the action, kept for auditability.
  userId              String
  consentingAdultName String
  relationship        ConsentRelationship
  scopes              ConsentScope[]
  consentTextVersion  String              // e.g. "2026-08-26.1" — a new wording is a new version
  grantedAt           DateTime            @default(now())
  withdrawnAt         DateTime?
  ipAddress           String?
  userAgent           String?

  studentProfile StudentProfile @relation(fields: [studentProfileId], references: [id], onDelete: Cascade)
  user           User           @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([studentProfileId, grantedAt])
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
  /// Storage PATHNAME, never a fully-qualified URL (AC 29). Unique → confirm is idempotent (M1 AC 15).
  pathname         String       @unique
  /// contentType and sizeBytes come from storage.head(), never from the client.
  contentType      String
  sizeBytes        Int
  originalFilename String
  pageCount        Int?         // PDFs only; null for images
  status           UploadStatus @default(PENDING)
  sourceDeletedAt  DateTime?
  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt

  studentProfile StudentProfile @relation(fields: [studentProfileId], references: [id], onDelete: Cascade)
  extraction     Extraction?

  @@index([studentProfileId, createdAt])
  @@index([status, createdAt])
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

/// AC 36: must SURVIVE the purge, so there is deliberately no relation to User and
/// deliberately no email, name, or anything about the child. (ADR-0007)
model AccountDeletionAudit {
  id          String    @id @default(cuid())
  userId      String
  requestedAt DateTime  @default(now())
  completedAt DateTime?

  @@index([userId])
  @@index([completedAt])
}
```

### Non-obvious modelling choices, explained

| Choice | Why |
|---|---|
| `AgeBand` enum, no date of birth | AC 17 keys off an age band; the spec's "Never stored" list forbids day-precision DOB. `ADULT` → AC 22's immediate `ACTIVE`. |
| `subjects Subject[]` (Postgres enum array) | Multi-select 1–8 with no join table. Cardinality is enforced by zod at the boundary (AC 11), because the database cannot express "1 to 8". |
| `avatarId String`, not an enum | The preset set is app-bundled artwork that will change more often than a migration should. zod validates against `AVATAR_IDS`, so a bad value is still a 400 (AC 12). No file input exists anywhere. |
| `ParentalConsent` append-only, plus `StudentProfile.status` | AC 23 requires the prior row to be unchanged. Status is the denormalised cache of "latest non-withdrawn row exists", written in the same transaction as the append. |
| `scopes ConsentScope[]` + `consentTextVersion` | Two independent version axes. M6 adds an enum value and writes a new row — no backfill, no migration of existing rows. |
| `ParentalConsent.userId` alongside `studentProfileId` | Records *which adult* acted, which is the evidentiary point. Survives as long as the account does. |
| `Upload.pathname @unique` | The idempotency key. The confirm route and `onUploadCompleted` both call the same upsert, so double delivery yields one row (M1 AC 15). |
| `Upload.contentType` / `sizeBytes` from `head()` | Client claims are untrusted. Recording provider truth also proves the object exists, so a record cannot be fabricated for a pathname with no bytes. |
| `UploadTokenGrant` | The only way to rate limit the *token* endpoint (M1 AC 17), which is where a 429 is required. Counting `Upload` rows would miss tokens that were issued and never confirmed. |
| `@@unique([extractionId, ordinal])` with no renumbering | Deleting #3 of 5 leaves 1, 2, 4, 5 — stable and non-colliding (M1 AC 29). The UI shows `label` or the list index, never the raw ordinal. |
| `Extraction.failureCode` as `String?` | An internal code, mapped through a fixed lookup to a user-facing message. Keeps AC 24's leak boundary in one place. |
| `AccountDeletionAudit` with no FK | A foreign key would cascade it away during the purge it exists to record (AC 36). |
| `Account` model retained | Required by `@auth/prisma-adapter` to compile. Unused in M0. |

**Migration:** `0001_m0_m1_core`, created with `pnpm db:migrate` against the local
`prisma dev` database. **Destructive: no.** The database currently has zero
models, so this is pure creation — no drops, no renames, no data loss. Applied to
Neon afterwards with `pnpm db:migrate:prod`. Do not add it to the Vercel build
command (runbook §4).

**Risk to check at migrate time:** `Subject[]` and `ConsentScope[]` are Postgres
enum arrays under Prisma 7. If the generated SQL or client surprises us, the
fallback is `String[]` with a zod-validated allowlist, decided before the
migration is applied — never after.

---

## 2. The typed error shape (defined once)

`lib/errors.ts` — imported by every route handler, every server action and the
client fetch wrapper. Nothing defines its own error type.

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
`where: { …, userId: session.user.id }` (404 otherwise). **Cron** = `Authorization:
Bearer ${CRON_SECRET}` (401 otherwise). **Provider** = the storage provider's
signed callback, verified by the SDK.

All responses carry `Cache-Control: no-store`. All non-GET handlers perform a
same-origin `Origin` check inside `withAuth()` (ADR-0006).

Shared DTOs live in `lib/schemas/dto.ts` and are the only shapes crossing the
boundary:

```ts
type StudentProfileDTO = {
  id: string; displayName: string; gradeLevel: GradeLevel; ageBand: AgeBand;
  subjects: Subject[]; avatarId: string; status: StudentProfileStatus;
  consentRequired: boolean; createdAt: string;
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

`Upload.pathname` **never** appears in a DTO, in HTML, or in any client payload.

### 3.1 Server actions (exactly two — ADR-0002/0006)

| Action | Module | Auth | Input (zod) | Success | Error |
|---|---|---|---|---|---|
| `signInWithEmail` | `lib/auth/actions.ts` | none | `z.object({ email: z.email(), isAdult: z.literal(true) })` | `{ ok: true, data: { sent: true } }`, then `redirect('/sign-in/sent')` | `{ ok: false, error: ApiError }` with `VALIDATION_ERROR` or `RATE_LIMITED`. Identical response for known and unknown addresses (AC 2). |
| `signOutSession` | `lib/auth/actions.ts` | Session | `z.object({})` | deletes the `Session` row, then `redirect('/')` | never throws to the client |

### 3.2 Route handlers

| # | Route | Method | Auth | Input (zod) | Success | Error |
|---|---|---|---|---|---|---|
| 1 | `/api/auth/[...nextauth]` | GET, POST | — | Auth.js internal | Auth.js internal | Auth.js internal; `pages.error = '/sign-in/error'` (AC 4) |
| 2 | `/api/students` | POST | Session | `{ displayName: z.string().trim().min(1).max(40), gradeLevel: z.enum(GradeLevel), ageBand: z.enum(AgeBand), subjects: z.array(z.enum(Subject)).min(1).max(8).refine(unique), avatarId: z.enum(AVATAR_IDS) }` | `201 { ok:true, data:{ student: StudentProfileDTO } }` — status is `ACTIVE` when `ageBand === ADULT`, else `CONSENT_REQUIRED` (AC 17/22) | 400 `VALIDATION_ERROR` + `fieldErrors` (AC 9/10/11/12) · 401 |
| 3 | `/api/students/[studentId]` | GET | Owner | — | `200 { student: StudentProfileDTO }` | 401 · 404 (AC 14/15) |
| 4 | `/api/students/[studentId]` | PATCH | Owner | same object as #2, all keys `.optional()`, `.strict()`, at least one key | `200 { student: StudentProfileDTO }` (AC 13) | 400 · 401 · 404 (AC 15) |
| 5 | `/api/students/[studentId]` | DELETE | Owner | — | `200 { deleted: true }` — blobs deleted before rows (ADR-0007), cascades take consents/uploads/extractions/problems (AC 35, M1 AC 35) | 401 · 404 · 502 `UPSTREAM_ERROR` if storage deletion fails (rows retained, retryable) |
| 6 | `/api/students/[studentId]/consent` | POST | Owner | `{ consentingAdultName: z.string().trim().min(1).max(80), relationship: z.enum(ConsentRelationship), consentTextVersion: z.string().max(32), scopes: z.array(z.enum(ConsentScope)).min(1).refine(includes DATA_PROCESSING), affirmed: z.literal(true) }` | `201 { student: StudentProfileDTO }` with `status: ACTIVE` (AC 19/20). IP and user agent are read **server-side** from headers and are never accepted from the body. | 400 (incl. stale `consentTextVersion` → `CONFLICT` 409) · 401 · 404 |
| 7 | `/api/students/[studentId]/consent/withdraw` | POST | Owner | `{ confirm: z.literal(true) }` | `201 { student: StudentProfileDTO }` with `status: CONSENT_REQUIRED`; **appends** a new row with `withdrawnAt`, prior row untouched (AC 23) | 400 · 401 · 404 · 409 if already `CONSENT_REQUIRED` |
| 8 | `/api/account/deletion` | POST | Session | `{ confirm: z.literal(true) }` | `202 { deletionRequestedAt, purgeAfter }` — sets `deletionRequestedAt`, deletes all `Session` rows, writes `AccountDeletionAudit` (AC 36) | 400 · 401 · 409 if already requested |
| 9 | `/api/blob/upload` | POST | Session (client-token event) / Provider (`upload-completed` event) | body discriminated on `type`. For `blob.generate-client-token`, `clientPayload` is `{ studentProfileId: z.cuid(), originalFilename: z.string().min(1).max(255) }`; the proposed pathname must match `^students/<authorizedId>/uploads/[A-Za-z0-9-]+\.[a-z0-9]+$` | `200` with the provider's token JSON. Constraints returned: `access:'private'`, `allowedContentTypes:['image/jpeg','image/png','image/webp','application/pdf']`, `maximumSizeInBytes: 20_971_520`, `addRandomSuffix:true` (AC 27) | 400 · **401** with no token anywhere in the body (AC 25) · **403** cross-account (AC 26, M1 AC 12) · **403** profile not `ACTIVE` (AC 30, AC 24, M1 AC 11) · **429** hourly cap (M1 AC 17) |
| 10 | `/api/uploads/confirm` | POST | Owner (of `studentProfileId`) | `{ studentProfileId: z.cuid(), pathname: z.string().max(512), originalFilename: z.string().min(1).max(255) }` | `201 { upload: UploadDTO, extractionId }` on first call; `200` with the same body on repeat (M1 AC 15). Server calls `head(pathname)` for `contentType`/`sizeBytes`; PDFs are page-counted and rejected above the limit. Schedules extraction with `after()`. | 400 · 401 · 403 pathname outside the caller's namespace · 404 object not found in store · **409 `VALIDATION_ERROR` PDF page limit (M1 AC 10)** · 415 → returned as 400 for a disallowed content type |
| 11 | `/api/uploads/[uploadId]` | GET | Owner (via `upload.studentProfile.userId`) | — | `200 { upload: UploadDTO, extraction: ExtractionDTO \| null }` | 401 · **404** cross-account (M1 AC 33) |
| 12 | `/api/uploads/[uploadId]` | DELETE | Owner | — | `200 { deleted: true }` — marks `SOURCE_DELETED`, deletes the blob, then deletes the row and cascades (M1 AC 34) | 401 · 404 · 502 |
| 13 | `/api/uploads/[uploadId]/preview-url` | GET | Owner | — | `200 { url, expiresAt }` where `expiresAt - now <= 5 min` (AC 32, M1 AC 32). `Cache-Control: no-store`. This is the only place a signed URL is ever emitted. | 401 · 404 · 409 if `status === SOURCE_DELETED` |
| 14 | `/api/extractions/[extractionId]` | GET | Owner | — | `200 { extraction: ExtractionDTO, problems: ExtractedProblemDTO[] }`. Polled every 2s while non-terminal. Lazily transitions a stale `RUNNING` to `FAILED`/`TIMEOUT` (M1 AC 27). | 401 · 404 (M1 AC 33) |
| 15 | `/api/extractions/[extractionId]/retry` | POST | Owner | `{}` | `202 { extraction: ExtractionDTO }` with `status: PENDING`, `attemptCount + 1` | 401 · 404 · 409 if status is not `FAILED` · 429 above `MAX_EXTRACTION_ATTEMPTS` |
| 16 | `/api/extractions/[extractionId]/confirm` | POST | Owner | `{ confirm: z.literal(true) }` | `200 { extraction: ExtractionDTO }` with `status: CONFIRMED` — the M2 handoff point (M1 AC 30) | 400 · 401 · 404 · 409 unless status is `COMPLETE` |
| 17 | `/api/extractions/[extractionId]/problems/[problemId]` | PATCH | Owner | `{ text: z.string().trim().min(1).max(2000) }` | `200 { problem: ExtractedProblemDTO }` with `studentCorrected: true` (M1 AC 28) | 400 · 401 · 404 |
| 18 | `/api/extractions/[extractionId]/problems/[problemId]` | DELETE | Owner | — | `200 { deleted: true }`. Ordinals of the survivors are **not** renumbered (M1 AC 29). | 401 · 404 |
| 19 | `/api/cron/reconcile-blobs` | GET | Cron | — | `200 { scanned, orphansDeleted, uploadsFailed, grantsPruned }` (AC 34, M1 AC 16) | 401 · 502 |
| 20 | `/api/cron/purge-accounts` | GET | Cron | — | `200 { purged }` (AC 36) | 401 · 502 |
| 21 | `/api/cron/enforce-retention` | GET | Cron | — | `200 { sourceFilesDeleted }` (M1 AC 36) | 401 · 502 |

**Totals: 20 application endpoints across 17 route files, plus the Auth.js
catch-all, plus 2 server actions.**

Two contract rules the parallel tracks must not renegotiate:

1. **404 vs 403.** Cross-account access is always **404** — a profile, upload or
   extraction belonging to someone else is indistinguishable from one that does
   not exist. **403** is used only when the caller genuinely owns the resource
   but the operation is barred (a `CONSENT_REQUIRED` profile requesting an
   upload token).
2. **Failure messages** returned to the browser come from a fixed allowlist in
   `lib/errors.ts`. No exception text, model identifier, provider payload or
   stack trace is ever placed in a response body (M1 AC 24).

---

## 4. Component tree

Server components are the default. Every `"use client"` below has a stated
reason, and none of them import `@/lib/db`.

```
app/layout.tsx                                        server   root shell, katex.min.css
app/page.tsx                                          server   landing; link to /sign-in
proxy.ts                                              (edge)   OPTIMISTIC cookie-presence redirect only.
                                                               Never the authorization boundary (ADR-0002).

app/(auth)/
  sign-in/page.tsx                                    server   renders the form; already-signed-in → /dashboard
    components/auth/sign-in-form.tsx                  CLIENT   useActionState for pending/field errors and the
                                                               18+ checkbox; needs interactivity (AC 2, AC 6)
  sign-in/sent/page.tsx                               server   static "check your email"; identical for known and
                                                               unknown addresses (AC 2)
  sign-in/error/page.tsx                              server   expired or already-used link (AC 4)

app/(app)/layout.tsx                                  server   nav shell. Does NOT gate access — Next 16 docs warn
                                                               layouts do not re-render on navigation and do not
                                                               control whether children render. Each page calls the DAL.
    components/nav/user-menu.tsx                      CLIENT   dropdown + sign-out form action; menu open state

  dashboard/page.tsx                                  server   requireUser() → profiles scoped by userId (AC 7/16)
    components/students/student-card.tsx              server   name, grade, subjects, avatar, "action needed" badge (AC 17)
    components/students/delete-student-dialog.tsx     CLIENT   confirm dialog + DELETE + router.refresh() (AC 14)

  students/new/page.tsx                               server   shell
  students/[studentId]/edit/page.tsx                  server   loads via requireStudentProfile → 404s cross-account (AC 15)
    components/students/student-form.tsx              CLIENT   controlled multi-field form, live validation, submit
                                                               state, POST/PATCH (AC 8/9/13)
    components/students/avatar-picker.tsx             CLIENT   selection state over AVATAR_IDS. Renders <button>s only —
                                                               NO file input exists anywhere in the tree (AC 12)
    components/students/subject-multiselect.tsx       CLIENT   1–8 selection state (AC 11)

  students/[studentId]/consent/page.tsx               server   renders the versioned consent copy server-side (AC 18)
    components/consent/consent-text.tsx               server   the disclosure itself; CONSENT_TEXT_VERSION lives beside it
    components/consent/consent-form.tsx               CLIENT   name, relationship, affirm checkbox, submit (AC 19/21)
  students/[studentId]/consent/withdraw/page.tsx      server   shell
    components/consent/withdraw-consent-form.tsx      CLIENT   confirm + POST (AC 23)

  students/[studentId]/page.tsx                       server   student home; upload list; blocks the CTA when
                                                               status is CONSENT_REQUIRED (M1 AC 11)
    components/uploads/upload-list.tsx                server   uploads + extraction status per row

  students/[studentId]/uploads/new/page.tsx           server   shell; passes status and limits as props
    components/uploads/upload-panel.tsx               CLIENT   the whole reason client-direct upload exists: file input
                                                               with capture, magic-byte sniff, lazy HEIC convert, lazy
                                                               PDF page count, upload() with onUploadProgress, confirm
                                                               call, error states (M1 AC 1–11)

  students/[studentId]/uploads/[uploadId]/page.tsx    server   results page; loads upload + extraction + problems
    components/uploads/extraction-status.tsx          CLIENT   polls GET /api/extractions/[id] until terminal (M1 AC 18)
    components/uploads/problem-list.tsx               server   renders LaTeX with katex.renderToString — no KaTeX JS
                                                               ships to the browser (M1 AC 21, ADR-0005)
    components/uploads/problem-row-actions.tsx        CLIENT   inline edit textarea + delete (M1 AC 28/29)
    components/uploads/low-confidence-badge.tsx       server   flag below LOW_CONFIDENCE_THRESHOLD (M1 AC 26)
    components/uploads/upload-preview.tsx             CLIENT   fetches the signed URL on demand and holds it in memory
                                                               only; never server-rendered into HTML (M1 AC 31/32)
    components/uploads/confirm-extraction-button.tsx  CLIENT   POST confirm → CONFIRMED (M1 AC 30)
    components/uploads/empty-extraction.tsx           server   "we could not find any problems" + retake (M1 AC 25)

  settings/page.tsx                                   server   account
    components/account/delete-account-dialog.tsx      CLIENT   typed confirmation + POST (AC 36)
```

shadcn/ui components to add via the CLI (source copied into `components/ui/`,
not dependencies): `input`, `label`, `checkbox`, `select`, `card`, `dialog`,
`alert`, `badge`, `progress`, `textarea`, `skeleton`, `sonner`. `button` already
exists.

**Client components never import `@/lib/db`.** Prisma enum values reach the
browser through `@/lib/generated/prisma/enums`, the generated browser-safe
entrypoint, re-exported from `lib/domain/enums.ts`.

---

## 5. File-by-file implementation order

### 5.0 Shared — must land before the tracks split

These are the contract. Both engineers import them; neither may edit them
without re-agreeing the contract.

| # | File | What |
|---|---|---|
| S1 | *(the spike, §9)* | Confirms or replaces ADR-0003 before anything below is written |
| S2 | `prisma/schema.prisma` + `pnpm db:migrate` | §1 verbatim → migration `0001_m0_m1_core` |
| S3 | `lib/errors.ts` | `ApiError`, `ApiResult`, `ERROR_STATUS`, the user-facing message allowlist |
| S4 | `lib/config.ts` | Every tunable in §7. No literals anywhere else. |
| S5 | `lib/domain/enums.ts` | `AVATAR_IDS`, label maps, re-exports from `lib/generated/prisma/enums` |
| S6 | `lib/schemas/*.ts` | Every zod input schema in §3, one file per resource |
| S7 | `lib/schemas/dto.ts` | The four DTO types in §3 |
| S8 | `lib/storage/port.ts` | `StoragePort` interface + `ClientUploadPolicy` (ADR-0003) |

After S8, `pnpm typecheck` passes with no runtime code. The tracks then run in
parallel.

### 5.1 Backend track

| # | File | What |
|---|---|---|
| B1 | `lib/auth/config.ts` | `NextAuth({ adapter, session: { strategy:'database' }, providers:[magicLink], callbacks:{ signIn }, pages })`; 15-minute `maxAge`; soft-delete refusal |
| B2 | `lib/email/send-magic-link.ts` | `fetch` to the Resend API; console output in non-production |
| B3 | `app/api/auth/[...nextauth]/route.ts` | Auth.js handlers |
| B4 | `lib/auth/dal.ts` | `import 'server-only'`; cached `verifySession`, `requireUser`, `requireStudentProfile`, `requireUpload`, `requireExtraction` — every one scoped by `userId` |
| B5 | `lib/auth/actions.ts` | `signInWithEmail` (writes `AdultAttestation`, then `signIn`), `signOutSession` |
| B6 | `proxy.ts` | Optimistic cookie redirect; matcher excludes `_next`, static assets and `/api/*` |
| B7 | `lib/api/handler.ts` | `withAuth()`: session, same-origin check, zod parse, error→status mapping, `no-store` |
| B8 | `app/api/students/route.ts`, `app/api/students/[studentId]/route.ts` | Endpoints 2–5 |
| B9 | `lib/consent/service.ts` + `app/api/students/[studentId]/consent/route.ts` + `.../withdraw/route.ts` | Endpoints 6–7; append + status update in one transaction |
| B10 | `app/api/account/deletion/route.ts` | Endpoint 8 |
| B11 | `lib/storage/vercel-blob.ts` | The `StoragePort` implementation, written against the **verified** signatures from the spike |
| B12 | `lib/uploads/rate-limit.ts` + `app/api/blob/upload/route.ts` | Endpoint 9; `UploadTokenGrant` write, hourly cap, pathname assertion |
| B13 | `lib/uploads/record-upload.ts` + `app/api/uploads/confirm/route.ts` | Endpoint 10; idempotent upsert on `pathname` (catch P2002 → re-read), `head()` verification, PDF page count, `after()` scheduling |
| B14 | `app/api/uploads/[uploadId]/route.ts`, `.../preview-url/route.ts` | Endpoints 11–13; blob-first deletion |
| B15 | `lib/ai/client.ts`, `lib/ai/extraction-schema.ts`, `lib/ai/prompt.ts` | Anthropic client with `timeout` and `maxRetries: 0`; the zod contract from ADR-0005; the extraction prompt |
| B16 | `lib/extraction/run-extraction.ts` | Status machine, refusal/null/timeout handling, single-transaction terminal write |
| B17 | `app/api/extractions/[extractionId]/route.ts`, `/retry`, `/confirm`, `/problems/[problemId]` | Endpoints 14–18 |
| B18 | `lib/jobs/reconcile-blobs.ts`, `purge-accounts.ts`, `enforce-retention.ts` | Pure functions taking a `StoragePort`, so they are unit-testable with a fake |
| B19 | `app/api/cron/*/route.ts` ×3 + `vercel.json` | Endpoints 19–21 |
| B20 | `.env.example`, `docs/runbook.md` | New env vars and the cron/job operations section |

### 5.2 Frontend track

| # | File | What |
|---|---|---|
| F1 | `components/ui/*` | shadcn CLI adds (§4 list) |
| F2 | `lib/api/client.ts` | `apiFetch<T>(): Promise<ApiResult<T>>` — the only place `ApiError` is unwrapped |
| F3 | `app/(auth)/sign-in/**` + `components/auth/sign-in-form.tsx` | AC 1–6 |
| F4 | `app/(app)/layout.tsx` + `components/nav/user-menu.tsx` | Shell and sign-out |
| F5 | `app/(app)/dashboard/page.tsx` + `student-card.tsx` + `delete-student-dialog.tsx` | AC 7, 14, 16, 17 |
| F6 | `components/students/{student-form,avatar-picker,subject-multiselect}.tsx` + new/edit pages | AC 8, 9, 12, 13 |
| F7 | `components/consent/*` + consent pages | AC 18–23 |
| F8 | `app/(app)/students/[studentId]/page.tsx` + `upload-list.tsx` | M1 AC 11 gating |
| F9 | `lib/uploads/sniff.ts`, `convert-heic.ts`, `pdf-page-count.ts`, `client-validate.ts` | **Pure, no React, no network** — the highest-value unit tests in M1 (M1 AC 4, 5, 6, 7, 10) |
| F10 | `components/uploads/upload-panel.tsx` | M1 AC 1–9 |
| F11 | `app/(app)/students/[studentId]/uploads/[uploadId]/page.tsx` + the six result components | M1 AC 18, 21, 25, 26, 28, 29, 30, 31 |
| F12 | `app/(app)/settings/page.tsx` + `delete-account-dialog.tsx` | AC 36 UI |

F9 can start on day one — it depends only on S4 and browser APIs — and is the
right first frontend task while auth is still being wired.

### 5.3 Typecheck order

`schema → generated enums → lib/schemas + lib/errors + lib/config → lib/storage
port → server (dal, handler, routes) → UI`. Each step compiles on its own.
Frontend F2–F12 depend only on S3, S5, S6, S7 — never on backend files — which
is what makes the split real.

---

## 6. Verification plan

### Covered by Vitest (unit and integration, Node environment, real local Postgres)

Route handlers are imported and called directly with a stubbed session, so the
status-code criteria are asserted literally rather than through a browser.

| Area | Criteria |
|---|---|
| zod input schemas | M0 9, 10, 11, 12 |
| Ownership scoping (A cannot touch B) | M0 15, 16, 26 · M1 12, 33 |
| Consent state machine and append-only semantics | M0 17, 19, 20, 21, 22, 23, 24 |
| Upload-token authorization and limits | M0 25, 27, 30 · M1 17 |
| Confirm idempotency and `head()`-derived fields | M1 13, 15 |
| PDF page limit rejection | M1 10 |
| Magic-byte HEIC sniffer (hand-built `Uint8Array` fixtures) | M1 4 |
| Client validation helpers (size, type) | M1 6, 7 |
| Extraction handling with a mocked Anthropic client | M1 18, 19, 20, 21, 22, 23, 24, 25, 27 |
| Ordinal stability after delete | M1 29 |
| Extraction confirm transition | M1 30 |
| Reconciler / purge / retention against a fake `StoragePort` | M0 34, 35, 36 · M1 16, 34, 35, 36 |
| Error-shape conformance (one helper, every handler) | M0 10 · M1 17, 24 |
| Signed-URL TTL arithmetic (`expiresAt - now <= 5 min`) | M0 32 · M1 32 |

### Covered by Playwright

| Area | Criteria |
|---|---|
| Signed-out `/dashboard` redirect, no data in the body | M0 1 |
| Sign-in email flow — the token is read from `VerificationToken` in a fixture, no mail server | M0 2, 3, 4, 5 |
| 18+ attestation blocks submission and writes no `User` row | M0 6 |
| Empty dashboard, add/edit/delete a profile end to end | M0 7, 8, 13, 14 |
| No file input in the avatar picker DOM | M0 12 |
| Consent flow renders, grants, and flips the badge | M0 18, 20 |
| Upload screen: `accept` attribute, camera option, disabled when `CONSENT_REQUIRED` | M1 1, 11 |
| **Byte routing** — `page.on('request')` asserts a request to `*.blob.vercel-storage.com` and no same-origin request body over 1 MB | M1 2 |
| HEIC upload stores a JPEG; HEIC renamed `.jpg` still converts | M1 3, 4 |
| No HEIC chunk requested for a JPEG upload | M1 5 |
| Oversize and wrong-type rejection messages | M1 6, 7 |
| Progress indicator reaches 100% | M1 8 |
| Retry after a simulated network abort succeeds | M1 9 |
| Persistence without the provider callback (localhost) | M1 14 |
| Low-confidence flag, edit, delete, confirm | M1 26, 28, 29, 30 |

### Not automatically testable — stated plainly rather than implied

- **M0 AC 3 (`Secure` flag).** Playwright runs over HTTP locally. We assert
  `HttpOnly` and `SameSite=Lax` in e2e and assert the production cookie name is
  `__Secure-authjs.session-token` in a config unit test. **The `Secure` flag
  itself is verified manually once on a preview deployment.**
- **M0 AC 28, 31, 33.** These test the storage *provider*, not our code — that a
  25 MB write is rejected, that an unauthenticated fetch of a private URL fails,
  that a `get`-signed URL cannot be replayed as a `put`. They are proven once in
  the spike (§9 S2, S4, S5) and re-run by an integration test that **skips
  unless `BLOB_READ_WRITE_TOKEN` is present**, so CI does not silently claim
  coverage it does not have.
- **M0 AC 34/35/36 and M1 AC 16/36, end to end.** The job *logic* is fully unit
  tested against a fake `StoragePort`. Real blob deletion and the "within 24
  hours" guarantee depend on Vercel Cron and are verified by one manual
  rehearsal on a preview deployment. **Cron scheduling itself is not testable.**
- **M0 AC 2 (non-disclosure of account existence).** We assert byte-identical
  responses and identical redirects for a known and an unknown address. **A
  timing side channel is not tested.**
- **M0 AC 18 ("plain language").** Not machine-checkable. A snapshot test pins
  the text against `CONSENT_TEXT_VERSION` so it cannot change silently; a human
  must read it.
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
nowhere else.

| Constant | Value | Source |
|---|---|---|
| `MAX_UPLOAD_BYTES` | `20 * 1024 * 1024` | M0 AC 27 (product assumption) |
| `ALLOWED_UPLOAD_CONTENT_TYPES` | `['image/jpeg','image/png','image/webp','application/pdf']` | M0 AC 27 |
| `ACCEPTED_PICKER_TYPES` | the above + `image/heic`, `image/heif` | M1 AC 1 |
| `SIGNED_URL_TTL_MS` | `5 * 60_000` | M0 AC 32 (product assumption) |
| `ORPHAN_THRESHOLD_MINUTES` | `60` | M0 AC 34 |
| `PDF_PAGE_LIMIT` | `20` | M1 open question — **assumption** |
| `UPLOADS_PER_HOUR` | `10` | M1 AC 17 — **assumption** |
| `LOW_CONFIDENCE_THRESHOLD` | `0.7` | M1 AC 26 — **assumption** |
| `EXTRACTION_TIMEOUT_MS` | `120_000` | M1 AC 27 — pending spike B |
| `EXTRACTION_MODEL` | `'claude-opus-5'` | research; no date suffix, ever |
| `EXTRACTION_EFFORT` | `'high'` | research §6 |
| `MAX_EXTRACTION_ATTEMPTS` | `3` | M1 AC 23/27 |
| `SOURCE_FILE_RETENTION_DAYS` | `365` | M1 AC 36 — **assumption, needs legal** |
| `ACCOUNT_GRACE_PERIOD_DAYS` | `30` | M0 AC 36 — **assumption** |
| `CONSENT_RETENTION_AFTER_PURGE_DAYS` | `0` | M0 open question 5 — **needs legal** |
| `CONSENT_TEXT_VERSION` | `'2026-08-26.1'` | M0 AC 19 |
| `MAGIC_LINK_TTL_SECONDS` | `900` | M0 AC 4 |
| `HEIC_JPEG_QUALITY` | `0.85` | ADR-0004 |
| `AVATAR_IDS` | preset ids | M0 AC 12 |

New environment variables (all server-only; **none** may be `NEXT_PUBLIC_`):
`AUTH_SECRET`, `AUTH_URL`, `AUTH_RESEND_KEY`, `EMAIL_FROM`,
`BLOB_READ_WRITE_TOKEN`, `ANTHROPIC_API_KEY`, `CRON_SECRET`.

---

## 8. Dependency table — every one needs the owner's approval

Nothing here is installed. **Do not run an install command until the owner
approves.** pnpm only.

| Package | Purpose | ADR | Needed for | Notes / risk |
|---|---|---|---|---|
| `next-auth@^5` | Sign-in, database sessions, magic-link provider | 0002 | **M0** | Long-running beta. Configured with `strategy: 'database'`; AC 5 is unachievable with JWT sessions. |
| `@auth/prisma-adapter` | Auth.js ↔ Prisma | 0002 | **M0** | May not typecheck against the Prisma 7 generated client. Contingency: hand-write the `Adapter` interface (~15 functions) and drop this package. No `any`. |
| `@vercel/blob@^2.8` | Private store, client-direct upload, signed URLs, `list`/`head`/`del` | 0003 | **M0** | Every signature is unverified until §9 spike A. Confined to `lib/storage/vercel-blob.ts`. |
| `@anthropic-ai/sdk` | Vision extraction with `messages.parse()` | 0005 | **M1** | Requires `ANTHROPIC_API_KEY`, server-only. |
| `heic-to` | Browser HEIC → JPEG | 0004 | **M1** | Sizeable wasm decoder. **Dynamically imported only** (AC 5). Fallback `heic2any`. |
| `pdf-lib` | PDF page count (AC 10) | 0004 | **M1** | Dynamically imported client-side; also used server-side at confirm time as the enforcement point. If declined, AC 10 cannot be met and must be renegotiated. |
| `katex` + `@types/katex` | Render extracted LaTeX (AC 21) | 0005 | **M1** | Used **server-side** via `renderToString`, so no KaTeX JS reaches the browser — only `katex.min.css`. |
| `server-only` | Compile-time guard that the DAL never reaches a client bundle | 0006 | **M0** | ~1 KB, no transitive deps. Not currently resolvable in `node_modules`. Recommended for a children's-data codebase. |
| `react-hook-form` + `@hookform/resolvers` | **Optional.** Required only if we use shadcn's `form` component | — | M0 | The constitution prefers shadcn components. Declining is fine: forms become controlled inputs plus a `safeParse` on submit, at the cost of some boilerplate. **Recommend declining for M0** and revisiting if form code becomes unpleasant. |

Not dependencies: shadcn/ui components are source files copied by the CLI.

Not proposed, and deliberately so: no Redis or rate-limit service (the hourly cap
is a Postgres count), no queue (extraction uses `after()`), no mail SDK
(`fetch` to Resend), no image-processing library on the server, no `zod` (already
installed at `^4.4.3`).

---

## 9. The spike

M0 blocking open question #1: **client-side `upload()` with `access: 'private'`
is unverified end to end.** If it fails, the storage design and all of M1
change. Nothing in M0 AC 25–36 or in M1 is written until spike A returns.

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
| S2 | `curl` the returned private URL with no credentials → status ≠ 200 and no bytes | M0 AC 31 |
| S3 | A `get`-signed URL with `validUntil = now + 60s` returns 200; after 61s it does not | M0 AC 32 |
| S4 | That same signed URL replayed as a `PUT` is rejected | M0 AC 33 |
| S5 | With the issued token, a 25 MB file and a `text/plain` file are both rejected and no object is created | M0 AC 28 |
| S6 | Two uploads of the same filename both succeed with distinct pathnames | M1 AC 9 |
| S7 | `onUploadCompleted` fires on the preview deployment and does **not** fire on localhost | M1 AC 14 — justifies the confirm route |
| S8 | `head(pathname)` on a private object returns real `contentType` and `size` server-side | endpoint 10's trust model |
| S9 | `list()` exposes `uploadedAt` per object and paginates by cursor | M0 AC 34 — the reconciler depends on both |

**If it fails**, the branch taken is determined by which assertion failed:

- **S1 or S2 fails** — private stores cannot accept browser uploads, or private
  URLs are readable. **Switch to Supabase Storage private buckets**
  (`createSignedUploadUrl` + `createSignedUrl`), the designated fallback in
  ADR-0003 and the research. Costs: `@supabase/supabase-js`, a second vendor,
  Pro plan from day one. **The Prisma schema, every route, every DTO and every
  component are unchanged**, because only `lib/storage/vercel-blob.ts` is
  replaced by `lib/storage/supabase.ts` behind the same `StoragePort`. ADR-0003
  is superseded by a new ADR; the plan is otherwise untouched. This is why the
  port lands in the shared phase and not in the backend track.
- **S3 or S4 fails** — signed URLs are unusable or replayable. Drop signed URLs
  entirely and **proxy preview bytes** through
  `GET /api/uploads/[uploadId]/preview` using server-side `get()`. M1 explicitly
  allows this ("if the security reviewer disagrees, proxying via a server-side
  read satisfies AC 31 and AC 32 equally"). Endpoint 13 changes shape; nothing
  else does.
- **S5 fails** — provider-side constraints are not enforced. Re-verify size and
  type at confirm time via `head()` and delete violating objects immediately.
  AC 28 degrades from "the write is rejected" to "the object is deleted within
  seconds" and **must be renegotiated with the owner**, not silently accepted.
- **S7 behaves unexpectedly** — no change; the confirm route is already the
  primary path.
- **S9 fails** — the reconciler cannot use object age. Fall back to reconciling
  against `UploadTokenGrant` rows older than the threshold, and record the
  reduced guarantee: objects from a grant we never recorded become invisible,
  which is a real weakening of AC 34 and must be flagged to the owner.

### Spike B — extraction latency (smaller, runs in parallel, non-blocking)

The API research names model latency versus function duration as the biggest
unvalidated assumption in the whole plan.

**Prerequisite:** owner approval for `@anthropic-ai/sdk` and an
`ANTHROPIC_API_KEY`.

One script: call `messages.parse()` with the ADR-0005 schema against three
fixture worksheets at `effort: 'high'`, five times each, on a deployed preview
function. Record p50 and p95 wall clock and token usage. Set
`EXTRACTION_TIMEOUT_MS` from the measurement rather than from the guess.

**If p95 exceeds the function duration limit:** extraction moves out of
`after()` and into a queued background job. The status machine in §1 and the
polling endpoint (14) are already specified for exactly this, so the change is
confined to `lib/extraction/run-extraction.ts` and its trigger. Nothing else
moves. Lowering `effort` to `medium` is the cheaper mitigation to try first and
should be measured in the same run.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Private client upload is unverified — the whole storage design rests on it | Spike A before any storage code; `StoragePort` makes a provider swap one file |
| `@auth/prisma-adapter` may not typecheck against Prisma 7's generated client | Hand-write the `Adapter` interface against our models. **Never cast to `any`.** Detected on first install, before anything is built on it |
| A `high`-effort extraction may not fit inside the function duration | Spike B measures it; the status machine + lazy timeout means the failure is a `FAILED` with a retry, never a hung browser |
| Vercel Cron on Hobby runs at most daily, so a 60-minute orphan threshold does not mean 60-minute cleanup | AC 35's 24-hour bound is still met; a tighter window is a plan decision the owner should make knowingly |
| Prisma cascades delete rows without deleting blobs, silently creating orphans | Blob-first deletion (ADR-0007) plus the store-enumerating reconciler as backstop |
| iOS Safari may run out of memory decoding a 12 MP HEIC | Lazy import, a real error message with a "Most Compatible" hint, physical-device testing before M1 is done |
| A signed URL is a bearer credential; one leak into a log or cached HTML exposes a child's schoolwork | Minted only in endpoint 13 with `no-store`, held in client memory only, never server-rendered, 5-minute TTL, never logged |
| An in-app attestation may not meet COPPA's verifiable-parental-consent bar | `consentTextVersion` + `scopes[]` make a stronger method a new version, not a migration. **Blocking for public launch with real minors; not blocking the build** |
| `Subject[]`/`ConsentScope[]` enum arrays under Prisma 7 are unproven here | Verified when the migration is generated, before it is applied. Fallback is `String[]` with a zod allowlist |
| Fixture-based extraction tests can imply accuracy we have not measured | Stated explicitly in §6; real-world accuracy is unmeasured in M1 |
| The 4.5 MB function-body cap is documented as "last updated 2026-07-01" | Re-check before launch; the design does not depend on it being larger |
| A forgotten `userId` scope anywhere leaks a minor's data | Only `lib/auth/dal.ts` may load student-owned rows; a reviewer audits one file plus a grep for handlers that bypass it |

---

## 11. Needs approval before any code is written

**Dependencies** (§8): `next-auth@^5`, `@auth/prisma-adapter`, `@vercel/blob`,
`@anthropic-ai/sdk`, `heic-to`, `pdf-lib`, `katex` + `@types/katex`,
`server-only`. Optional and currently recommended *against* for M0:
`react-hook-form` + `@hookform/resolvers`.

**Migration:** `0001_m0_m1_core` — creation only, **not destructive**, on a
database with zero models today.

**Decisions still open** — the build proceeds because each is configuration, but
each is currently a guess:

1. **Legal.** Is an in-app attestation by a signed-in adult sufficient
   verifiable parental consent under COPPA? Blocking for public launch.
2. **Legal.** How long must a consent record be retained after the family
   deletes their account? Currently `0` (purged with everything else).
3. **Product.** PDF page limit — assumed 20.
4. **Product.** Source-file retention — assumed 365 days.
5. **Product.** Hourly upload cap — assumed 10 per student profile.
6. **Infrastructure.** Vercel plan, which sets the achievable cron frequency and
   whether Private Blob is available on Hobby at all.
