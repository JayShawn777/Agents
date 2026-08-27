import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `server-only` throws unconditionally when a module carrying it is pulled
 * into a client bundle — it is the project's compile-time guard against
 * ever shipping Prisma (or any server secret) to the browser (CLAUDE.md).
 * Every other server module in this codebase carries it; `lib/db.ts` is the
 * one file where a missing guard is worst, since it IS the Prisma client.
 *
 * This can't be asserted by importing `lib/db.ts` and checking behavior:
 * Vitest aliases the bare `server-only` import to a no-op shim
 * (`tests/unit/mocks/server-only.ts`) precisely so server modules can be
 * unit tested under plain Node, which means the import's absence would be
 * silently unobservable at runtime here. Asserting on the source text is
 * deliberate for that reason.
 */
describe("lib/db.ts", () => {
  it("imports server-only", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../../../lib/db.ts"), "utf8");
    expect(source).toMatch(/^import "server-only";/m);
  });
});
