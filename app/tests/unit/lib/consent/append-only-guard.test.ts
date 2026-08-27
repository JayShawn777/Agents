import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * ADR-0007 §3 / ADR-0008: `ParentalConsent` is append-only, with EXACTLY one
 * permitted mutation — the conditional `verified_at IS NULL` stamp — and it
 * may only ever be performed from `lib/consent/service.ts`. This is a static
 * guard, not a mocked-`db` unit test: a mocked `db` only proves that the
 * CODE PATHS this suite happens to exercise don't call `.update()`/
 * `.updateMany()` against `parentalConsent`; it says nothing about a NEW
 * call site added somewhere else entirely, in a file this suite never
 * imports. This test greps the real source tree so a second `UPDATE`
 * anywhere fails the build, not just the code path someone remembered to
 * test.
 *
 * Deliberately excludes `lib/generated/**` (Prisma's own generated client,
 * which naturally defines `.update`/`.updateMany` on every model as part of
 * its public API — that is the method being called, not a call site) and
 * `tests/**` (this suite and its siblings legitimately construct mock
 * objects shaped like `{ update: vi.fn() }`).
 */

const APP_ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const SCAN_DIRS = ["lib", "app"];
const EXCLUDED_DIR_SEGMENTS = new Set(["generated", "node_modules", ".next"]);
const ALLOWED_FILE = join(APP_ROOT, "lib", "consent", "service.ts");

// Matches `<something>.parentalConsent.update(` / `.updateMany(` — the actual
// call syntax, not prose. Doesn't match `.findFirst`/`.create`/etc.
const CALL_PATTERN = /\.parentalConsent\.(update|updateMany)\s*\(/g;

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

describe("ParentalConsent append-only guarantee — static guard (ADR-0007 §3)", () => {
  it("no file outside lib/consent/service.ts calls .parentalConsent.update(...) or .updateMany(...)", () => {
    const offenders: string[] = [];

    for (const dir of SCAN_DIRS) {
      const files = walk(join(APP_ROOT, dir));
      for (const file of files) {
        if (file === ALLOWED_FILE) continue;
        const contents = readFileSync(file, "utf8");
        if (CALL_PATTERN.test(contents)) {
          offenders.push(relative(APP_ROOT, file));
        }
        CALL_PATTERN.lastIndex = 0; // reset global regex state between files
      }
    }

    expect(offenders).toEqual([]);
  });

  it("lib/consent/service.ts DOES contain exactly one such call site — proving the guard above isn't vacuous", () => {
    const contents = readFileSync(ALLOWED_FILE, "utf8");
    const matches = contents.match(CALL_PATTERN) ?? [];
    expect(matches.length).toBe(1);
  });
});
