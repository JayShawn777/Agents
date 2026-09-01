import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PROFILE_BLOB_SOURCES } from "@/lib/deletion/service";

/**
 * M5 §7.2 — the mechanism, not just the fix. `deleteStudentData`'s step 1
 * used to read only `db.upload`, so a profile's narration audio (a real
 * blob, scoped by `studentProfileId`, per ADR-0015) was never even
 * considered for deletion; the row cascaded away with the profile and
 * nothing about that looked wrong from the database side, which is exactly
 * why the gap survived unnoticed.
 *
 * `PROFILE_BLOB_SOURCES` is the registry that replaces the single
 * hard-coded read. This test is what keeps it complete: it reads
 * `schema.prisma` directly (the same mechanism
 * `tests/unit/lib/jobs/retention-policy-coverage.test.ts` uses for the
 * retention story) and fails the moment a model that owns a `pathname` AND
 * is scoped by a `studentProfileId` is missing from the array — so the
 * NEXT blob-writing model (M6's voice sample, most likely) is a
 * registration in this array, not a rediscovery of this exact gap.
 */
describe("PROFILE_BLOB_SOURCES coverage (M5 §7.2)", () => {
  const schema = readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");

  /**
   * One block per `model X { ... }` declaration, from the `model` keyword to
   * the first line that is a lone closing brace — the format every model in
   * this schema uses (see `prisma/schema.prisma`).
   */
  function modelBlocks(): Array<{ name: string; body: string }> {
    const blocks: Array<{ name: string; body: string }> = [];
    const regex = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
    for (const match of schema.matchAll(regex)) {
      blocks.push({ name: match[1], body: match[2] });
    }
    return blocks;
  }

  /** `Upload` -> `upload`, `NarrationAsset` -> `narrationAsset` — Prisma's own client accessor naming. */
  function toModelAccessor(prismaModelName: string): string {
    return prismaModelName.charAt(0).toLowerCase() + prismaModelName.slice(1);
  }

  it("finds model blocks (guards against the regex silently matching nothing)", () => {
    const blocks = modelBlocks();
    expect(blocks.length).toBeGreaterThan(20);
    expect(blocks.map((b) => b.name)).toContain("NarrationAsset");
  });

  it("every model with BOTH a `pathname` field and a `studentProfileId` field is a registered PROFILE_BLOB_SOURCES entry", () => {
    const registeredModels = new Set(PROFILE_BLOB_SOURCES.map((source) => source.model));

    const blobOwningModels = modelBlocks().filter(
      (block) => /^\s*pathname\s+String/m.test(block.body) && /^\s*studentProfileId\s+String/m.test(block.body),
    );

    const missing = blobOwningModels
      .map((block) => toModelAccessor(block.name))
      .filter((accessor) => !registeredModels.has(accessor as (typeof PROFILE_BLOB_SOURCES)[number]["model"]));

    expect(
      missing,
      `These Prisma models own a "pathname" field scoped by "studentProfileId" but are missing from ` +
        `PROFILE_BLOB_SOURCES in lib/deletion/service.ts, so deleteStudentData() will never delete their blobs: ` +
        `${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("does not register a model that no longer exists in the schema", () => {
    const knownAccessors = new Set(modelBlocks().map((block) => toModelAccessor(block.name)));
    const stale = PROFILE_BLOB_SOURCES.map((source) => source.model).filter(
      (model) => !knownAccessors.has(model),
    );
    expect(stale, "These PROFILE_BLOB_SOURCES entries have no matching model in schema.prisma").toEqual([]);
  });

  it("both known M0/M5 sources are present, by name (documents the registry rather than only its mechanism)", () => {
    expect(PROFILE_BLOB_SOURCES.map((source) => source.model)).toEqual(["upload", "narrationAsset"]);
  });
});
