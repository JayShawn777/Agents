// Guard-hook fixtures live in a file so the harness command line does not
// itself contain the patterns under test — the hook scans the command it is
// given, and cannot tell a command from a description of one.
import { spawnSync } from "node:child_process";

const HOOK = "/workspaces/Agents/.claude/hooks/guard.mjs";
const ENV_FILE = [".", "env"].join("");
const HEREDOC = "<<EOF";

const cases = [
  ["real write to the secrets file", "Bash", { command: `echo X > ${ENV_FILE}` }, true],
  ["commit message merely naming it", "Bash", { command: `git commit -F - ${HEREDOC}\na message about a ${ENV_FILE} write\nEOF` }, false],
  ["real npm install", "Bash", { command: "npm install lodash" }, true],
  ["commit message naming npm install", "Bash", { command: `git commit -F - ${HEREDOC}\nnpm install was refused\nEOF` }, false],
  ["real force push", "Bash", { command: "git push --force origin main" }, true],
  ["force-with-lease", "Bash", { command: "git push --force-with-lease" }, false],
  ["git add of a directory", "Bash", { command: "git add app/docs" }, true],
  ["git add of explicit files", "Bash", { command: "git add app/lib/db.ts app/lib/errors.ts" }, false],
  ["editing an applied migration", "Edit", { file_path: "prisma/migrations/x/migration.sql" }, true],
  ["ordinary edit", "Edit", { file_path: "lib/db.ts" }, false],
  ["writing the example env file", "Write", { file_path: `/workspaces/Agents/app/${ENV_FILE}.example` }, false],
];

let bad = 0;
for (const [name, tool, input, shouldBlock] of cases) {
  const r = spawnSync("node", [HOOK], {
    input: JSON.stringify({ tool_name: tool, tool_input: input }),
    encoding: "utf8",
  });
  const blocked = r.status === 2;
  const ok = blocked === shouldBlock;
  if (!ok) bad++;
  console.log(
    `${ok ? "ok  " : "FAIL"}  ${name.padEnd(38)} ${blocked ? "BLOCKED" : "allowed"}`,
  );
}
console.log(bad === 0 ? "\nall guard cases behave correctly" : `\n${bad} case(s) wrong`);
process.exit(bad === 0 ? 0 : 1);
