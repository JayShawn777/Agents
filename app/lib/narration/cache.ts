import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { StoragePort } from "@/lib/storage/port";
import { NARRATION_PATHNAME_PREFIX } from "@/lib/config";

/**
 * ADR-0015. The narration cache: one blob and one row per distinct
 * (narration text, voice, model) combination, scoped to a student profile —
 * never global (AC 7 / AC 8). A cache hit costs no vendor credits and no
 * wall-clock time; `NarrationAsset.cues` is where the object's word timeline
 * lives, so a hit is a full replacement for a fresh synthesis, not merely the
 * audio.
 */

/**
 * `sha256(narrationText \0 providerVoiceId \0 ttsModelId)` — the cache key
 * (plan §5, slice 5). `\0`-joined rather than concatenated: none of the three
 * inputs can contain a null byte (narration is bounded natural-language
 * prose; the other two are vendor/config ids), so this is a genuine
 * delimiter — `"a" + "\0" + "bc"` can never collide with `"ab" + "\0" + "c"`
 * the way plain string concatenation could.
 */
export function computeCacheKey(text: string, providerVoiceId: string, ttsModelId: string): string {
  return createHash("sha256").update(`${text}\0${providerVoiceId}\0${ttsModelId}`).digest("hex");
}

/**
 * `students/<profileId>/narration/<cacheKey>-<nonce>.mp3` (ADR-0015). The
 * profile id in this path is what makes `deleteStudentData` and the reconciler's
 * claim registry work by prefix; AC 12's no-identifier rule is scoped to the
 * OUTBOUND vendor request, not to our own private pathname (plan §7.4).
 *
 * **The nonce is why this is not a pure function of (profile, cacheKey).** It
 * used to be, and the 2026-09-02 review measured what that cost: two concurrent
 * runs missing the cache for the same (text, voice, model) derived the SAME
 * pathname, so the P2002 loser's `storage.put` overwrote the winner's bytes
 * before its `create` collided. The surviving row then described 1200ms of audio
 * while the file on disk was the loser's, of some other length — a row and its
 * blob disagreeing, silently, forever. Per-attempt paths make that race
 * impossible: each writer owns its own object, and the loser's is genuinely
 * "unreferenced at its own path", which is what this function's caller always
 * claimed and could not deliver.
 *
 * Lookups are unaffected — the cache is queried by `@@unique([studentProfileId,
 * cacheKey])` on the row, never by reconstructing a path.
 */
export function narrationAssetPathname(studentProfileId: string, cacheKey: string): string {
  // Hex, so the result still matches the strict `[A-Za-z0-9_-]+` segment the
  // dev object route's pathname pattern allows.
  const nonce = randomBytes(8).toString("hex");
  return `students/${studentProfileId}/${NARRATION_PATHNAME_PREFIX}/${cacheKey}-${nonce}.mp3`;
}

export type CachedNarrationAsset = {
  id: string;
  pathname: string;
  durationMs: number;
  cues: Prisma.JsonValue;
  cueFormatVersion: string;
};

const CACHED_ASSET_SELECT = {
  id: true,
  pathname: true,
  durationMs: true,
  cues: true,
  cueFormatVersion: true,
} as const;

/** A cache lookup. `null` on a miss — never throws; a miss is the expected common case for any new sentence. */
export async function lookupNarrationAsset(
  studentProfileId: string,
  cacheKey: string,
): Promise<CachedNarrationAsset | null> {
  return db.narrationAsset.findUnique({
    where: { studentProfileId_cacheKey: { studentProfileId, cacheKey } },
    select: CACHED_ASSET_SELECT,
  });
}

export type WriteNarrationAssetInput = {
  studentProfileId: string;
  personaId: string | null;
  cacheKey: string;
  providerVoiceId: string;
  ttsModelId: string;
  audio: ArrayBuffer;
  durationMs: number;
  characterCount: number;
  cues: Prisma.InputJsonValue;
  cueFormatVersion: string;
};

/**
 * Writes a new cache entry. **Blob before row** (ADR-0007 §1's ordering) —
 * the exact orphan class slice 2's reconciler claim registry exists to clean
 * up if the process dies between the two.
 *
 * **Races the unique constraint rather than locking.** Two concurrent
 * narration runs for the SAME profile can both miss the cache for the same
 * (text, voice, model) — two lessons that happen to share a sentence,
 * requested at once — and both synthesize and both attempt to write. Rather
 * than a lock, the loser's `create` collides on
 * `@@unique([studentProfileId, cacheKey])` (Prisma P2002), and this function
 * re-reads the row the WINNER already wrote, then deletes its own now-orphaned
 * blob.
 *
 * This only works because `narrationAssetPathname` mints a per-attempt nonce
 * (see its docstring). With a path derived purely from (profile, cacheKey) the
 * two writers shared one object and the loser silently overwrote the winner's
 * bytes — the 2026-09-02 review reproduced it. That costs one wasted vendor call
 * in the rare race; it does not cost correctness, and both callers still
 * correctly bill `charactersBilled` for what they actually sent.
 */
export async function writeNarrationAsset(
  storage: StoragePort,
  input: WriteNarrationAssetInput,
): Promise<CachedNarrationAsset> {
  const pathname = narrationAssetPathname(input.studentProfileId, input.cacheKey);
  const written = await storage.put(pathname, input.audio, "audio/mpeg");

  try {
    return await db.narrationAsset.create({
      data: {
        studentProfileId: input.studentProfileId,
        personaId: input.personaId,
        cacheKey: input.cacheKey,
        providerVoiceId: input.providerVoiceId,
        ttsModelId: input.ttsModelId,
        pathname: written.pathname,
        contentType: "audio/mpeg",
        sizeBytes: written.sizeBytes,
        durationMs: input.durationMs,
        characterCount: input.characterCount,
        cues: input.cues,
        cueFormatVersion: input.cueFormatVersion,
      },
      select: CACHED_ASSET_SELECT,
    });
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      const existing = await lookupNarrationAsset(input.studentProfileId, input.cacheKey);
      if (existing) {
        // Our own blob is now referenced by nothing — its pathname is unique to
        // this attempt, so nothing else can be pointing at it. Delete it here
        // rather than leaving it for the reconciler an hour later. Best-effort:
        // if this fails, `reconcile-blobs` still collects it, which is exactly
        // the backstop it exists to be.
        await storage.del([written.pathname]).catch(() => undefined);
        return existing;
      }
    }
    throw err;
  }
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "P2002";
}
