/**
 * Seeds READY lessons and an authenticated session for M4-3's browser
 * measurement, then prints JSON on stdout.
 *
 * **A standalone ESM script run in its own process, deliberately.** Playwright's
 * loader cannot import the generated Prisma client — it is ESM and uses
 * `import.meta`, which the spec transform chokes on. Spawning node directly
 * side-steps that entirely and keeps the spec free of any database dependency:
 * the spec receives ids and step counts, and nothing else.
 *
 *   node --env-file=.env tests/e2e/fixtures/seed-lesson.mjs         → seed, print JSON
 *   node --env-file=.env tests/e2e/fixtures/seed-lesson.mjs <userId> → clean up
 *
 * **Why seed rather than drive the UI.** Reaching a lesson through the product
 * means signing in, consenting, uploading, extracting, generating practice,
 * attempting a problem, and waiting 12-59 seconds for a real authoring call —
 * per fixture, per viewport. That measures the whole app's flakiness, costs real
 * money every run, and adds nothing to the one question M4-3 asks: does the
 * model's placement lay out legibly in a real browser. The page itself is still
 * exercised for real — DAL, DTOs, server-rendered KaTeX and the
 * measure-then-draw pass all run.
 *
 * Auth is a database session (ADR-0002), so a row plus its cookie is a genuine
 * sign-in rather than a bypass: nothing is told to skip a check.
 */

import path from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

// Raw SQL through `pg` rather than the Prisma client, and the reason is
// mechanical: the generated client is TypeScript (`client.ts`) using
// `import.meta`, so neither Playwright's CJS transform nor plain node can load
// it. `pg` is already in the tree as the driver adapter's own dependency.
// Resolved from that package so this does not depend on a hoisting accident.
// Resolved from the adapter's own directory rather than through its package
// exports, which do not expose `package.json`. pnpm's layout means `pg` is not
// hoisted to the app root, so a bare `require("pg")` would miss it.
const require = createRequire(import.meta.url);
const adapterDir = path.dirname(require.resolve("@prisma/adapter-pg"));
const { Client } = require(require.resolve("pg", { paths: [adapterDir] }));

/**
 * Fixture scripts, taken from real authored output
 * (`docs/research/m4-authoring-measurement.md`) rather than invented. Chosen
 * for what they stress:
 *
 *   - maths — the shape the vocabulary was designed around.
 *   - reading — the LONG labels. The model produced a 65-character label and
 *     the schema permits 120; unwrapped that spans nearly the whole canvas at
 *     1280px and cannot fit one line at 375px. This is the fixture that decides
 *     whether wrapping actually works.
 *   - science — many elements laid out spatially, where out-of-bounds placement
 *     would surface first.
 */
const FIXTURE_SCRIPTS = [
  {
    slug: "fractions",
    title: "Adding quarters",
    steps: [
      {
        id: "s1",
        narration: "We start with one quarter plus one quarter.",
        durationMs: 4000,
        ops: [{ kind: "write", id: "sum", latex: "\\frac{1}{4}+\\frac{1}{4}", at: { x: 0.5, y: 0.22 }, size: "lg" }],
      },
      {
        id: "s2",
        narration: "The bottom number counts the pieces, so it does not change.",
        durationMs: 5000,
        ops: [
          { kind: "label", id: "rule", text: "the bottom number stays the same", at: { x: 0.5, y: 0.45 } },
          { kind: "circle", id: "ring", target: "sum" },
        ],
      },
      {
        id: "s3",
        narration: "One plus one is two, so the answer is two quarters.",
        durationMs: 3500,
        ops: [
          { kind: "write", id: "answer", latex: "\\frac{2}{4}", at: { x: 0.5, y: 0.72 }, size: "lg" },
          { kind: "underline", id: "mark", target: "answer" },
        ],
      },
    ],
  },
  {
    slug: "reading-long-labels",
    title: "Finding the Topic Sentence: Bats",
    steps: [
      {
        id: "s1",
        narration: "Here is the paragraph, split into its three sentences.",
        durationMs: 6000,
        ops: [
          { kind: "label", id: "one", text: "1. Bats are unusual mammals.", at: { x: 0.3, y: 0.14 } },
          { kind: "label", id: "two", text: "2. They are the only mammals that can truly fly.", at: { x: 0.3, y: 0.38 } },
          {
            kind: "label",
            id: "three",
            text: "3. Their wings are made of skin stretched over long finger bones.",
            at: { x: 0.3, y: 0.66 },
          },
        ],
      },
      {
        id: "s2",
        narration: "The topic sentence tells the main idea of the whole paragraph.",
        durationMs: 5000,
        ops: [
          { kind: "label", id: "rule", text: "the main idea of the whole paragraph", at: { x: 0.78, y: 0.14 } },
          { kind: "highlight", id: "h2", target: "two" },
        ],
      },
      {
        id: "s3",
        narration: "The first sentence is the only one that covers all of them, so that is the topic sentence.",
        durationMs: 5000,
        ops: [
          { kind: "underline", id: "answer", target: "one" },
          { kind: "arrow", id: "a1", from: "two", to: "one", curve: "arc" },
        ],
      },
    ],
  },
  {
    slug: "science-food-chain",
    title: "A food chain from grass to hawk",
    steps: [
      {
        id: "s1",
        narration: "A food chain starts with a plant, which makes its own food.",
        durationMs: 4000,
        ops: [{ kind: "label", id: "grass", text: "grass", at: { x: 0.14, y: 0.25 } }],
      },
      {
        id: "s2",
        narration: "A grasshopper eats the grass, and a mouse eats the grasshopper.",
        durationMs: 5000,
        ops: [
          { kind: "label", id: "hopper", text: "grasshopper", at: { x: 0.42, y: 0.25 } },
          { kind: "label", id: "mouse", text: "mouse", at: { x: 0.7, y: 0.25 } },
          { kind: "arrow", id: "e1", from: "grass", to: "hopper", curve: "straight" },
          { kind: "arrow", id: "e2", from: "hopper", to: "mouse", curve: "straight" },
        ],
      },
      {
        id: "s3",
        narration: "The hawk eats the mouse. Each arrow means is eaten by.",
        durationMs: 5000,
        ops: [
          { kind: "label", id: "hawk", text: "hawk", at: { x: 0.5, y: 0.55 } },
          { kind: "arrow", id: "e3", from: "mouse", to: "hawk", curve: "arc" },
          { kind: "label", id: "key", text: 'each arrow means "is eaten by"', at: { x: 0.5, y: 0.82 } },
        ],
      },
    ],
  },
];

/**
 * **Refuse to touch anything but a local database.**
 *
 * This script writes rows with raw SQL, mints a real `Session` row, and cleans
 * up with `DELETE FROM "User"` — which cascades across a family's entire data.
 * `.env`'s `DATABASE_URL` normally points at the local `prisma dev` server, but
 * nothing stopped it being pointed at Neon for an afternoon (the runbook has
 * people swapping connection strings), and a Playwright run would then have
 * seeded and deleted production rows without a word.
 *
 * The check is on the HOST, not on a `NODE_ENV` or a flag, because the thing
 * that must be true is "this is not the real database" and the host is what
 * makes that true. A test fixture is exactly the kind of code nobody reads
 * again, so it should refuse loudly rather than rely on being run correctly.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function assertLocalDatabase(connectionString) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Run with `node --env-file=.env`.");
  }
  let host;
  try {
    host = new URL(connectionString).hostname;
  } catch {
    throw new Error("DATABASE_URL is not a parseable URL; refusing to seed.");
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to seed: DATABASE_URL points at "${host}", which is not a local database. ` +
        `This fixture writes rows and deletes a User (cascading across their whole family's data). ` +
        `Point DATABASE_URL at the local \`prisma dev\` server before running e2e tests.`,
    );
  }
}

assertLocalDatabase(process.env.DATABASE_URL);

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const id = () => `e2e${randomUUID().replace(/-/g, "").slice(0, 22)}`;
const insert = async (table, columns, values) => {
  const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
  const quoted = columns.map((c) => `"${c}"`).join(", ");
  const { rows } = await db.query(
    `INSERT INTO "${table}" (${quoted}) VALUES (${placeholders}) RETURNING "id"`,
    values,
  );
  return rows[0].id;
};

const cleanupUserId = process.argv[2];
if (cleanupUserId) {
  // One delete: everything cascades, which the M4 cascade integration test
  // already proves against real Postgres.
  await db.query('DELETE FROM "User" WHERE "id" = $1', [cleanupUserId]).catch(() => {});
  await db.end();
  process.exit(0);
}

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const now = new Date();

const userId = await insert("User", ["id", "email", "adultAttestedAt", "updatedAt"], [
  id(), `e2e-lesson-${stamp}@example.com`, now, now,
]);
const sessionToken = `e2e-${stamp}`;
await insert("Session", ["id", "sessionToken", "userId", "expires"], [
  id(), sessionToken, userId, new Date(Date.now() + 24 * 60 * 60 * 1000),
]);

const profileId = await insert(
  "StudentProfile",
  ["id", "userId", "ageBand", "status", "gradeLevel", "updatedAt"],
  [id(), userId, "UNDER_13", "ACTIVE", "GRADE_4", now],
);
const uploadId = await insert(
  "Upload",
  ["id", "studentProfileId", "pathname", "contentType", "sizeBytes", "originalFilename", "status", "updatedAt"],
  [id(), profileId, `students/${profileId}/uploads/e2e-${stamp}.jpg`, "image/jpeg", 10, "x.jpg", "STORED", now],
);
const extractionId = await insert("Extraction", ["id", "uploadId", "model", "status", "updatedAt"], [
  id(), uploadId, "claude-opus-5", "CONFIRMED", now,
]);

const lessons = [];
for (const [index, script] of FIXTURE_SCRIPTS.entries()) {
  const problemId = await insert(
    "ExtractedProblem",
    ["id", "extractionId", "ordinal", "text", "confidence", "updatedAt"],
    [id(), extractionId, index + 1, script.title, 0.9, now],
  );
  const lessonId = await insert(
    "Lesson",
    ["id", "studentProfileId", "extractedProblemId", "status", "updatedAt"],
    [id(), profileId, problemId, "READY", now],
  );
  const versionId = await insert(
    "LessonScriptVersion",
    ["id", "lessonId", "version", "status", "script", "schemaVersion", "stepCount", "totalDurationMs", "model", "effort", "promptVersion"],
    [
      id(), lessonId, 1, "READY",
      JSON.stringify({ title: script.title, steps: script.steps }),
      "1", script.steps.length,
      script.steps.reduce((sum, step) => sum + step.durationMs, 0),
      "claude-opus-5", "high", "e2e-fixture",
    ],
  );
  await db.query('UPDATE "Lesson" SET "currentVersionId" = $1 WHERE "id" = $2', [versionId, lessonId]);
  lessons.push({ lessonId, slug: script.slug, stepCount: script.steps.length });
}

await db.end();
process.stdout.write(JSON.stringify({ userId, sessionToken, lessons }));
