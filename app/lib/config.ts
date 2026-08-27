/**
 * Every tunable named in plan §7 lives here and nowhere else. This is a
 * compliance surface, not a convenience (M0 AC 45): retention windows, the
 * pre-consent purge window, and the consent method are all things a lawyer
 * will eventually ask about, and the answer must be readable in one place.
 *
 * **No literal tunable may appear anywhere else in the codebase.** A
 * duration, a byte limit, a page cap, a probability threshold — if it isn't
 * exported from here, it isn't a real tunable, it's a bug waiting to drift
 * from the value the retention page (`app/retention/page.tsx`) or the
 * enforcement job (`lib/jobs/enforce-retention.ts`) actually uses.
 *
 * This module is imported by both server and client code (e.g.
 * `ACCEPTED_PICKER_TYPES` sizes a file input's `accept` attribute in
 * `components/uploads/upload-panel.tsx`). It therefore does NOT import
 * `server-only`, and the one value that reads a non-public environment
 * variable (`CONSENT_METHOD`) is resolved defensively — see the comment on
 * `resolveConsentMethod` below — so that a client bundle that transitively
 * pulls in this module never touches `process.env`.
 *
 * `DIRECT_NOTICE_VERSION` deliberately does NOT live here: it lives beside
 * the notice copy (`lib/notice/...`, backend track) so that a copy edit and
 * a version bump are the same diff (plan §7). Its absence from this file is
 * intentional, not an oversight.
 */

import { z } from "zod";
import { CONSENT_METHODS, type ConsentMethod } from "@/lib/consent/methods/port";

export type { ConsentMethod };
export { CONSENT_METHODS };

// ─────────────────────────── consent ───────────────────────────

const consentMethodSchema = z.enum(CONSENT_METHODS);

/**
 * `CONSENT_METHOD` selects a server-side `ConsentMethodProvider` strategy
 * (ADR-0008) and must never be read in the browser — nothing client-facing
 * depends on which method is configured. `typeof window` guards the actual
 * `process.env` read so that if this module is ever pulled into a client
 * bundle by a future import mistake, it fails to build/behave loudly rather
 * than throwing `ReferenceError: process is not defined` at runtime, and
 * without ever needing to validate an environment variable a browser has no
 * business reading.
 *
 * On the server, a missing or invalid value throws at module load —
 * "a bad or unimplemented value fails the boot, not the parent's request"
 * (ADR-0008 §2).
 */
function resolveConsentMethod(): ConsentMethod {
  if (typeof window !== "undefined") {
    // Inert placeholder. Never read: no client code branches on the
    // configured consent method (ADR-0008 §3).
    return CONSENT_METHODS[0];
  }
  const parsed = consentMethodSchema.safeParse(process.env.CONSENT_METHOD);
  if (!parsed.success) {
    throw new Error(
      `Invalid or missing CONSENT_METHOD environment variable. Must be one of: ${CONSENT_METHODS.join(", ")}.`,
    );
  }
  return parsed.data;
}

/** M0 AC 16 / ADR-0008. The active `ConsentMethodProvider` strategy. */
export const CONSENT_METHOD: ConsentMethod = resolveConsentMethod();

/**
 * M0 AC 17. New wording requires a new version — never bump this without
 * also updating the consent copy it names.
 */
export const CONSENT_TEXT_VERSION = "2026-08-26.1";

/**
 * M0 AC 19 — ASSUMPTION, pending product/legal review. Long enough for a
 * parent to find the email; short enough that a stale challenge doesn't
 * linger.
 */
export const CONSENT_CHALLENGE_TTL_HOURS = 72;

/**
 * M0 AC 22/23 — ASSUMPTION, drawn from the FTC's Microsoft/Xbox enforcement
 * order. Profiles that never reach `ACTIVE` or `CONSENT_WITHDRAWN` within
 * this many days of `createdAt` are purged.
 */
export const PRE_CONSENT_PURGE_DAYS = 14;

/**
 * M0 AC 50 — NEEDS COUNSEL. `0` means a `ConsentAuditArtifact` is purged
 * along with everything else at deletion time; raising this keeps a
 * pseudonymised remnant for the given number of days afterward.
 */
export const CONSENT_AUDIT_RETENTION_DAYS = 0;

/**
 * M0 AC 47 — ASSUMPTION. Returned to the client in the closure response so
 * the confirmation copy is never hard-coded (`purgeAfter`, `recoveryWindowDays`).
 */
export const ACCOUNT_CLOSURE_RECOVERY_DAYS = 30;

/**
 * M0 retention table — ASSUMPTION, supersedes M1's earlier "365 days from
 * upload" figure. Measured from `Upload.extractedAt`, never from `createdAt`.
 */
export const SOURCE_FILE_RETENTION_DAYS_AFTER_EXTRACTION = 14;

/** M0 AC 47 — ASSUMPTION. How long a `DeletionAudit` row survives after `completedAt`. */
export const DELETION_AUDIT_RETENTION_DAYS = 365;

/**
 * ADR-0008 §4/§5, and a finding from the M0 consent-flow review: caps
 * attempts per caller IP against the public, session-free, token-authenticated
 * consent routes (`/api/consent/verify`, `/api/consent/decline`,
 * `/api/consent/callback/[method]`) — the only unauthenticated mutations in
 * the app. For `EMAIL_PLUS` that token IS parental consent, so these are the
 * one place in the app where a wrong guess must never be free.
 * `lib/api/handler.ts`'s `publicRateLimit` hook (step 2b) runs this BEFORE
 * the token is looked up, precisely so a wrong-but-well-formed token cannot
 * reach an unthrottled database lookup. ASSUMPTION, in-memory
 * (`lib/consent/rate-limit.ts`) — no new dependency and no schema change.
 */
export const CONSENT_PUBLIC_RATE_LIMIT_WINDOW_MINUTES = 15;
/** Max attempts per IP within the window above, across verify+decline+callback combined per route. */
export const CONSENT_PUBLIC_RATE_LIMIT_MAX_ATTEMPTS = 20;

// ─────────────────────────── uploads ───────────────────────────

/** M0 AC 37 (product assumption). */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * M0 AC 37. The exact set the storage provider is instructed to accept
 * (`ClientUploadPolicy.allowedContentTypes`, `lib/storage/port.ts`) and the
 * set `head()`-derived content types are checked against server-side.
 */
export const ALLOWED_UPLOAD_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export type UploadContentType = (typeof ALLOWED_UPLOAD_CONTENT_TYPES)[number];

/**
 * M1 AC 1. What the file picker's `accept` attribute offers, which is wider
 * than what the server ultimately stores: HEIC/HEIF is converted to JPEG
 * client-side (ADR-0004) before upload, so it never reaches
 * `ALLOWED_UPLOAD_CONTENT_TYPES`.
 */
export const ACCEPTED_PICKER_TYPES = [
  ...ALLOWED_UPLOAD_CONTENT_TYPES,
  "image/heic",
  "image/heif",
] as const;

export type AcceptedPickerType = (typeof ACCEPTED_PICKER_TYPES)[number];

/** M0 AC 41 / M1 AC 32 (product assumption). `expiresAt - now` must never exceed this. */
export const SIGNED_URL_TTL_MS = 5 * 60_000;

/** M0 AC 43. How stale an unconfirmed `UploadTokenGrant`/object must be to count as an orphan. */
export const ORPHAN_THRESHOLD_MINUTES = 60;

/** M1 open question — ASSUMPTION. */
export const PDF_PAGE_LIMIT = 20;

/** M1 AC 17 — ASSUMPTION. Caps `POST /api/blob/upload` token issuance per student profile. */
export const UPLOADS_PER_HOUR = 10;

// ─────────────────────────── extraction ───────────────────────────

/** M1 AC 26 — ASSUMPTION. Below this, `ExtractedProblemDTO.lowConfidence` is `true`. */
export const LOW_CONFIDENCE_THRESHOLD = 0.7;

/** M1 AC 27 — pending spike B measurement; set the real value once p95 is measured. */
export const EXTRACTION_TIMEOUT_MS = 120_000;

/**
 * Research-selected model. No date suffix, ever — deploy a new model by
 * changing this one string, not by inventing a second constant.
 */
export const EXTRACTION_MODEL = "claude-opus-5";

/** Research §6. */
export const EXTRACTION_EFFORT = "high";

/** M1 AC 23/27. */
export const MAX_EXTRACTION_ATTEMPTS = 3;

// ─────────────────────────── auth ───────────────────────────

/** M0 AC 4. Auth.js magic-link `maxAge`. */
export const MAGIC_LINK_TTL_SECONDS = 900;

/**
 * `signInWithEmail` (`lib/auth/actions.ts`) is public and unauthenticated —
 * it is the only way to write an `AdultAttestation` row and to trigger a
 * real dispatched email, so it is also the app's one open email-bombing
 * primitive. Rate limited by a Postgres `count()` over this rolling window
 * (no Redis, no new dependency), by BOTH the normalised email and the
 * request IP, so a distributed flood against one address and a single
 * client flooding many addresses are both bounded.
 */
export const SIGN_IN_RATE_LIMIT_WINDOW_MINUTES = 15;
/** Max `signInWithEmail` attempts per normalised email within the window above. */
export const SIGN_IN_RATE_LIMIT_MAX_PER_EMAIL = 3;
/** Max `signInWithEmail` attempts per request IP within the window above. */
export const SIGN_IN_RATE_LIMIT_MAX_PER_IP = 10;
/**
 * A rapid double-submit (double click, a retried fetch) for the SAME
 * email+IP within this cooldown reuses the existing live `AdultAttestation`
 * row instead of writing another one. `AdultAttestation` has no unique key
 * for Prisma's own `upsert()` to target, so this is the manual equivalent
 * ("prefer upsert-with-cooldown over a blind create").
 */
export const SIGN_IN_ATTESTATION_COOLDOWN_SECONDS = 60;

// ─────────────────────────── HEIC conversion ───────────────────────────

/** ADR-0004. */
export const HEIC_JPEG_QUALITY = 0.85;

// ─────────────────────────── avatars ───────────────────────────

/**
 * M0 AC 29. The closed set of preset avatar ids zod validates against.
 * There is no file-upload path for avatars — this list, not client input,
 * is what makes that true. PLACEHOLDER pending final art: each id must have
 * matching artwork under `public/avatars/<id>.svg` before ship.
 */
export const AVATAR_IDS = [
  "fox",
  "owl",
  "panda",
  "robot",
  "astronaut",
  "dinosaur",
  "dragon",
  "unicorn",
] as const;

export type AvatarId = (typeof AVATAR_IDS)[number];

// ─────────────────────────── retention policy ───────────────────────────

export type RetentionPolicyEntry = {
  key: string;
  purpose: string;
  businessNeed: string;
  windowDays: number | null;
  anchor?: string;
  note?: string;
};

/**
 * One array, two consumers (M0 AC 44/45): `app/retention/page.tsx` renders
 * it verbatim on the public retention page, and
 * `lib/jobs/enforce-retention.ts` walks it to decide what to delete. A unit
 * test must assert every entry with a non-null `windowDays` has a
 * corresponding job step and vice versa, so the published policy can never
 * describe a window the code doesn't enforce.
 *
 * `purpose`/`businessNeed` copy here is product-drafted, not legal text —
 * treat it as a first draft for counsel to review, not a finished
 * compliance artifact.
 */
export const RETENTION_POLICY = [
  {
    key: "PRE_CONSENT",
    purpose:
      "Holds the minimum information needed to start a student profile (an age band only) while a parent completes the notice-and-consent flow.",
    businessNeed: "Lets a family resume signup without starting over, for a bounded window.",
    windowDays: PRE_CONSENT_PURGE_DAYS,
    anchor: "createdAt",
  },
  {
    key: "SOURCE_FILE",
    purpose: "The uploaded photo or PDF of a student's schoolwork.",
    businessNeed:
      "Needed only long enough to extract the problem text and let the student confirm the extraction is accurate; the image itself isn't needed afterward.",
    windowDays: SOURCE_FILE_RETENTION_DAYS_AFTER_EXTRACTION,
    anchor: "extractedAt",
  },
  {
    key: "EXTRACTED_TEXT",
    purpose: "The problem text, and the student's own answer text, extracted from an uploaded worksheet.",
    businessNeed:
      "This is the working material the tutoring product is built on; kept for as long as the profile is active.",
    windowDays: null,
    note: "life of the ACTIVE profile",
  },
  {
    key: "PROFILE_FIELDS",
    purpose: "A student's display name, grade level, subjects and chosen avatar.",
    businessNeed: "Needed to personalize the product for as long as the account is in use.",
    windowDays: null,
    note: "life of the ACTIVE profile",
  },
  {
    key: "DIRECT_NOTICE",
    purpose: "The §312.4 direct notice actually shown and emailed to a parent before consent was requested.",
    businessNeed: "Evidence that notice was given before consent was sought.",
    windowDays: DELETION_AUDIT_RETENTION_DAYS,
    anchor: "deletedAt",
  },
  {
    key: "CONSENT_FULL",
    purpose:
      "The full parental consent record — the consenting adult's name, relationship, method and evidence reference — for an active profile.",
    businessNeed:
      "The primary evidence that verifiable parental consent was obtained, for as long as the account is in use.",
    windowDays: null,
    note: "life of the ACTIVE profile",
  },
  {
    key: "CONSENT_PSEUDONYM",
    purpose: "A pseudonymised remnant of a consent record kept after a student profile or account is deleted.",
    businessNeed: "Evidence that consent was validly obtained at the time, without retaining the family's identity.",
    windowDays: CONSENT_AUDIT_RETENTION_DAYS,
    anchor: "purgeAfter",
  },
  {
    key: "ACCOUNT_SESSION",
    purpose: "Sign-in session records for the account holder.",
    businessNeed: "Needed only while a session is active.",
    windowDays: null,
    note: "deleted on sign-out or account closure, not on a timer",
  },
  {
    key: "CLOSED_ACCOUNT",
    purpose: "All data belonging to an account that requested closure, held only for the recovery window.",
    businessNeed: "Lets someone who closed their account by mistake recover it before data is purged.",
    windowDays: ACCOUNT_CLOSURE_RECOVERY_DAYS,
    anchor: "closureRequestedAt",
  },
  {
    key: "DELETION_AUDIT",
    purpose:
      "A record that a deletion happened and what kind it was (closure, parental deletion request, profile deletion, pre-consent purge, or retention expiry).",
    businessNeed: "Evidence that deletion requests were honoured, without retaining any of the deleted data itself.",
    windowDays: DELETION_AUDIT_RETENTION_DAYS,
    anchor: "completedAt",
  },
] as const satisfies readonly RetentionPolicyEntry[];
