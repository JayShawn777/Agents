import "server-only";

import { db } from "@/lib/db";
import { UPLOADS_PER_HOUR } from "@/lib/config";

/**
 * `UploadTokenGrant` exists specifically so the TOKEN endpoint can be rate
 * limited (M1 AC 17, `prisma/schema.prisma`'s own comment on the model) —
 * counting `Upload` rows would only count uploads that were CONFIRMED, and a
 * student who requests ten tokens and confirms none of them has still tied
 * up ten upload attempts in an hour. A grant row is written for every
 * request that PASSES this check — i.e. for every token this app is about
 * to hand out — never for a refused one, since a refused request issues no
 * token and reserves nothing.
 *
 * This is a plain `count()` over a rolling window, matching the project's
 * existing pattern for Postgres-backed rate limiting (`lib/auth/actions.ts`'s
 * sign-in limiter, `lib/consent/rate-limit.ts`'s in-memory one) rather than a
 * new dependency: no Redis, no distributed lock. A `count()` then `create()`
 * has a small race window between two concurrent requests for the same
 * profile; accepted here for the same reason the sign-in limiter accepts it —
 * this is an abuse throttle, not a security boundary, and the accepted
 * failure mode is "occasionally one request over the cap gets through," never
 * "occasionally zero requests get through."
 */
export async function recordUploadTokenGrant(
  studentProfileId: string,
  requestedPathname: string,
): Promise<boolean> {
  const windowStart = new Date(Date.now() - 60 * 60 * 1000);
  const count = await db.uploadTokenGrant.count({
    where: { studentProfileId, createdAt: { gte: windowStart } },
  });
  if (count >= UPLOADS_PER_HOUR) {
    return false;
  }

  await db.uploadTokenGrant.create({
    data: { studentProfileId, requestedPathname },
  });
  return true;
}
