import { afterAll, describe, expect, it } from "vitest";

import { configureDirectDatabaseUrl } from "./db-test-url";

configureDirectDatabaseUrl();

const { db } = await import("@/lib/db");

/**
 * ADR-0017's CHECK constraint, against real Postgres.
 *
 * This file exists because the constraint is invisible in `schema.prisma` —
 * Prisma cannot express a CHECK, so it is hand-written in
 * `20260827075342_m2_5_checkpoint_kind_and_problem_language/migration.sql`.
 * A reader of the schema sees a nullable `extractionId` and a `kind` column
 * with no visible relationship between them. The ADR's whole argument is that
 * the relationship is enforced by the database rather than remembered by
 * application code, and that argument is worth exactly as much as this file.
 *
 * Both directions matter. Dropping NOT NULL weakened M2 AC 3 — "practice only
 * ever comes from a CONFIRMED extraction" — and the constraint gives it back;
 * it also adds a guarantee M2 never had, that a CHECKPOINT cannot claim a
 * worksheet it was not built from.
 */
describe("PracticeSet.kind is paired with extractionId by the database itself", () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    for (const id of createdUserIds) {
      await db.user.delete({ where: { id } }).catch(() => {});
    }
  });

  async function fixture() {
    const user = await db.user.create({
      data: { email: `kind-constraint-${Date.now()}-${Math.random()}@example.com`, adultAttestedAt: new Date() },
    });
    createdUserIds.push(user.id);
    const profile = await db.studentProfile.create({
      data: { userId: user.id, ageBand: "UNDER_13", status: "ACTIVE", gradeLevel: "GRADE_4" },
    });
    const upload = await db.upload.create({
      data: {
        studentProfileId: profile.id,
        pathname: `students/${profile.id}/uploads/kind-${Date.now()}.jpg`,
        contentType: "image/jpeg",
        sizeBytes: 10,
        originalFilename: "x.jpg",
        status: "STORED",
      },
    });
    const extraction = await db.extraction.create({
      data: { uploadId: upload.id, model: "claude-opus-5", status: "CONFIRMED" },
    });
    return { profile, extraction };
  }

  const provenance = { model: "claude-opus-5", effort: "high", promptVersion: "test", taxonomyVersion: "test" };

  it("accepts PRACTICE with an extraction — the M2 shape, unchanged", async () => {
    const { profile, extraction } = await fixture();
    const set = await db.practiceSet.create({
      data: { studentProfileId: profile.id, extractionId: extraction.id, kind: "PRACTICE", status: "READY", ...provenance },
    });
    expect(set.kind).toBe("PRACTICE");
    expect(set.extractionId).toBe(extraction.id);
  });

  it("accepts CHECKPOINT with no extraction — the M2.5 shape", async () => {
    const { profile } = await fixture();
    const set = await db.practiceSet.create({
      data: { studentProfileId: profile.id, kind: "CHECKPOINT", status: "READY", ...provenance },
    });
    expect(set.kind).toBe("CHECKPOINT");
    expect(set.extractionId).toBeNull();
  });

  it("REJECTS practice with no extraction — M2 AC 3, given back after the column went nullable", async () => {
    const { profile } = await fixture();
    await expect(
      db.practiceSet.create({
        data: { studentProfileId: profile.id, kind: "PRACTICE", status: "READY", ...provenance },
      }),
    ).rejects.toThrow(/practice_set_kind_source/);
  });

  it("REJECTS a checkpoint that claims a worksheet — a guarantee M2 never had", async () => {
    const { profile, extraction } = await fixture();
    await expect(
      db.practiceSet.create({
        data: { studentProfileId: profile.id, extractionId: extraction.id, kind: "CHECKPOINT", status: "READY", ...provenance },
      }),
    ).rejects.toThrow(/practice_set_kind_source/);
  });

  it("REJECTS an UPDATE that would break the pairing, not only an insert", async () => {
    const { profile, extraction } = await fixture();
    const set = await db.practiceSet.create({
      data: { studentProfileId: profile.id, extractionId: extraction.id, kind: "PRACTICE", status: "READY", ...provenance },
    });
    await expect(
      db.practiceSet.update({ where: { id: set.id }, data: { kind: "CHECKPOINT" } }),
    ).rejects.toThrow(/practice_set_kind_source/);
  });

  it("deleting the extraction cannot reach a checkpoint — ADR-0017's cascade consequence", async () => {
    const { profile, extraction } = await fixture();
    const checkpoint = await db.practiceSet.create({
      data: { studentProfileId: profile.id, kind: "CHECKPOINT", status: "READY", ...provenance },
    });
    await db.extraction.delete({ where: { id: extraction.id } });

    expect(await db.practiceSet.findUnique({ where: { id: checkpoint.id } })).not.toBeNull();
  });
});
