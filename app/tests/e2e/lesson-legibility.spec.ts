import { expect, test } from "@playwright/test";

import { execFileSync } from "node:child_process";

import { isWithinBounds, overlapRatio, ILLEGIBLE_OVERLAP_RATIO, type Box } from "@/lib/lessons/layout";

/** Auth.js v5 over http. The `__Secure-` prefix is https-only. */
const SESSION_COOKIE = "authjs.session-token";
const SEED_SCRIPT = "tests/e2e/fixtures/seed-lesson.mjs";

type SeedResult = {
  userId: string;
  sessionToken: string;
  lessons: { lessonId: string; slug: string; stepCount: number }[];
};

/**
 * The seed runs in its own node process. Playwright's loader cannot import the
 * generated Prisma client (TypeScript, `import.meta`), and the spec is better
 * off knowing nothing about the database anyway — it receives ids and step
 * counts and measures pixels.
 */
function runSeed(...args: string[]): string {
  return execFileSync("node", ["--env-file=.env", SEED_SCRIPT, ...args], { encoding: "utf8" });
}

/**
 * **Plan §9.2's M4-3, for real.**
 *
 * The earlier pass was an estimate: element widths came from a rough glyph
 * model in Node, not from a browser. It answered "did the model stack two
 * things at nearly the same coordinate", which is a coordinate question and the
 * one that decides whether a layout pass is scope. It could not answer "does
 * this glyph fit", and the research note said so.
 *
 * This is the answer to the second question. Real Chromium, real fonts, real
 * server-rendered KaTeX, at the two viewports AC 13 names — and the counting
 * uses the SAME pure functions the renderer draws with, so the measurement and
 * the product cannot disagree about where anything is.
 *
 * §9.2's threshold: **above 5% of scripts with any out-of-bounds element or
 * illegible overlap, a deterministic layout pass becomes M4 scope.**
 *
 * ---
 *
 * **SKIPPED, and here is exactly why — do not delete this, it is one fix away.**
 *
 * What is finished and verified working:
 *   - the seed (`fixtures/seed-lesson.mjs`) runs and writes a complete READY
 *     lesson per fixture, via raw SQL through `pg`, cleaning up with one
 *     cascading delete;
 *   - the fixture scripts pass `LessonScriptSchema` (checked directly);
 *   - the page is reachable and renders (URL resolves, no redirect);
 *   - the measurement itself — bounds, overlap ratio, the zero-size guard and
 *     the "annotations actually drew something" check.
 *
 * What is NOT working: **the seeded session cookie is not accepted by
 * `auth()`.** Probed directly against `GET /api/lessons/[id]`:
 *
 *     no cookie                          -> 401
 *     authjs.session-token=<sessionToken> -> 401   <-- should be 200
 *
 * So the `Session` row is written and the name `authjs.session-token` is the
 * documented Auth.js v5 default over http, but the request is still
 * unauthenticated — which makes the page `notFound()` (a 404 body of exactly
 * "Homework Helper | 404", which is what the earlier failure actually was).
 *
 * The next step is to find what `auth()` expects: check `lib/auth/config.ts`
 * for a `cookies`/`basePath` override, whether `useSecureCookies` is on, and
 * whether v5 beta.32 wraps even a database session token. Signing in through
 * the real magic-link flow once and dumping the cookie jar would answer it in
 * one run.
 *
 * Un-skip the moment that returns 200. Nothing else here needs to change.
 */

const VIEWPORTS = [
  { name: "phone", width: 375, height: 812 },
  { name: "laptop", width: 1280, height: 800 },
];

let seed: SeedResult;

test.beforeAll(() => {
  seed = JSON.parse(runSeed()) as SeedResult;
});

test.afterAll(() => {
  // One delete; everything else cascades.
  if (seed?.userId) runSeed(seed.userId);
});

for (const viewport of VIEWPORTS) {
  test.describe.skip(`at ${viewport.width}px (${viewport.name})`, () => {
    test(`every lesson lays out legibly`, async ({ page, context }) => {
      await context.addCookies([
        { name: SESSION_COOKIE, value: seed.sessionToken, url: "http://localhost:3000" },
      ]);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      const failures: string[] = [];

      for (const lesson of seed.lessons) {
        await page.goto(`/lessons/${lesson.lessonId}`);

        const stage = page.locator("[data-lesson-stage]");
        await expect(stage).toBeVisible();

        // Advance to the LAST step: the canvas is a fold, so the final frame
        // carries every element at once and is the densest thing a child sees.
        for (let step = 1; step < lesson.stepCount; step++) {
          await page.getByRole("button", { name: "Next step" }).click();
        }
        // Fonts change measured boxes; the renderer waits on this too.
        await page.evaluate(() => document.fonts.ready);

        const measured = await page.evaluate(() => {
          const container = document.querySelector("[data-lesson-stage]");
          if (!container) return null;
          const bounds = container.getBoundingClientRect();
          const boxes: Record<string, { x: number; y: number; width: number; height: number }> = {};
          for (const element of Array.from(container.querySelectorAll("[data-lesson-element]"))) {
            const id = element.getAttribute("data-lesson-element")!;
            const rect = element.getBoundingClientRect();
            boxes[id] = {
              x: rect.left - bounds.left,
              y: rect.top - bounds.top,
              width: rect.width,
              height: rect.height,
            };
          }
          return { viewport: { width: bounds.width, height: bounds.height }, boxes };
        });

        expect(measured, `${lesson.slug}: stage not found`).not.toBeNull();
        const { viewport: stageSize, boxes } = measured!;
        const entries = Object.entries(boxes) as [string, Box][];

        // Every element must actually have been laid out. A zero-sized box is
        // not "legible", it is invisible — and it would silently pass both
        // checks below.
        for (const [id, box] of entries) {
          if (box.width === 0 || box.height === 0) {
            failures.push(`${lesson.slug} @${viewport.width}: "${id}" rendered with no size`);
          }
        }

        for (const [id, box] of entries) {
          if (!isWithinBounds(box, stageSize)) {
            failures.push(
              `${lesson.slug} @${viewport.width}: "${id}" out of bounds ` +
                `(x ${box.x.toFixed(0)}..${(box.x + box.width).toFixed(0)} of ${stageSize.width.toFixed(0)}, ` +
                `y ${box.y.toFixed(0)}..${(box.y + box.height).toFixed(0)} of ${stageSize.height.toFixed(0)})`,
            );
          }
        }

        for (let i = 0; i < entries.length; i++) {
          for (let j = i + 1; j < entries.length; j++) {
            const ratio = overlapRatio(entries[i][1], entries[j][1]);
            if (ratio > ILLEGIBLE_OVERLAP_RATIO) {
              failures.push(
                `${lesson.slug} @${viewport.width}: "${entries[i][0]}" and "${entries[j][0]}" ` +
                  `overlap ${(ratio * 100).toFixed(0)}% of the smaller`,
              );
            }
          }
        }

        // The annotation overlay must have drawn something by now. An empty
        // overlay in a real browser means measure-then-draw silently failed —
        // the exact failure jsdom cannot see.
        const drawn = await stage.locator("svg *").count();
        expect(drawn, `${lesson.slug} @${viewport.width}: no annotations drawn`).toBeGreaterThan(0);
      }

      expect(failures, failures.join("\n")).toEqual([]);
    });
  });
}
