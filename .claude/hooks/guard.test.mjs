// Guard-hook fixtures live in a file so the harness command line does not
// itself contain the patterns under test — the hook scans the command it is
// given, and cannot tell a command from a description of one.
import { spawnSync } from "node:child_process";

const HOOK = "/workspaces/Agents/.claude/hooks/guard.mjs";
const ENV_FILE = [".", "env"].join("");
const MIG = ["prisma", "migrations"].join("/") + "/";
const HEREDOC = "<<EOF";

const cases = [
  // must block
  ["writes the secrets file", "Bash", { command: `echo X > ${ENV_FILE}` }, true],
  ["writes it via a variable path", "Bash", { command: `echo X > "$DIR/${ENV_FILE}"` }, true],
  ["python writes it", "Bash", { command: `python3 -c 'open("${ENV_FILE}","w")'` }, true],
  ["overwrites an applied migration", "Bash", { command: `echo x > ${MIG}0001_x/migration.sql` }, true],
  ["sed -i on an applied migration", "Bash", { command: `sed -i s/a/b/ ${MIG}0001_x/migration.sql` }, true],
  ["real npm install", "Bash", { command: "npm install lodash" }, true],
  ["real force push", "Bash", { command: "git push --force origin main" }, true],
  ["git add of a directory", "Bash", { command: "git add app/docs" }, true],
  ["edits an applied migration", "Edit", { file_path: `${MIG}x/migration.sql` }, true],

  // must NOT block — these are the false positives that have actually happened
  ["READS a migration dir with 2>&1", "Bash", { command: `ls ${MIG} 2>&1 | tail -4` }, false],
  ["greps for a migration path", "Bash", { command: `grep -rn "${MIG}" app/lib 2>&1` }, false],
  ["prisma migrate status", "Bash", { command: "pnpm exec prisma migrate status 2>&1" }, false],
  ["reads the secrets file", "Bash", { command: `cat ${ENV_FILE}` }, false],
  ["commit message naming the file", "Bash", { command: `git commit -F - ${HEREDOC}\nnote about a ${ENV_FILE} write\nEOF` }, false],
  ["commit message naming npm install", "Bash", { command: `git commit -F - ${HEREDOC}\nnpm install was refused\nEOF` }, false],
  ["force-with-lease", "Bash", { command: "git push --force-with-lease" }, false],
  ["git add of explicit files", "Bash", { command: "git add app/lib/db.ts app/lib/errors.ts" }, false],
  ["writes the example env file", "Bash", { command: `echo X > ${ENV_FILE}.example` }, false],
  ["ordinary edit", "Edit", { file_path: "lib/db.ts" }, false],
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
  console.log(`${ok ? "ok  " : "FAIL"}  ${name.padEnd(34)} ${blocked ? "BLOCKED" : "allowed"}`);
}
console.log(bad === 0 ? `\nall ${cases.length} guard cases behave correctly` : `\n${bad} case(s) wrong`);
process.exit(bad === 0 ? 0 : 1);
