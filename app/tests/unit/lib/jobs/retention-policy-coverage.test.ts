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
