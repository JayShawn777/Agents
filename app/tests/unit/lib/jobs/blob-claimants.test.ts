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

  it("each registered claimant names a column that model actually has", () => {
    // The registry carries a column name because they are not all `pathname`.
    // A typo there would silently claim nothing, which fails toward DELETING.
    const blocks = new Map(modelBlocks().map((block) => [toModelAccessor(block.name), block.body]));
    for (const claimant of BLOB_CLAIMANTS) {
      const body = blocks.get(claimant.model);
      expect(body, `BLOB_CLAIMANTS names model "${claimant.model}", which is not in schema.prisma`).toBeDefined();
      expect(
        new RegExp(`^\\s*${claimant.column}\\s+String`, "m").test(body!),
        `BLOB_CLAIMANTS says ${claimant.model}.${claimant.column}, but that model has no such String column`,
      ).toBe(true);
    }
  });

  /**
   * **Matches any `*[Pp]athname` column, not just one literally called
   * `pathname`.** M6 added `CustomVoice.samplePathname`, which the original
   * `^pathname` pattern could not see — so a model owning the raw recording of
   * a real person's voice would have passed this check while `reconcile-blobs`
   * deleted its bytes an hour after upload. A completeness test that only
   * recognises one column NAME is not a completeness test.
   */
  const PATHNAME_FIELD = /^\s*(\w*[Pp]athname)\s+String/gm;

  /**
   * A pathname-shaped column that does NOT mean "this row owns those bytes".
   * Each needs a reason, so that "it is not a blob owner" is a judgement someone
   * made rather than the default for anything inconvenient.
   */
  const NOT_A_BLOB_OWNER: Record<string, string> = {
    voiceUploadGrant:
      "M6. `pathname` is where a grant PERMITS one write, not bytes this row owns — the " +
      "VoiceConsentRecording or CustomVoice row owns those once confirmed. A grant whose upload was " +
      "abandoned must NOT protect the object: an unconfirmed recording of a real person's voice sitting " +
      "in the store is exactly what reconcile-blobs should collect.",
    uploadTokenGrant:
      "`requestedPathname` records where a token was issued to write, not bytes this row owns — the Upload " +
      "row owns those once confirmed. A grant whose upload never completed must NOT protect the object: " +
      "reaping exactly that orphan is why this job exists (M0 AC 43).",
  };

  it("every model with a pathname-shaped field is a registered claimant, or a reasoned exception", () => {
    const registered = new Set<string>(BLOB_CLAIMANTS.map((claimant) => claimant.model));

    const blobOwningModels = modelBlocks()
      .filter((block) => new RegExp(PATHNAME_FIELD.source, "m").test(block.body))
      .map((block) => toModelAccessor(block.name))
      .filter((accessor) => !(accessor in NOT_A_BLOB_OWNER));

    const missing = blobOwningModels.filter((accessor) => !registered.has(accessor));

    expect(
      missing,
      `These Prisma models own a "pathname" but are missing from BLOB_CLAIMANTS in ` +
        `lib/jobs/reconcile-blobs.ts. reconcile-blobs treats an unclaimed object as an orphan, so it will ` +
        `DELETE their live blobs once past ORPHAN_THRESHOLD_MINUTES: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("every exception still names a model that exists and still has such a column", () => {
    // An exception that has gone stale is an exception nobody is checking.
    const blocks = new Map(modelBlocks().map((block) => [toModelAccessor(block.name), block.body]));
    for (const accessor of Object.keys(NOT_A_BLOB_OWNER)) {
      const body = blocks.get(accessor);
      expect(body, `NOT_A_BLOB_OWNER names "${accessor}", which is not in schema.prisma`).toBeDefined();
      expect(
        new RegExp(PATHNAME_FIELD.source, "m").test(body!),
        `"${accessor}" no longer has a pathname-shaped column, so this exception should be deleted`,
      ).toBe(true);
    }
  });

  it("does not register a claimant for a model that no longer owns a pathname", () => {
    const blobOwningAccessors = new Set(
      modelBlocks()
        .filter((block) => new RegExp(PATHNAME_FIELD.source, "m").test(block.body))
        .map((block) => toModelAccessor(block.name)),
    );

    const stale = BLOB_CLAIMANTS.map((claimant) => claimant.model).filter(
      (model) => !blobOwningAccessors.has(model),
    );

    expect(stale, "These claimants are registered but their model has no `pathname` field").toEqual([]);
  });
});
