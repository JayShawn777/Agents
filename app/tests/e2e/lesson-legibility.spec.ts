import { expect, test } from "@playwright/test";

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

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
 * **IT RAN, on 2026-08-28, and it found something.** This is no longer an
 * estimate: three fixtures at both viewports, in Chromium.
 *
 * **The result.** At 1280px all three laid out clean. At 375px one failed —
 * the reading fixture's `rule` label, "the main idea of the whole paragraph"
 * at `y: 0.14`, measured `y -3..77` of a 257px stage. It wraps to four lines
 * on a phone, `boxAt` centres it on its point, and the stage clips with
 * `overflow-hidden`: a child would have seen the top line of a label sliced
 * off. One of three scripts is far above §9.2's 5% threshold, so §9.2's
 * "a deterministic layout pass becomes M4 scope" fired, and
 * `clampToBounds`/`offsetToBounds` in `lib/lessons/layout.ts` are it. Both
 * viewports pass against the clamp.
 *
 * **n is 3, and the threshold wants more.** Three fixtures cannot measure a 5%
 * rate; what they did was find a real defect, which is worth more than a
 * precise number over a wider sample would have been. Widening the fixture set
 * is the honest follow-up, and the wrapped-label shape is now the one to add
 * more of — it is the only shape that failed, and the three maths fixtures
 * would never have produced it.
 *
 * ---
 *
 * **What was actually wrong with auth, because the guess here was wrong.**
 *
 * This header used to say the seeded session cookie was not accepted by
 * `auth()`, and sent the next person to check `lib/auth/config.ts` for a
 * `cookies`/`basePath` override, `useSecureCookies`, and whether v5 wraps a
 * database session token. All three were the wrong tree. The cookie was always
 * correct: for `strategy: "database"` the cookie value IS the raw
 * `sessionToken` (@auth/core's own `SessionToken` type says so), and over http
 * the name is exactly `authjs.session-token`.
 *
 * **`AUTH_SECRET` was commented out in `.env`.** `assertConfig` fails with
 * `MissingSecret` before any cookie is read, so `auth()` returned null for
 * every request — which is why the two probes returned *the same* 401 with and
 * without a cookie. That symmetry was the tell, and reading it as "the cookie
 * is not accepted" is what cost the time: an unaccepted cookie and an
 * unreadable config are indistinguishable at the status code, and the server
 * log said which it was all along.
 *
 * A missing secret is not a test-harness problem — nobody could sign in to
 * this app in this environment at all. Set `AUTH_SECRET` in `.env` (the guard
 * hook blocks agents from writing it, so a human does this once) and both
 * viewports pass.
 */

/**
 * **Why this is guarded rather than simply enabled.**
 *
 * These tests need a real signed-in session, and `auth()` returns null for
 * every request unless `AUTH_SECRET` is set — see the header above. Setting it
 * lives in `.env`, which the guard hook reserves for a human, so on a fresh
 * checkout it is genuinely absent. Un-skipping unconditionally would make
 * `pnpm test:e2e` RED for everyone who has not done that owner action, which
 * reads as "the lesson renderer is broken" when the truth is "nobody measured".
 *
 * A skip says the second thing. The env var covers `AUTH_SECRET=... pnpm
 * test:e2e`; the `.env` scan covers the case where the owner has set it
 * properly, since Playwright's config does not load `.env` itself.
 */
function authSecretAvailable(): boolean {
  if (process.env.AUTH_SECRET) return true;
  try {
    return /^\s*AUTH_SECRET\s*=\s*\S+/m.test(readFileSync(".env", "utf8"));
  } catch {
    return false;
  }
}

const HAS_AUTH_SECRET = authSecretAvailable();

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
  test.describe(`at ${viewport.width}px (${viewport.name})`, () => {
    test.skip(
      !HAS_AUTH_SECRET,
      "AUTH_SECRET is not set, so no request can authenticate — see this file's header.",
    );

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
