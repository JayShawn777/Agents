import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { RETENTION_POLICY } from "@/lib/config";
import { RETENTION_POLICY_KEYS } from "@/lib/jobs/enforce-retention";

/**
 * Plan §7: "A unit test asserts every entry with a non-null `windowDays` has
 * a corresponding job step and vice versa, so the published policy can never
 * describe a window the code doesn't enforce."
 *
 * The map below is the one place that claims "job X enforces
 * `RETENTION_POLICY` key Y" — read alongside `lib/jobs/enforce-retention.ts`,
 * `lib/jobs/purge-pre-consent.ts` and `lib/jobs/purge-closed-accounts.ts` to
 * confirm each mapping is real, not merely declared here.
 */
const JOB_STEP_BY_RETENTION_KEY: Record<string, string> = {
  PRE_CONSENT: "purge-pre-consent.ts — StudentProfile rows, blob-first, per profile",
  SOURCE_FILE: "enforce-retention.ts — Upload blob deletion, extractedAt anchor + terminal FAILED",
  CONSENT_PSEUDONYM: "enforce-retention.ts — ConsentAuditArtifact.purgeAfter",
  CLOSED_ACCOUNT: "purge-closed-accounts.ts — deleteStudentData per profile, then the User row",
  DELETION_AUDIT: "enforce-retention.ts — DeletionAudit.completedAt",
  CHAT_TRANSCRIPT: "enforce-retention.ts — ChatSession.openedAt; ChatMessage cascades",
};

/**
 * `DIRECT_NOTICE` is DELIBERATELY absent from the map above. Per
 * `lib/jobs/enforce-retention.ts`'s own docstring, the plan's stated anchor
 * for this key (`deletedAt`) has no corresponding `DirectNotice` column, and
 * the row is `onDelete: Cascade` from `StudentProfile`, so it cannot outlive
 * deletion the way `DeletionAudit`/`ConsentAuditArtifact` do. No job can
 * enforce this key as currently specified — flagged as a plan gap rather
 * than silently worked around (see this task's report). If this is ever
 * fixed (either a real post-deletion notice-evidence artifact, or removing
 * the anchor from the plan/schema table), this exception should be deleted
 * in the SAME change that adds the real job step.
 */
const WINDOWED_KEYS_WITH_NO_ENFORCEABLE_JOB = new Set(["DIRECT_NOTICE"]);

describe("RETENTION_POLICY coverage (plan §7)", () => {
  it("every windowed key has a documented job step, or is the flagged DIRECT_NOTICE gap", () => {
    const windowedKeys = RETENTION_POLICY.filter((entry) => entry.windowDays !== null).map((entry) => entry.key);

    for (const key of windowedKeys) {
      const covered = key in JOB_STEP_BY_RETENTION_KEY || WINDOWED_KEYS_WITH_NO_ENFORCEABLE_JOB.has(key);
      expect(covered, `RETENTION_POLICY key "${key}" has a window but no job step and is not a documented gap`).toBe(
        true,
      );
    }
  });

  it("every job-step mapping points at a real RETENTION_POLICY key with a non-null window", () => {
    for (const key of Object.keys(JOB_STEP_BY_RETENTION_KEY)) {
      const entry = RETENTION_POLICY.find((e) => e.key === key);
      expect(entry, `"${key}" in the job-step map has no RETENTION_POLICY entry`).toBeDefined();
      expect(entry?.windowDays, `"${key}" in the job-step map has a null windowDays`).not.toBeNull();
    }
  });

  it("a null-windowDays key ('life of the ACTIVE profile') never appears in the job-step map", () => {
    const nullWindowKeys = RETENTION_POLICY.filter((entry) => entry.windowDays === null).map((entry) => entry.key);
    for (const key of nullWindowKeys) {
      expect(key in JOB_STEP_BY_RETENTION_KEY).toBe(false);
    }
  });

  it("RETENTION_POLICY_KEYS (lib/jobs/enforce-retention.ts) matches the real config export", () => {
    expect(RETENTION_POLICY_KEYS).toEqual(RETENTION_POLICY.map((entry) => entry.key));
  });
});

/**
 * **The gap this closes, because the tests above could not see it.**
 *
 * Every check above walks `RETENTION_POLICY` and asks whether each key is
 * enforced. None of them can notice a Prisma model that has NO key at all — so
 * M4 added `Lesson`, `LessonScriptVersion` and `LessonFlag`, and the whole
 * suite stayed green while lesson data derived from a child's schoolwork was
 * retained indefinitely AND `app/app/retention/page.tsx` — the parent-facing
 * COPPA disclosure, rendered straight off this array — said nothing about it.
 *
 * The disclosure half is what makes this more than untidy: a retention notice
 * that omits a category is not merely incomplete, it is inaccurate.
 *
 * So the schema itself is the source of truth here. Adding a model to
 * `schema.prisma` now FAILS this test until somebody classifies it, which
 * turns "remember to update the retention policy" from a habit into a
 * mechanism — the same move as deriving `GRADABLE_SUBJECTS` from taxonomy
 * coverage rather than hand-writing it.
 */
const MODEL_RETENTION_KEY: Record<string, string> = {
  // Student-derived data: each of these is covered by a published category.
  StudentProfile: "PROFILE_FIELDS",
  Upload: "SOURCE_FILE",
  Extraction: "EXTRACTED_TEXT",
  ExtractedProblem: "EXTRACTED_TEXT",
  PracticeSet: "PRACTICE_CONTENT",
  PracticeProblem: "PRACTICE_CONTENT",
  PracticeAnswerKey: "PRACTICE_CONTENT",
  Attempt: "ATTEMPT_HISTORY",
  SkillMastery: "MASTERY_RECORD",
  ChatSession: "CHAT_TRANSCRIPT",
  ChatMessage: "CHAT_TRANSCRIPT",
  Lesson: "LESSON_CONTENT",
  LessonScriptVersion: "LESSON_CONTENT",
  LessonFlag: "LESSON_CONTENT",
  DirectNotice: "DIRECT_NOTICE",
  ParentalConsent: "CONSENT_FULL",
  ConsentAuditArtifact: "CONSENT_PSEUDONYM",
  DeletionAudit: "DELETION_AUDIT",
  UploadTokenGrant: "SOURCE_FILE",
};

/**
 * Models that hold no data about a child and are therefore outside the
 * published policy. Each needs a reason, so that "it is not student data" is a
 * judgement someone made rather than the default for anything unlisted.
 */
const MODELS_OUTSIDE_THE_POLICY: Record<string, string> = {
  User: "The account holder — an adult. Covered by CLOSED_ACCOUNT on closure.",
  Account: "Auth.js OAuth linkage for the adult account holder.",
  Session: "ACCOUNT_SESSION covers this; deleted on sign-out, not on a timer.",
  VerificationToken: "Single-use magic-link token for the adult, deleted on redemption.",
  AdultAttestation: "The adult's own 18+ attestation, not data about a child.",
  ConsentVerificationChallenge: "Short-lived challenge in the adult's consent flow.",
};

describe("every Prisma model is classified against the retention policy", () => {
  const schema = readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
  const models = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((match) => match[1]);

  it("finds the models (guards against the regex silently matching nothing)", () => {
    // Without this, a schema rename or a formatting change would make every
    // assertion below vacuously true — the exact failure mode this file exists
    // to prevent, reproduced one level up.
    expect(models.length).toBeGreaterThan(20);
    expect(models).toContain("Lesson");
  });

  it("classifies every model as either covered by a policy key or explicitly outside it", () => {
    const unclassified = models.filter(
      (model) => !(model in MODEL_RETENTION_KEY) && !(model in MODELS_OUTSIDE_THE_POLICY),
    );
    expect(
      unclassified,
      `These Prisma models have no retention classification. If a model holds data derived from a child, ` +
        `add a RETENTION_POLICY entry in lib/config.ts (which also publishes it on /retention) and map it in ` +
        `MODEL_RETENTION_KEY. If it does not, add it to MODELS_OUTSIDE_THE_POLICY with a reason.`,
    ).toEqual([]);
  });

  it("maps every model only to a key that actually exists in RETENTION_POLICY", () => {
    const keys = new Set<string>(RETENTION_POLICY.map((entry) => entry.key));
    for (const [model, key] of Object.entries(MODEL_RETENTION_KEY)) {
      expect(keys.has(key), `${model} is mapped to "${key}", which is not a RETENTION_POLICY key`).toBe(true);
    }
  });

  it("does not classify a model that no longer exists in the schema", () => {
    const known = new Set(models);
    const stale = [...Object.keys(MODEL_RETENTION_KEY), ...Object.keys(MODELS_OUTSIDE_THE_POLICY)].filter(
      (model) => !known.has(model),
    );
    expect(stale, "These models are classified here but are gone from schema.prisma").toEqual([]);
  });
});
