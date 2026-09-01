import "server-only";

import { db } from "@/lib/db";
import type { StoragePort } from "@/lib/storage/port";

/**
 * `purgeUnreferencedNarration(studentProfileId, storage)` — M5 §7.3 (AC 20).
 *
 * AC 20 says narration objects are removed when a LESSON is deleted, not
 * only when a profile is. But the narration cache is profile-scoped by
 * design (ADR-0015): a second lesson for the same child can legitimately
 * reference the same `NarrationAsset`, so "delete this lesson's audio" is
 * not a well-formed instruction on its own, and there is no
 * `DELETE /api/lessons/[id]` route — a lesson only dies by cascade, from
 * its extracted problem or practice problem, which die from an extraction
 * or an upload.
 *
 * `Lesson -> LessonNarration -> LessonNarrationStep` all cascade
 * (`onDelete: Cascade`, see `schema.prisma`) when a lesson goes, so those
 * rows take care of themselves. `NarrationAsset` does NOT cascade from
 * `Lesson` — it cascades only from `StudentProfile` — so a deleted lesson's
 * audio survives as a `NarrationAsset` row with zero remaining
 * `LessonNarrationStep`s pointing at it, and its blob sits in the store
 * unreferenced by anything.
 *
 * This function is the sweep: delete every `NarrationAsset` for this
 * profile with NO remaining `LessonNarrationStep` rows, blobs first (ADR-
 * 0007 §1), then rows. It is called after the row deletion.
 *
 * **WHERE IT IS ACTUALLY CALLED FROM, as of slice 6 — and where it is not.**
 * This used to read "by every path that can cascade a lesson away", which was
 * a claim about code that does not exist yet (retro lesson 23), and the next
 * reader would have had no reason to doubt it.
 *
 *   - `lib/uploads/delete-upload.ts` — WIRED. An upload cascades to its
 *     extraction, its extracted problems, and their lessons.
 *   - Profile deletion — COVERED, by a different mechanism: `NarrationAsset`
 *     is registered in `PROFILE_BLOB_SOURCES`, so `deleteStudentData` removes
 *     every narration blob under the profile without needing this sweep.
 *   - `app/api/extractions/[extractionId]/problems/[problemId]/route.ts`
 *     (single extracted-problem DELETE) — **WIRED** (slice 6). Deleting one
 *     problem cascades its lesson and narration ROWS; this call sweeps the
 *     now-unreferenced `NarrationAsset` blobs left behind, same best-effort,
 *     logged-not-fatal pattern as `delete-upload.ts`'s step 4. Before this,
 *     the audio only reached the store's reconciler as an unclaimed orphan
 *     past its threshold — up to an hour later than AC 20 asks for.
 *
 * Three things about it worth not re-deriving (plan §7.3):
 *
 *   - **It is not a refcount.** ADR-0015 rejected refcounting because a
 *     cross-account count that leaks or under-counts fails silently. This
 *     is a query for "zero referencing rows", inside one profile, run
 *     after the fact — it cannot over-delete, and its worst failure is a
 *     cache entry that lingers under a prefix that gets deleted with the
 *     profile anyway.
 *   - **It costs cache hits.** Deleting one extraction can evict lines a
 *     future lesson would have reused. That is the correct side of
 *     ADR-0015's stated trade: correctness over credits.
 *   - **It is idempotent.** Calling it twice, or from a third caller later,
 *     costs nothing extra — the second call's query simply finds nothing.
 */

export type PurgeUnreferencedNarrationResult = { deleted: number };

export async function purgeUnreferencedNarration(
  studentProfileId: string,
  storage: StoragePort,
): Promise<PurgeUnreferencedNarrationResult> {
  const orphaned = await db.narrationAsset.findMany({
    where: { studentProfileId, steps: { none: {} } },
    select: { id: true, pathname: true },
  });

  if (orphaned.length === 0) {
    return { deleted: 0 };
  }

  // Blobs before rows (ADR-0007 §1). `storage.del()` must tolerate an
  // already-gone object, the same requirement every other caller in this
  // codebase already relies on.
  await storage.del(orphaned.map((asset) => asset.pathname));

  const result = await db.narrationAsset.deleteMany({
    where: { id: { in: orphaned.map((asset) => asset.id) } },
  });

  return { deleted: result.count };
}
