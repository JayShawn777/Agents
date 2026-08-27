import { withAuth } from "@/lib/api/handler";
import { successResponse } from "@/lib/errors";
import { db } from "@/lib/db";
import type { User } from "@/lib/generated/prisma/client";
import { accountClosureInputSchema } from "@/lib/schemas/account";
import { ACCOUNT_CLOSURE_RECOVERY_DAYS } from "@/lib/config";

/**
 * Endpoint 13 (plan §3.2) — `POST /api/account/closure`.
 *
 * Account closure (ADR-0007 §4(c)) — the SOFT deletion path, deliberately
 * named "closure" and not "deletion" (the ambiguity AC 48 forbids). Sets
 * `User.closureRequestedAt`, deletes every live `Session` row so cookies
 * die immediately (AC 5/47), and writes a `DeletionAudit { kind:
 * ACCOUNT_CLOSURE, requestedAt }` carrying no `completedAt` yet — that is
 * stamped later by `GET /api/cron/purge-closed-accounts` (B22/23, not yet
 * built), which is also the caller that will invoke
 * `deleteStudentData(profileId, "ACCOUNT_CLOSURE")` for each of this
 * user's profiles once the recovery window has elapsed.
 *
 * This route never calls `deleteStudentData` itself and never destroys
 * anything — closure is a disclosed, 30-day-recoverable soft delete, the
 * opposite of endpoint 6's immediate §312.6 path (ADR-0007 §4, "no code
 * path may set `User.closureRequestedAt` in response to a request to
 * delete a child's data").
 */

async function resolveOwnUser({ session }: { session: { userId: string } | null }): Promise<User | null> {
  if (!session) return null;
  return db.user.findUnique({ where: { id: session.userId } });
}

export const POST = withAuth({
  resolveResource: resolveOwnUser,
  // Step 5, before the body is parsed: a second closure request against an
  // account that is already closing is a 409, regardless of body shape.
  requireFlow: ({ resource }) => resource.closureRequestedAt === null,
  requireFlowMessage: "Your account is already scheduled for closure.",
  bodySchema: accountClosureInputSchema,
  handler: async ({ resource: user }) => {
    const closureRequestedAt = new Date();
    const purgeAfter = new Date(
      closureRequestedAt.getTime() + ACCOUNT_CLOSURE_RECOVERY_DAYS * 24 * 60 * 60 * 1000,
    );

    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { closureRequestedAt },
      });
      // AC 5/47: kills every live session cookie immediately, not just the
      // one that made this request.
      await tx.session.deleteMany({ where: { userId: user.id } });
      // No foreign key (ADR-0007 §4) — this row survives the purge it
      // will eventually record `completedAt` for.
      await tx.deletionAudit.create({
        data: {
          kind: "ACCOUNT_CLOSURE",
          subjectRef: user.id,
          requestedAt: closureRequestedAt,
        },
      });
    });

    return successResponse(
      {
        closureRequestedAt: closureRequestedAt.toISOString(),
        purgeAfter: purgeAfter.toISOString(),
        recoveryWindowDays: ACCOUNT_CLOSURE_RECOVERY_DAYS,
      },
      { status: 202 },
    );
  },
});
