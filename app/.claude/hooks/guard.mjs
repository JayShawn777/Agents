#!/usr/bin/env node
// PreToolUse hook: mechanically enforce the CLAUDE.md "Never" list.
//
// These rules were previously prose in CLAUDE.md, which means an agent could
// break them by simply not reading carefully. Exit 2 blocks the tool call and
// feeds stderr back to the agent so it can choose a different approach.
//
// Escape hatch: CLAUDE_SKIP_GUARD=1 (for deliberate, human-driven exceptions).

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
const cmd = input.command ?? "";

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
  const WRITES = /(>>?|\btee\b|\bsed\s+-i|\btruncate\b|\bopen\(|writeFileSync|writeText|\bdd\b)/;
  const touchesEnv = /(^|[\s'"`\/])\.env(?!\.example)\b/.test(cmd);
  if (touchesEnv && WRITES.test(cmd)) {
    deny(
      "This command looks like it writes to `.env`, which is the human's file " +
      "and holds real secrets.\nAdd the variable to `.env.example` with a " +
      "placeholder and ask them to fill it in.\n" +
      "(If this is deliberate setup the human asked for, re-run with " +
      "CLAUDE_SKIP_GUARD=1 and say so out loud.)"
    );
  }
  if (/prisma\/migrations\//.test(cmd) && WRITES.test(cmd)) {
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
