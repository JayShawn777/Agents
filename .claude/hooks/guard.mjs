#!/usr/bin/env node
import { statSync } from "node:fs";
// PreToolUse hook: mechanically enforce the CLAUDE.md "Never" list.
//
// These rules were previously prose in CLAUDE.md, which means an agent could
// break them by simply not reading carefully. Exit 2 blocks the tool call and
// feeds stderr back to the agent so it can choose a different approach.
//
// Escape hatch: CLAUDE_SKIP_GUARD=1 in the ENVIRONMENT of the Claude Code
// process — NOT as an inline prefix on the blocked command. The hook runs in a
// separate process and never sees an inline assignment, so `CLAUDE_SKIP_GUARD=1
// <command>` is blocked exactly like the bare command. That was wrong in this
// file's own error message for a while, which sent the reader in a circle.

const read = async () => {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
};

const payload = await read();
if (process.env.CLAUDE_SKIP_GUARD === "1") process.exit(0);

const tool = payload?.tool_name ?? "";
const input = payload?.tool_input ?? {};
const file = input.file_path ?? "";
const rawCmd = input.command ?? "";

// Only the command itself is a command. A heredoc body is DATA — a commit
// message, or a file being written — and scanning it produced a false block on
// a message that merely mentioned a filename next to a write verb. Everything
// from the first heredoc operator onward is stripped before any pattern runs.
const cmd = rawCmd.split(/<<-?\s*['"]?[A-Za-z_][A-Za-z0-9_]*['"]?/)[0];

const deny = (why) => {
  console.error(`Blocked by .claude/hooks/guard.mjs\n\n${why}`);
  process.exit(2);
};

if (["Edit", "Write", "NotebookEdit", "MultiEdit"].includes(tool)) {
  if (/prisma\/migrations\//.test(file)) {
    deny(
      "An applied migration must never be edited — it has already run against a " +
      "database, so changing it makes the recorded history a lie.\n" +
      "Write a NEW migration that corrects the schema instead."
    );
  }
  if (/(^|\/)\.env(\.|$)/.test(file) && !/\.env\.example$/.test(file)) {
    deny(
      "Secrets must never be written by an agent. `.env` is gitignored and is " +
      "the human's to edit.\nIf a new variable is needed, add it to " +
      "`.env.example` with a placeholder and say so."
    );
  }
}

// Bash can write files too — a redirect, `tee`, `sed -i`, or a python/node
// heredoc all reach the same paths the Edit/Write branch above guards. Without
// this the rules above are advisory again, just one tool over.
if (tool === "Bash") {
  // The write operator must be ADJACENT to the path, not merely present somewhere
  // on the line. Requiring only co-occurrence blocked read-only commands: a
  // `grep ... prisma/migrations/ 2>&1` was refused because `2>&1` contains `>`.
  // A path-shaped fragment is allowed between them so `> "$DIR/.env"` still hits.
  const writesTo = (pathRe) => {
    // A redirect must sit immediately before the target, so `2>&1` elsewhere on
    // the line cannot arm it. A path-shaped fragment may intervene, so
    // `> "$DIR/.env"` still matches.
    const redirect = new RegExp(`(?:>>?|\\btee\\b(?:\\s+-a)?)\\s*["'\`]?[\\w./$~{}-]*?${pathRe}`);
    // In-place editors take their own arguments before the filename, so allow
    // anything up to the next command separator.
    const inPlace = new RegExp(`\\b(?:sed\\s+-i|truncate|dd)\\b[^|;&\\n]*?${pathRe}`);
    // Scripting languages opening the path for writing.
    const scripted = new RegExp(`(?:open\\(|writeFileSync\\(|writeText\\()[^)]*${pathRe}`);
    return redirect.test(cmd) || inPlace.test(cmd) || scripted.test(cmd);
  };

  const ENV_PATH = "\\.env(?!\\.example)\\b";
  if (writesTo(ENV_PATH)) {
    deny(
      "This command looks like it writes to `.env`, which is the human's file " +
      "and holds real secrets.\nAdd the variable to `.env.example` with a " +
      "placeholder and ask them to fill it in.\n" +
      "(Deliberate setup? Use the Edit or Write tool on the specific file, or " +
      "ask the human to export CLAUDE_SKIP_GUARD=1 — an inline prefix does not " +
      "reach this hook's process.)"
    );
  }
  // Staging a directory sweeps in whatever a parallel agent happens to be
  // writing at that instant, and attributes it to an unrelated commit message.
  // This has now happened twice in one session, the second time after the rule
  // was written down — so it stops being a rule and becomes a check.
  const gitAdd = cmd.match(/\bgit\s+(?:-C\s+\S+\s+)?add\s+([^\n;&|]+)/);
  if (gitAdd) {
    const args = gitAdd[1].trim().split(/\s+/).filter((a) => !a.startsWith("-"));
    const flags = gitAdd[1];
    const isDir = (a) => {
      if (a === "." || a.endsWith("/")) return true;
      try { return statSync(a).isDirectory(); } catch { return false; }
    };
    if (/(^|\s)(-A|--all)(\s|$)/.test(flags) || args.some(isDir)) {
      deny(
        "Stage explicit file paths, not a directory or -A.\n" +
        "A directory sweeps in whatever a parallel agent is mid-write on, and " +
        "files it up under a commit message that does not describe them.\n" +
        "Use `git status --short` to see what changed, then stage the paths you " +
        "actually mean.\n" +
        "(CLAUDE_SKIP_GUARD=1 if you have genuinely checked nothing else is running.)"
      );
    }
  }

  if (writesTo("prisma/migrations/")) {
    deny("That command writes into prisma/migrations/. Applied migrations are immutable — write a new one.");
  }

  if (/git\s+push[^\n|;&]*(--force\b|(^|\s)-f(\s|$))/.test(cmd) && !/--force-with-lease/.test(cmd)) {
    deny("Never force-push. If history genuinely must change, ask the human first.");
  }
  if (/(^|\s|&&|;|\|)(npm|yarn)\s+(i\b|install|add|ci)\b/.test(cmd)) {
    deny(
      "This project is pnpm-only. `npm`/`yarn` produce a competing lockfile and " +
      "a different dependency tree.\nUse `pnpm` — and note that adding a new " +
      "major dependency needs the owner's approval first."
    );
  }
  if (/prisma\s+migrate\s+dev/.test(cmd) && /\.env\.neon|DATABASE_URL=.*neon/i.test(cmd)) {
    deny("`prisma migrate dev` can drop the database. Never point it at the cloud — use `pnpm db:migrate:prod`.");
  }
}

process.exit(0);
