#!/usr/bin/env node
// Runs a Prisma command against the CLOUD database in .env.neon.
// Local development uses .env; this file is the only way to touch production,
// and it refuses `migrate dev` on purpose.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

if (args.includes("dev")) {
  console.error(
    "Refusing to run `migrate dev` against the cloud database.\n" +
      "It can drop and recreate the database, which destroys real data.\n" +
      "Use `pnpm db:migrate:prod deploy` to apply already-created migrations.",
  );
  process.exit(1);
}

let url;
try {
  const m = readFileSync(resolve(ROOT, ".env.neon"), "utf8").match(/^DATABASE_URL="(.+)"$/m);
  url = m?.[1];
} catch {
  console.error("Missing .env.neon — create it with the Neon DATABASE_URL.");
  process.exit(1);
}
if (!url) {
  console.error("No DATABASE_URL found in .env.neon.");
  process.exit(1);
}

const host = url.match(/@([^/]+)/)?.[1] ?? "unknown";
console.log(`Running against CLOUD database: ${host}\n`);

const r = spawnSync("pnpm", ["exec", "prisma", ...args], {
  cwd: ROOT,
  stdio: "inherit",
  shell: true,
  env: { ...process.env, DATABASE_URL: url },
});
process.exit(r.status ?? 1);
