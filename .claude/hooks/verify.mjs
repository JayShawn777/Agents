#!/usr/bin/env node
// PostToolUse hook: run `pnpm lint` and `pnpm typecheck` after a source edit.
// Exit 2 => block, and stderr is fed back to Claude so it can fix the failure.
// Escape hatch: set CLAUDE_SKIP_VERIFY=1 to disable.

import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, extname } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHECKED = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

const read = async () => {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
};

const payload = await read();

if (process.env.CLAUDE_SKIP_VERIFY === "1") process.exit(0);

// Only verify when a source file changed. Docs and config edits skip the gates.
const file = payload?.tool_input?.file_path ?? "";
if (file && !CHECKED.has(extname(file))) process.exit(0);
if (file.includes("lib/generated") || file.includes("node_modules")) process.exit(0);

const run = (label, cmd) => {
  try {
    execSync(cmd, { cwd: ROOT, stdio: "pipe", encoding: "utf8", timeout: 180_000 });
    return null;
  } catch (err) {
    const out = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
    return `${label} FAILED\n${out.split("\n").slice(-40).join("\n")}`;
  }
};

const failures = [run("pnpm lint", "pnpm lint"), run("pnpm typecheck", "pnpm typecheck")].filter(Boolean);

if (failures.length > 0) {
  console.error(
    `Blocked by verification hook — fix these before continuing.\n\n${failures.join("\n\n")}\n\n` +
      `(CLAUDE.md: DONE means typecheck, lint, and tests all pass.)`,
  );
  process.exit(2);
}
process.exit(0);
