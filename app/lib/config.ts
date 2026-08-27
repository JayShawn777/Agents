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
// Type-only — erased at compile time, so this carries no runtime coupling to
// the generated Prisma client and does not compromise this module's
// client-bundle safety (see the module docstring above).
import type { MasteryLevel } from "@/lib/generated/prisma/enums";

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

// ─────────────────────────── storage ───────────────────────────

/** The `StoragePort` implementations `lib/storage/get-storage.ts` can select between. */
export const STORAGE_DRIVERS = ["local", "vercel-blob"] as const;
export type StorageDriver = (typeof STORAGE_DRIVERS)[number];

const storageDriverSchema = z.enum(STORAGE_DRIVERS);

/**
 * `STORAGE_DRIVER` selects the `StoragePort` implementation
 * `lib/storage/get-storage.ts` returns (ADR-0003; the local adapter unblocks
 * M1 while the Vercel Blob account/store does not exist yet). Same
 * client/server guard as `resolveConsentMethod` above — nothing
 * client-facing ever branches on which storage driver is configured, and an
 * unset/empty value defaults to `"local"` rather than throwing, unlike
 * `CONSENT_METHOD`: `local` is always a safe default to boot with, whereas
 * there is no safe default consent method.
 */
function resolveStorageDriver(): StorageDriver {
  if (typeof window !== "undefined") {
    return "local";
  }
  const raw = process.env.STORAGE_DRIVER;
  if (raw === undefined || raw === "") return "local";
  const parsed = storageDriverSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid STORAGE_DRIVER environment variable. Must be one of: ${STORAGE_DRIVERS.join(", ")}.`);
  }
  return parsed.data;
}

/** ADR-0003 / M1 unblock. Defaults to `"local"` — see `lib/storage/local-fs.ts`. */
export const STORAGE_DRIVER: StorageDriver = resolveStorageDriver();

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

/**
 * ADR-0007 §2. How stale an `UploadTokenGrant` row must be before
 * `lib/jobs/reconcile-blobs.ts` prunes it. A grant this old was either
 * confirmed (and is no longer needed to rate-limit anything) or abandoned
 * entirely — either way it has stopped doing the one thing it exists for
 * (bounding `POST /api/blob/upload` token issuance, M1 AC 17).
 */
export const GRANT_PRUNE_AFTER_HOURS = 24;

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

// ─────────────────────────── M2: practice and mastery ───────────────────────────

/**
 * ADR-0009 §1. Bumped whenever `lib/taxonomy/skills-k8.json` changes; recorded
 * verbatim on `PracticeSet.taxonomyVersion` so a later version bump is legible
 * in the data rather than inferred.
 *
 * `.2` widened the bundle from CCSS alone to CCSS + NGSS (science) + C3
 * (social studies), and renamed the data file accordingly. Sets generated
 * before that carry `ccss-2010.k8.1`.
 */
export const TAXONOMY_VERSION = "k8-ccss-ngss-c3.2";

/**
 * M2 AC 8 — ASSUMPTION, per ADR-0009's own follow-up ("decide from the first
 * fixture run"). How many grade levels on either side of a student's own
 * `gradeLevel` the candidate skill slate (`lib/taxonomy/index.ts`'s
 * `candidateSlate`) is widened by.
 */
export const SKILL_GRADE_BAND = 1;

/**
 * `GRADABLE_SUBJECTS` MOVED to `lib/taxonomy/index.ts`, where it is derived
 * from the bundle's actual coverage instead of hand-listed here. It cannot
 * live in this file: the derivation reads the taxonomy, and the taxonomy reads
 * `TAXONOMY_VERSION` from this file, so importing it back would be circular.
 *
 * Its former value here was `["MATH", "SCIENCE"]`, which was wrong in both
 * directions — no science skill was bundled, and ELA's 18 were excluded. See
 * the coverage note in `lib/taxonomy/index.ts`.
 */

/** M2 AC 23 — ASSUMPTION. A practice set's size is bounded and never grows. */
export const PRACTICE_SET_SIZE = 6;

/**
 * M2 open question — ASSUMPTION: a generated set matches the source
 * problem's level, with the last problem one step harder. One entry per
 * generated problem (`PRACTICE_SET_SIZE` long); each value becomes that
 * problem's `PracticeProblem.difficultyOffset`.
 */
export const PRACTICE_SET_DIFFICULTY_LADDER = [0, 0, 0, 0, 0, 1] as const;

/**
 * M2 AC 12 — ASSUMPTION, and a pedagogical choice, not just a technical one:
 * how many wrong attempts a child gets before the app shows them the worked
 * answer. Too low reads as the app giving up on a child who made one careless
 * slip; too high is the spec's own named failure mode — "stuck in a loop
 * feeling stupid" (see the user stories in docs/specs/m2-practice-and-mastery.md).
 * Three attempts is enough to rule out a typo or a momentary slip without
 * leaving a genuinely stuck child staring at the same wrong answer for long;
 * it is also the value the wider plan reuses for M3's `CHAT_REVEAL_AFTER_TURNS`,
 * so a child does not learn two different thresholds for "the app will help me
 * now" across two different surfaces.
 */
export const ATTEMPTS_BEFORE_REVEAL = 3;

/**
 * The most attempts one practice problem will ever accept — ASSUMPTION.
 *
 * `ATTEMPTS_BEFORE_REVEAL` decides when the worked answer *unlocks*; it caps
 * nothing. Without this ceiling a problem accepts answers forever, which is
 * two problems at once. The product one is the failure the M2 spec names by
 * name — a child "stuck in a loop feeling stupid", grinding the same problem
 * with nothing stopping them. The technical one is that every attempt whose
 * answer the normalizer cannot decide costs an adjudication call (ADR-0011
 * §2), so an unbounded attempt count is an unbounded bill.
 *
 * Ten leaves seven tries after the worked answer has been shown — room to
 * genuinely re-work it — while still ending.
 */
export const MAX_ATTEMPTS_PER_PROBLEM = 10;

/**
 * Attempts one student profile may submit per rolling hour — ASSUMPTION, and
 * a spend control rather than a product rule.
 *
 * `PRACTICE_SETS_PER_HOUR` (5) x `PRACTICE_SET_SIZE` (6) x
 * `MAX_ATTEMPTS_PER_PROBLEM` (10) puts the theoretical ceiling at 300, which
 * no child approaches; 120 is two per minute sustained for a full hour. It
 * exists because the grading path reaches Anthropic on any answer the
 * normalizer cannot decide, and `"x"` submitted against a NUMERIC problem
 * misses deterministically — so without a cap one authenticated account can
 * buy model calls in a loop.
 */
export const ATTEMPTS_PER_HOUR = 120;

// ─────────────────────────── M2.5: checkpoints ───────────────────────────

/**
 * M2.5 AC 3 — ASSUMPTION. How many problems a checkpoint holds. Longer than
 * `PRACTICE_SET_SIZE` (6) because a checkpoint spans several skills rather
 * than drilling one, and still short enough to be a single sitting — the
 * spec's "short, finishable thing" is a requirement, not a nicety.
 */
export const CHECKPOINT_SIZE = 8;

/**
 * M2.5 AC 1 — ASSUMPTION. Below this many distinct practised skills there is
 * nothing to check ACROSS, and a "checkpoint" over one skill is just more
 * practice wearing a more intimidating name.
 */
export const CHECKPOINT_MIN_SKILLS = 3;

/**
 * M2.5 AC 6 — ASSUMPTION. Per DAY, deliberately, where practice generation is
 * capped per hour: a checkpoint is meant to be an occasional event, and a
 * child who can take six in an afternoon is being drilled, not checked.
 */
export const CHECKPOINTS_PER_DAY = 2;

/**
 * ADR-0016. The allowlist `ExtractedProblem.language` is validated against at
 * persistence — the same shape as a `skillCode` checked against the bundled
 * taxonomy, and for the same reason: the supported set is product-driven and
 * will move more often than a Prisma enum migration should.
 *
 * EMPTY ON PURPOSE. The column exists (it rode along in M2.5's migration,
 * because M2's schema was still unshipped and an applied migration cannot be
 * edited), but no ACTFL skills are bundled yet, so no language is supported
 * and every value must be rejected. Adding an entry here without the matching
 * taxonomy work would recreate the 2026-08-27 coverage defect exactly: a
 * subject declared workable with nothing behind it.
 */
export const SUPPORTED_LANGUAGES: readonly string[] = [];

/**
 * ADR-0010 §5's evidence floor, and the M2-M7 plan §10's value (4).
 *
 * A skill does not appear in M7's parent report until it has at least this
 * many attempts AND at least one graded by the deterministic normaliser
 * rather than the model. ADR-0010 §5 described this constant in the present
 * tense as though it existed; it did not exist anywhere in the codebase until
 * 2026-08-27, only in that ADR and in the plan.
 *
 * It is defined here now, ahead of its consumer, because it is the mitigation
 * that bounds a real hole: a student can talk to the grader that marks them
 * (`lib/ai/untrusted.ts`), `SkillMastery.level` is a ratchet ADR-0010 forbids
 * lowering, and M7's parent report is a durable narrative about a child built
 * on top of it. Nothing reads this yet — M7 is unbuilt — and whoever builds
 * that report must wire it in rather than rediscovering why it is here.
 */
export const MASTERY_MIN_ATTEMPTS_FOR_REPORT = 4;

/** M2 AC 16. Caps a submitted answer's length at the API boundary. */
export const PRACTICE_ANSWER_MAX_LENGTH = 500;

/** Bounds a client-supplied `elapsedMs` on an attempt — one hour is generous for a single practice problem. */
export const ATTEMPT_MAX_ELAPSED_MS = 3_600_000;

/**
 * M2 AC 26 — ASSUMPTION. Counts `PracticeSet` rows created in the rolling
 * window, INCLUDING `FAILED` ones — the row is written before the AI call
 * specifically so it doubles as the rate-limit grant (the same reason
 * `UploadTokenGrant` exists, M1 AC 17).
 */
export const PRACTICE_SETS_PER_HOUR = 5;

/**
 * M2 open question — pending a real latency measurement (the plan's §9.1
 * measures M3's equivalent; M2 generation has no analogous spike yet). Mirrors
 * `EXTRACTION_TIMEOUT_MS`'s "measure before treating as final" status.
 */
export const PRACTICE_GENERATION_TIMEOUT_MS = 120_000;

/** Research §1, §6 — same mechanism as `EXTRACTION_MODEL`/`EXTRACTION_EFFORT` (ADR-0005). */
export const PRACTICE_MODEL = "claude-opus-5";
/** Research §6: `effort: 'high'` for authoring/generation routes. */
export const PRACTICE_EFFORT = "high";

/** Mirrors `MAX_EXTRACTION_ATTEMPTS`. */
export const MAX_PRACTICE_GENERATION_ATTEMPTS = 3;

/** ADR-0011 §2 — the mechanical grading route: research §6, `effort: 'low'` for a route that is deciding a fact, not composing prose. */
export const GRADING_MODEL = "claude-opus-5";
export const GRADING_EFFORT = "low";

/** ADR-0011 — the interactive path. A submitted answer must be graded fast enough to feel immediate. */
export const GRADING_TIMEOUT_MS = 15_000;

/** ADR-0011 §2 — ASSUMPTION. Caps the model-adjudicated hint's length. */
export const HINT_MAX_LENGTH = 240;

/**
 * ADR-0010 §2 — ASSUMPTION, to be re-set from the first real fixture run
 * rather than shipped as final (ADR-0010's own accepted trade-off). Ordered
 * low to high; `levelFor()` (`lib/mastery/apply.ts`) picks the HIGHEST entry
 * whose `threshold` is `<= consecutiveCorrect`.
 *
 * `requiresMultiplePracticeSets` is the owner's correction to ADR-0010,
 * decided for this milestone and recorded as a revision note on the ADR: the
 * architect's original ladder let five consecutive correct answers within
 * ONE six-problem practice set carry a skill straight from nothing to
 * `SECURE`, and because `level` is a ratchet (never falls) that mistake would
 * have been permanent for that skill. Only the TOP rung carries the flag —
 * lower rungs are unaffected, and the counters underneath (`attemptCount`,
 * `correctCount`, `consecutiveCorrect`) still accumulate exactly as ADR-0010
 * §1 describes. See `lib/mastery/apply.ts` for how the flag is enforced
 * (`SkillMastery.streakStartPracticeSetId`) and
 * `tests/unit/lib/mastery/apply.test.ts` for the boundary case this exists
 * to fix: five consecutive correct within one set must NOT promote to SECURE.
 */
export const MASTERY_LADDER = [
  { level: "BEGINNING", threshold: 1, requiresMultiplePracticeSets: false },
  { level: "DEVELOPING", threshold: 3, requiresMultiplePracticeSets: false },
  { level: "SECURE", threshold: 5, requiresMultiplePracticeSets: true },
] as const satisfies readonly {
  level: MasteryLevel;
  threshold: number;
  requiresMultiplePracticeSets: boolean;
}[];

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
  {
    key: "PRACTICE_CONTENT",
    purpose: "Generated practice problems and their answer keys (PracticeSet, PracticeProblem, PracticeAnswerKey).",
    businessNeed:
      "This is the practice material itself — needed for as long as the profile is active so a student can resume a set and a parent can see what was practised.",
    windowDays: null,
    note: "life of the ACTIVE profile",
  },
  {
    key: "ATTEMPT_HISTORY",
    purpose: "A student's submitted answers and grading results for each practice problem (Attempt).",
    businessNeed:
      "The evidence the mastery record is built from, and the join point a later chat session opens against; kept for as long as the profile is active.",
    windowDays: null,
    note: "life of the ACTIVE profile",
  },
  {
    key: "MASTERY_RECORD",
    purpose: "Per-skill progress counters and the mastery level derived from them (SkillMastery).",
    businessNeed:
      "The durable record of what a student can and cannot yet do, which is the whole product's value; kept for as long as the profile is active. Removed only on profile deletion, never when the extraction it was practised from is deleted (ADR-0010 §6).",
    windowDays: null,
    note: "life of the ACTIVE profile",
  },
] as const satisfies readonly RetentionPolicyEntry[];
