import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * ADR-0010 §2: "a reviewer can audit 'can a level ever fall?' by reading
 * `lib/mastery/apply.ts` and grepping for any other write to
 * `skillMastery.level`." This is that grep, made permanent — the SAME
 * static-guard shape as `tests/unit/lib/consent/append-only-guard.test.ts`
 * for `ParentalConsent`. A mocked-`db` unit test only proves the code paths
 * it happens to exercise don't write `skillMastery`; this greps the whole
 * source tree so a second write site anywhere fails the build.
 */

const APP_ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const SCAN_DIRS = ["lib", "app"];
const EXCLUDED_DIR_SEGMENTS = new Set(["generated", "node_modules", ".next"]);
const ALLOWED_FILE = join(APP_ROOT, "lib", "mastery", "apply.ts");

// Matches `<something>.skillMastery.update(` / `.updateMany(` / `.upsert(` /
// `.create(` / `.createMany(` — every write verb Prisma exposes on the
// model. Doesn't match `.findFirst`/`.findUnique`/`.findMany`/`.count`.
const WRITE_PATTERN = /\.skillMastery\.(update|updateMany|upsert|create|createMany|delete|deleteMany)\s*\(/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_DIR_SEGMENTS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("SkillMastery sole-writer guarantee — static guard (ADR-0010 §2)", () => {
  it("no file outside lib/mastery/apply.ts writes .skillMastery.*(...)", () => {
    const offenders: string[] = [];

    for (const dir of SCAN_DIRS) {
      const files = walk(join(APP_ROOT, dir));
      for (const file of files) {
        if (file === ALLOWED_FILE) continue;
        const contents = readFileSync(file, "utf8");
        if (WRITE_PATTERN.test(contents)) {
          offenders.push(relative(APP_ROOT, file));
        }
        WRITE_PATTERN.lastIndex = 0;
      }
    }

    expect(offenders).toEqual([]);
  });

  it("lib/mastery/apply.ts DOES contain write call sites — proving the guard above isn't vacuous", () => {
    const contents = readFileSync(ALLOWED_FILE, "utf8");
    const matches = contents.match(WRITE_PATTERN) ?? [];
    expect(matches.length).toBeGreaterThan(0);
  });
});
