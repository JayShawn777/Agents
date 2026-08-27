import "server-only";

import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import type { ChatMessage } from "@/lib/generated/prisma/client";
import { CHAT_IDLE_TIMEOUT_MS } from "@/lib/config";

/**
 * ADR-0013 §3 — opening a turn, and the idempotency that makes AC 12's "never
 * a duplicate turn on reconnect" a database constraint rather than a
 * convention.
 *
 * The handler's FIRST action, before any AI call, is one transaction that
 * allocates the next two `sequence` values, writes the student's message with
 * its client-supplied `clientTurnId`, writes an EMPTY assistant message marked
 * `partial`, and increments `studentTurnCount`. Two rows exist before the model
 * is called. That is deliberate and it is the whole mechanism: the alternative
 * — writing rows only once a reply succeeds — is exactly what makes duplicates
 * possible, because a client that never saw the reply cannot know whether one
 * was recorded.
 *
 * A retry carrying the same `clientTurnId` therefore collides on
 * `@@unique([sessionId, clientTurnId])`. That P2002 is not an error here; it is
 * the signal that this turn already exists, and it routes to a replay.
 */

/**
 * What the caller should do with the turn it just asked for.
 *
 * `NEW` is the ordinary path: two fresh rows, generate into the assistant one.
 *
 * `REPLAY` means the turn already existed and NO generation may run — the
 * caller streams `replayText` as a single delta and finishes. It costs nothing
 * and bills nothing, which is the point: AC 19's "recoverable by retrying" must
 * not turn a flaky connection into a second bill for a reply we already have.
 *
 * `REGENERATE` means the turn existed but its assistant row is a stale partial
 * — the function that was generating it is gone. The caller streams into the
 * SAME assistant row, replacing what is there. Still one turn, still two rows.
 */
export type OpenTurnResult =
  | { kind: "NEW"; userMessage: ChatMessage; assistantMessage: ChatMessage; studentTurnCount: number }
  | { kind: "REPLAY"; userMessage: ChatMessage; assistantMessage: ChatMessage; replayText: string }
  | { kind: "REGENERATE"; userMessage: ChatMessage; assistantMessage: ChatMessage; studentTurnCount: number };

/**
 * ADR-0013 §3 says a partial replay "resumes streaming into the same row".
 * **It cannot, and this is where that is recorded.** Resuming a half-written
 * assistant message means prefilling the assistant turn, and assistant prefill
 * returns a 400 on Claude Opus 5 (and on every model in the 4.6+ family). There
 * is no supported way to ask the model to continue its own truncated reply.
 *
 * So a stale partial is REGENERATED from the top into the same row rather than
 * continued. The ADR's actual guarantees are untouched — one user row, one
 * assistant row, one turn, `clientTurnId` still unique — and the student gets a
 * whole reply instead of a fragment with a seam in the middle.
 *
 * The age check is what separates "the generating function died" from "another
 * request is streaming this right now". A partial younger than the idle budget
 * is presumed in flight and is replayed, never regenerated: two concurrent
 * requests carrying one `clientTurnId` must produce ONE generation, and without
 * this they would produce two, both writing the same row. The same budget backs
 * the GET endpoint's staleness rule, so a turn cannot be retryable by one
 * surface and in-flight by the other.
 */
function classifyExisting(assistant: ChatMessage): "REPLAY" | "REGENERATE" {
  if (!assistant.partial) return "REPLAY";
  const age = Date.now() - assistant.createdAt.getTime();
  return age > CHAT_IDLE_TIMEOUT_MS ? "REGENERATE" : "REPLAY";
}

export async function openTurn(args: {
  sessionId: string;
  clientTurnId: string;
  content: string;
}): Promise<OpenTurnResult> {
  // Two attempts, matching `createAttemptAndApplyMastery`: the retry is for a
  // LOST SEQUENCE RACE (two different turns allocating the same `sequence`),
  // which is a recount-and-go, not a duplicate. A `clientTurnId` collision is a
  // different constraint and returns below without consuming the retry.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const highest = await tx.chatMessage.aggregate({
          where: { sessionId: args.sessionId },
          _max: { sequence: true },
        });
        const userSequence = (highest._max.sequence ?? 0) + 1;

        const userMessage = await tx.chatMessage.create({
          data: {
            sessionId: args.sessionId,
            role: "USER",
            content: args.content,
            sequence: userSequence,
            clientTurnId: args.clientTurnId,
          },
        });

        // Empty and partial until the stream finishes or is abandoned. The id
        // is handed to the client in the `turn` event so a reconnect can
        // reconcile against a row it already knows about.
        const assistantMessage = await tx.chatMessage.create({
          data: {
            sessionId: args.sessionId,
            role: "ASSISTANT",
            content: "",
            sequence: userSequence + 1,
            partial: true,
          },
        });

        const session = await tx.chatSession.update({
          where: { id: args.sessionId },
          data: { studentTurnCount: { increment: 1 } },
          select: { studentTurnCount: true },
        });

        return {
          kind: "NEW" as const,
          userMessage,
          assistantMessage,
          studentTurnCount: session.studentTurnCount,
        };
      });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") {
        throw err;
      }

      // `meta.target` names the constraint that fired. Reading it is what keeps
      // a lost sequence race from being mistaken for a retried turn — they are
      // the same error code and opposite situations.
      const target = err.meta?.target;
      const fields = Array.isArray(target) ? target.map(String) : typeof target === "string" ? [target] : [];
      const collidedOnTurnId = fields.some((field) => field.includes("clientTurnId"));

      if (!collidedOnTurnId) {
        if (attempt === 0) continue; // lost the sequence race — recount and go again
        throw err;
      }

      // The unique index raised only once the winning transaction COMMITTED, so
      // both of its rows are readable now.
      const existing = await readExistingTurn(args.sessionId, args.clientTurnId);
      if (!existing) {
        // The colliding row vanished between the constraint firing and this
        // read — a deleted session or profile. Let the caller's 404/409 surface
        // handle it rather than inventing a turn.
        throw err;
      }

      const decision = classifyExisting(existing.assistantMessage);
      if (decision === "REPLAY") {
        return {
          kind: "REPLAY",
          userMessage: existing.userMessage,
          assistantMessage: existing.assistantMessage,
          replayText: existing.assistantMessage.content,
        };
      }

      // A stale partial: the previous generation is gone. Reuse the rows and
      // generate again. `studentTurnCount` is NOT incremented — the turn was
      // already counted when it was first opened, and a retry that spent one of
      // a child's twenty turns would make a dropped connection cost them the
      // session.
      const session = await db.chatSession.findUnique({
        where: { id: args.sessionId },
        select: { studentTurnCount: true },
      });
      return {
        kind: "REGENERATE",
        userMessage: existing.userMessage,
        assistantMessage: existing.assistantMessage,
        studentTurnCount: session?.studentTurnCount ?? 0,
      };
    }
  }

  throw new Error("openTurn: unreachable");
}

/**
 * Re-reads the pair a `clientTurnId` collision refers to. The assistant message
 * is the row at `userMessage.sequence + 1`, which is how `openTurn` allocated
 * it — the pair is adjacent by construction, in one transaction, so there is no
 * interleaving to defend against.
 */
async function readExistingTurn(
  sessionId: string,
  clientTurnId: string,
): Promise<{ userMessage: ChatMessage; assistantMessage: ChatMessage } | null> {
  const userMessage = await db.chatMessage.findFirst({
    where: { sessionId, clientTurnId },
  });
  if (!userMessage) return null;

  const assistantMessage = await db.chatMessage.findFirst({
    where: { sessionId, sequence: userMessage.sequence + 1, role: "ASSISTANT" },
  });
  if (!assistantMessage) return null;

  return { userMessage, assistantMessage };
}
