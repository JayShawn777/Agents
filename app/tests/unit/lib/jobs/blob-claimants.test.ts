import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { BLOB_CLAIMANTS } from "@/lib/jobs/reconcile-blobs";

/**
 * 2026-09-02 security review. `PROFILE_BLOB_SOURCES` had a completeness test
 * (`tests/unit/lib/deletion/blob-sources.test.ts`); `BLOB_CLAIMANTS` did not,
 * because it was an array of anonymous closures nothing could introspect.
 *
 * **The two registries fail in OPPOSITE directions, and this is the dangerous
 * one.** A model missing from `PROFILE_BLOB_SOURCES` means a blob is not
 * deleted when it should be. A model missing from `BLOB_CLAIMANTS` means
 * `reconcile-blobs` sees a live object no claimant recognises and DELETES IT —
 * exactly the M5 §7.1 incident this registry was created to prevent, where
 * every narration object in the store would have been collected while its
 * `NarrationAsset` rows survived pointing at nothing.
 *
 * So the predicate here is deliberately WIDER than the blob-sources one. That
 * test only catches models with BOTH `pathname` and `studentProfileId`, which
 * misses an account-scoped blob (M6's consented voice sample is the obvious
 * next one). This one catches any model owning a `pathname` at all.
 */
describe("BLOB_CLAIMANTS coverage (2026-09-02)", () => {
  const schema = readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");

  function modelBlocks(): Array<{ name: string; body: string }> {
    const blocks: Array<{ name: string; body: string }> = [];
    const regex = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
    for (const match of schema.matchAll(regex)) {
      blocks.push({ name: match[1], body: match[2] });
    }
    return blocks;
  }

  /** `Upload` -> `upload`, `NarrationAsset` -> `narrationAsset` — Prisma's client accessor naming. */
  function toModelAccessor(prismaModelName: string): string {
    return prismaModelName.charAt(0).toLowerCase() + prismaModelName.slice(1);
  }

  it("finds model blocks (guards against the regex silently matching nothing)", () => {
    const blocks = modelBlocks();
    expect(blocks.length).toBeGreaterThan(20);
    expect(blocks.map((b) => b.name)).toContain("NarrationAsset");
  });

  it("every model with a `pathname` field is a registered claimant", () => {
    const registered = new Set<string>(BLOB_CLAIMANTS.map((claimant) => claimant.model));

    const blobOwningModels = modelBlocks()
      .filter((block) => /^\s*pathname\s+String/m.test(block.body))
      .map((block) => toModelAccessor(block.name));

    const missing = blobOwningModels.filter((accessor) => !registered.has(accessor));

    expect(
      missing,
      `These Prisma models own a "pathname" but are missing from BLOB_CLAIMANTS in ` +
        `lib/jobs/reconcile-blobs.ts. reconcile-blobs treats an unclaimed object as an orphan, so it will ` +
        `DELETE their live blobs once past ORPHAN_THRESHOLD_MINUTES: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("does not register a claimant for a model that no longer owns a pathname", () => {
    const blobOwningAccessors = new Set(
      modelBlocks()
        .filter((block) => /^\s*pathname\s+String/m.test(block.body))
        .map((block) => toModelAccessor(block.name)),
    );

    const stale = BLOB_CLAIMANTS.map((claimant) => claimant.model).filter(
      (model) => !blobOwningAccessors.has(model),
    );

    expect(stale, "These claimants are registered but their model has no `pathname` field").toEqual([]);
  });
});
