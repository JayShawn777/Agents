import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * **`lib/personas/dal.ts` is the only module allowed to read the `Persona`
 * table**, and this test is what keeps that true.
 *
 * ## The defect it exists to prevent, which was real
 *
 * Until M6, a persona was app reference data owned by nobody, so an unscoped
 * read was correct and four of them existed outside the DAL. `Persona.ownerUserId`
 * makes a cloned voice the property of one account — and the same unscoped
 * query then lets account A point their child's narration at account B's cloned
 * parent voice. A stranger's real voice reading a child's homework, reachable by
 * pasting one cuid.
 *
 * The worst of the four was `resolvePersonaForNarration`, which decides which
 * voice actually SPEAKS.
 *
 * ## Why a static check rather than a code review rule
 *
 * Retro lesson 22, and the third time this project has reached for this
 * mechanism (`retention-policy-coverage`, `blob-claimants`,
 * `no-voice-id-literals`). A convention that lives only in a docstring is one
 * hurried `db.persona.findFirst` away from being gone, and nothing would fail —
 * the query returns a row, the page renders, the voice plays. It is only wrong
 * for the account that did not own it.
 *
 * The DAL's readers all take a REQUIRED `viewerUserId` for the same reason: an
 * optional parameter is how this comes back.
 */
describe("Persona is read through exactly one module (M6 AC 12)", () => {
  const repoRoot = process.cwd();
  const DAL = "lib/personas/dal.ts";

  /** Every first-party `.ts`/`.tsx` file — excludes generated client and node_modules. */
  function sourceFiles(): string[] {
    return execSync(
      `find ${repoRoot}/lib ${repoRoot}/app ${repoRoot}/components ${repoRoot}/hooks ` +
        `-type f \\( -name '*.ts' -o -name '*.tsx' \\) -not -path '*/generated/*' 2>/dev/null || true`,
      { encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean)
      .map((file) => path.relative(repoRoot, file));
  }

  /**
   * Any Prisma read through the persona delegate. Deliberately matches WRITES
   * too (`create`, `update`, `delete`): M6 slices 6 and 7 will add those, and
   * they belong in the DAL beside the readers rather than scattered into routes.
   */
  const PERSONA_ACCESS = /\bdb\.persona\.\w+|\btx\.persona\.\w+/;

  it("finds the source tree (guards against the search silently matching nothing)", () => {
    const files = sourceFiles();
    // Without this, a moved directory would make every assertion below vacuously
    // true — retro lesson 22's own failure mode, one level up.
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain(DAL);
  });

  it("the DAL really does access the persona table (the check is not vacuous)", () => {
    const dal = readFileSync(path.join(repoRoot, DAL), "utf8");
    expect(PERSONA_ACCESS.test(dal)).toBe(true);
  });

  it("no module other than lib/personas/dal.ts touches db.persona", () => {
    const offenders = sourceFiles()
      .filter((file) => file !== DAL)
      .filter((file) => PERSONA_ACCESS.test(readFileSync(path.join(repoRoot, file), "utf8")));

    expect(
      offenders,
      `These files read or write the Persona table directly. Every persona access must go through ` +
        `lib/personas/dal.ts, whose readers take a required viewerUserId and compose ` +
        `personaVisibilityWhere() — without it, one account can select another account's cloned ` +
        `voice (M6 AC 12): ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("every exported reader in the DAL takes a viewer, or is explicitly shared-only", () => {
    const dal = readFileSync(path.join(repoRoot, DAL), "utf8");
    const exported = [...dal.matchAll(/export async function (\w+)\s*\(([^)]*)\)/g)];

    expect(exported.length).toBeGreaterThan(2);

    for (const [, name, params] of exported) {
      const takesViewer = /viewerUserId\s*:\s*string/.test(params);
      // `findSharedPersonaBySlug` is the one deliberate exception: it hard-codes
      // `ownerUserId: null`, so it cannot reach an owned persona at all. The
      // name says so, which is the point — an exception a reader can see.
      const isSharedOnly = name.startsWith("findShared");
      expect(
        takesViewer || isSharedOnly,
        `${name}() reads personas without a viewerUserId and is not named as shared-only. ` +
          `Either take a required viewerUserId and compose personaVisibilityWhere(), or restrict the ` +
          `query to ownerUserId: null and name it findShared*.`,
      ).toBe(true);
    }
  });

  it("the shared-only reader really does restrict to ownerUserId: null", () => {
    const dal = readFileSync(path.join(repoRoot, DAL), "utf8");
    const shared = dal.slice(dal.indexOf("export async function findSharedPersonaBySlug"));
    // The name is a promise; this is the check that it is kept.
    expect(shared).toContain("ownerUserId: null");
  });
});
