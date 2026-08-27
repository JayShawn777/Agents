/**
 * Browser-safe domain enums and label maps (plan §5, S5).
 *
 * Every Prisma enum used anywhere client-facing is re-exported from HERE,
 * never imported directly from `@/lib/generated/prisma/enums` by a component
 * or a zod schema — this file is the one seam, so if the generated
 * entrypoint ever changes shape, only this file needs to move.
 *
 * This module imports only the generated `enums.ts` file, which is a plain
 * `as const` object with no `PrismaClient`, no adapter, and no `server-only`
 * guard — it is safe to import from client components (plan §4:
 * "Prisma enum values reach the browser through
 * `@/lib/generated/prisma/enums`, ... re-exported from `lib/domain/enums.ts`").
 *
 * NEVER import `@/lib/db` from this file or from anything under
 * `lib/schemas/`.
 */

import {
  AgeBand,
  AnswerFormat,
  AttemptResult,
  ConsentMethod,
  ConsentRelationship,
  ConsentScope,
  DeletionKind,
  ExtractionStatus,
  GradedBy,
  GradeLevel,
  MasteryLevel,
  PracticeSetKind,
  PracticeSetStatus,
  StudentProfileStatus,
  Subject,
  UploadStatus,
} from "@/lib/generated/prisma/enums";

export {
  AgeBand,
  AnswerFormat,
  AttemptResult,
  ConsentMethod,
  ConsentRelationship,
  ConsentScope,
  DeletionKind,
  ExtractionStatus,
  GradedBy,
  GradeLevel,
  MasteryLevel,
  PracticeSetKind,
  PracticeSetStatus,
  StudentProfileStatus,
  Subject,
  UploadStatus,
};

// ─────────────────────────── avatars ───────────────────────────

/**
 * Re-exported from `lib/config.ts` (the single source of truth for this
 * tunable, M0 AC 29) so every avatar-related import — enum-like or
 * config-like — can come from one domain module.
 */
export { AVATAR_IDS, type AvatarId } from "@/lib/config";

// ─────────────────────────── label maps ───────────────────────────

/** Display labels for `GradeLevel`, in the order a `<select>` should list them. */
export const GRADE_LEVEL_LABELS: Record<GradeLevel, string> = {
  KINDERGARTEN: "Kindergarten",
  GRADE_1: "Grade 1",
  GRADE_2: "Grade 2",
  GRADE_3: "Grade 3",
  GRADE_4: "Grade 4",
  GRADE_5: "Grade 5",
  GRADE_6: "Grade 6",
  GRADE_7: "Grade 7",
  GRADE_8: "Grade 8",
  GRADE_9: "Grade 9",
  GRADE_10: "Grade 10",
  GRADE_11: "Grade 11",
  GRADE_12: "Grade 12",
  ADULT_LEARNER: "Adult learner",
};

/** Order to render `GradeLevel` options in, since object key order is not a UI contract. */
export const GRADE_LEVEL_ORDER: readonly GradeLevel[] = [
  "KINDERGARTEN",
  "GRADE_1",
  "GRADE_2",
  "GRADE_3",
  "GRADE_4",
  "GRADE_5",
  "GRADE_6",
  "GRADE_7",
  "GRADE_8",
  "GRADE_9",
  "GRADE_10",
  "GRADE_11",
  "GRADE_12",
  "ADULT_LEARNER",
];

/** Display labels for `Subject`. */
export const SUBJECT_LABELS: Record<Subject, string> = {
  MATH: "Math",
  SCIENCE: "Science",
  ENGLISH_LANGUAGE_ARTS: "English language arts",
  READING: "Reading",
  WRITING: "Writing",
  HISTORY: "History",
  SOCIAL_STUDIES: "Social studies",
  FOREIGN_LANGUAGE: "Foreign language",
  COMPUTER_SCIENCE: "Computer science",
  OTHER: "Other",
};

/** Order to render `Subject` options in (multiselect, M0 AC 28). */
export const SUBJECT_ORDER: readonly Subject[] = [
  "MATH",
  "SCIENCE",
  "ENGLISH_LANGUAGE_ARTS",
  "READING",
  "WRITING",
  "HISTORY",
  "SOCIAL_STUDIES",
  "FOREIGN_LANGUAGE",
  "COMPUTER_SCIENCE",
  "OTHER",
];

// ─────────────────────────── M2: practice and mastery ───────────────────────────

/** Display labels for `AnswerFormat` — used by the answer input to pick a control, not by grading. */
export const ANSWER_FORMAT_LABELS: Record<AnswerFormat, string> = {
  NUMERIC: "Number",
  EXPRESSION: "Expression",
  FRACTION: "Fraction",
  SHORT_TEXT: "Short answer",
  MULTIPLE_CHOICE: "Multiple choice",
};

/**
 * ADR-0010 §1. The canonical ordering of `MasteryLevel` — Prisma cannot
 * compare enum values, so `lib/mastery/apply.ts`'s ratchet and
 * `LEVELS_BELOW` below are both built FROM this array rather than each
 * re-declaring the order.
 */
export const MASTERY_LEVEL_ORDER: readonly MasteryLevel[] = [
  "NOT_STARTED",
  "BEGINNING",
  "DEVELOPING",
  "SECURE",
];

/**
 * PARENT-FACING vocabulary (M2 AC 9, AC 19, AC 20). A `MasteryLevel` is a
 * ratchet that never falls — ADR-0010 §"accepted trade-offs" says this
 * explicitly: "a child who reached SECURE in March and has forgotten
 * everything still shows SECURE." These labels are written for that
 * constraint: each one names a stage of getting there, never a state that
 * could plausibly be read as having been lost, expired, or downgraded. A
 * child never sees a level that can fall, and word choice is the sharpest
 * edge of that rule — "Mastered" or "Expert" would invite exactly the
 * "wait, why did that go away?" question this design forbids from ever
 * having an answer.
 */
export const MASTERY_LEVEL_LABELS: Record<MasteryLevel, string> = {
  NOT_STARTED: "Not started yet",
  BEGINNING: "Just getting started",
  DEVELOPING: "Building confidence",
  SECURE: "Confident with this",
};

/**
 * ADR-0010 §2. `LEVELS_BELOW[level]` is every `MasteryLevel` strictly lower
 * than `level`, in `MASTERY_LEVEL_ORDER`. The ratchet's guarded write reads
 * `level: { in: LEVELS_BELOW[newLevel] }` — a concurrent write that already
 * raised the level makes that `updateMany` match zero rows, which is the
 * whole of the ratchet's concurrency safety (ADR-0010 §2, "Concurrency").
 */
export const LEVELS_BELOW: Record<MasteryLevel, readonly MasteryLevel[]> = Object.fromEntries(
  MASTERY_LEVEL_ORDER.map((level, index) => [level, MASTERY_LEVEL_ORDER.slice(0, index)]),
) as unknown as Record<MasteryLevel, readonly MasteryLevel[]>;

