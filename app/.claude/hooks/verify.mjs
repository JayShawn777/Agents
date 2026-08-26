#!/usr/bin/env node
// Stop / SubagentStop hook: run `pnpm lint` and `pnpm typecheck` when an agent
// finishes, rather than after every single edit. Verifying per-keystroke ran the
// full typecheck dozens of times per feature for no extra signal — the only
// moment the result matters is when the agent claims to be done.
//
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

// A blocking Stop hook that re-fires on the turn it just blocked would loop
// forever. Claude Code sets this flag on the retry; bail out and let the agent
// report the failure instead.
if (payload?.stop_hook_active === true) process.exit(0);

// On Stop/SubagentStop there is no tool_input, so `file` is empty and the gates
// always run. The extension filter below still applies if this is ever wired
// back to a per-edit event.
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

// Tests run here, not only inside qa-tester. An agent that writes, runs and
// grades its own tests is the canonical reward-hacking surface; a deterministic
// gate outside that agent is the cheapest counterweight.
const failures = [
  run("pnpm lint", "pnpm lint"),
  run("pnpm typecheck", "pnpm typecheck"),
  run("pnpm test", "pnpm test"),
].filter(Boolean);

if (failures.length > 0) {
  console.error(
    `Blocked by verification hook — fix these before continuing.\n\n${failures.join("\n\n")}\n\n` +
      `(CLAUDE.md: DONE means typecheck, lint, and tests all pass.)`,
  );
  process.exit(2);
}
process.exit(0);
