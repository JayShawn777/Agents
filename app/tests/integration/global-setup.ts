import "dotenv/config";
import net from "node:net";

/**
 * Fails the integration project fast, and legibly, when the local Postgres
 * simply is not running.
 *
 * This has now cost three separate diagnoses. A stopped `prisma dev` server
 * does not present as "the database is down" — it presents as 13 failures
 * across 6 files, each an `Invalid \`db.user.create()\` invocation`, which
 * looks exactly like a schema or a code regression and reads nothing like
 * "start the server". The runbook has said what to do the whole time; the
 * problem was never the instruction, it was that nothing pointed at it at
 * the moment it was needed.
 *
 * A TCP connect rather than a Prisma query on purpose: it needs no generated
 * client, adds no import cost, and distinguishes the one condition worth
 * special-casing — nothing is listening — from a real error a test should be
 * allowed to surface normally.
 */
export async function setup() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is unset. Integration tests need the local Prisma Postgres server.\n" +
        "See CLAUDE.md > Databases, and docs/runbook.md section 1.",
    );
  }

  let host: string;
  let port: number;
  try {
    const parsed = new URL(url);
    host = parsed.hostname;
    port = Number(parsed.port || 5432);
  } catch {
    throw new Error(`DATABASE_URL is not a valid URL: ${url}`);
  }

  const reachable = await new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(2000);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });

  if (!reachable) {
    throw new Error(
      `\nNothing is listening on ${host}:${port}, so every integration test would fail\n` +
        `with an opaque Prisma error instead of this message.\n\n` +
        `The local Prisma Postgres server is almost certainly just stopped. Start it:\n\n` +
        `    pnpm exec prisma dev start app\n\n` +
        `If it has never existed on this machine, create it instead:\n\n` +
        `    pnpm exec prisma dev --name app --detach\n\n` +
        `Check which servers exist with \`pnpm exec prisma dev ls\`. Note that a server\n` +
        `named something other than \`app\` will listen on a different port than the one\n` +
        `.env points at — see CLAUDE.md > Databases and docs/runbook.md section 1.\n`,
    );
  }
}
