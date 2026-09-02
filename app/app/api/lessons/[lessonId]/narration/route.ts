import "server-only";

import { after } from "next/server";

import { withAuth } from "@/lib/api/handler";
import { apiErr, errorResponse, successResponse } from "@/lib/errors";
import { db } from "@/lib/db";
import {
  fetchNarrationWithRelations,
  requireLessonForNarration,
  type LessonForNarration,
} from "@/lib/auth/dal";
import type { LessonNarration, LessonScriptVersion, Persona } from "@/lib/generated/prisma/client";
import { requestNarrationInputSchema } from "@/lib/schemas/narration";
import type { LessonNarrationResponse } from "@/lib/schemas/dto";
import { LessonScriptSchema, type LessonScript } from "@/lib/lessons/script-schema";
import { toLessonNarrationDTO } from "@/lib/narration/dto";
import { runNarrationGeneration, reapIfStaleNarration } from "@/lib/narration/generate";
import { getStoragePort } from "@/lib/storage/get-storage";
import {
  CUE_FORMAT_VERSION,
  DEFAULT_PERSONA_SLUG,
  NARRATION_CHAR_CAP,
  NARRATION_DAILY_BUDGET_CHARS,
  NARRATION_MODEL_ID,
  NARRATION_RUNS_PER_HOUR,
} from "@/lib/config";

/**
 * Endpoints 46/47 (plan §3) — `POST`/`GET /api/lessons/[lessonId]/narration`.
 *
 * **Retry (AC 17) is this same POST, not a third route.** A `FAILED` run is
 * re-claimed and reset to `PENDING`; only an in-flight (`PENDING`/
 * `GENERATING`) run 409s.
 *
 * `after()` runs for the route's full `maxDuration`, exactly like endpoint 43
 * (`.../versions/route.ts`) — no job queue.
 */
export const maxDuration = 300;

// ─────────────────────────── resource resolution ───────────────────────────

type NarrationResource = LessonForNarration & {
  currentVersion: LessonScriptVersion | null;
  /**
   * The current version's script, re-parsed the same way `toLessonVersionDTO`
   * re-parses a stored script (M4 review lesson 23) — `null` for both "no
   * READY current version" and "the stored script no longer validates",
   * which are the same 409 to a caller either way. Parsed ONCE here rather
   * than separately in `requireFlow` and the handler.
   */
  parsedScript: LessonScript | null;
};

async function resolveOwnedLessonForNarration({
  params,
}: {
  params: Record<string, string>;
}): Promise<NarrationResource | null> {
  const lessonId = params.lessonId;
  if (!lessonId) return null;
  const lesson = await requireLessonForNarration(lessonId);
  if (!lesson) return null;

  const currentVersion = lesson.versions.find((version) => version.id === lesson.currentVersionId) ?? null;
  const parsedScript =
    currentVersion?.status === "READY" && currentVersion.script !== null
      ? parseScriptOrNull(currentVersion.script)
      : null;

  return { ...lesson, currentVersion, parsedScript };
}

function parseScriptOrNull(script: unknown): LessonScript | null {
  const parsed = LessonScriptSchema.safeParse(script);
  return parsed.success ? parsed.data : null;
}

// ─────────────────────────── GET #47 ───────────────────────────

/**
 * Auth is **Owner**, not Owner+ACTIVE — a parent who has withdrawn consent
 * must still be able to see what was made for their child, matching
 * endpoints 38 and 42.
 *
 * **The lazy reap WRITES, so it is gated on `status === 'ACTIVE'`** — the
 * exact bug named in this milestone's brief (M3's `closeIfPastBounds`, M4's
 * `reapIfStale` on the lesson GET): a read path reached after withdrawal
 * must never persist anything.
 *
 * **On a lost guard race, `reapIfStaleNarration` re-reads the bare row rather
 * than fabricating a hard-coded FAILED** (the M4 review's finding, restated
 * for this route). When that re-read shows a DIFFERENT status than this
 * request's own snapshot, the snapshot's `persona`/`steps` relations are
 * stale too — the DTO gates `steps` on `status === 'READY'`, so a status
 * that flipped IN (PENDING/GENERATING -> READY) between our query and the
 * reap would otherwise render an empty step list for a run that actually
 * finished. `fetchNarrationWithRelations` re-reads with relations only in
 * that case — the same "only re-read when the reap actually fired" discipline
 * `app/api/lessons/[lessonId]/route.ts` already applies to a lesson's current
 * version.
 */
export const GET = withAuth({
  resolveResource: resolveOwnedLessonForNarration,
  handler: async ({ resource }) => {
    if (!resource.narration) {
      return successResponse<LessonNarrationResponse>({ narration: null });
    }

    let narration = resource.narration;
    if (resource.studentProfile.status === "ACTIVE") {
      const reaped = await reapIfStaleNarration(narration);
      narration = reaped.status !== narration.status ? await fetchNarrationWithRelations(reaped.id) : reaped;
    }

    const storage = getStoragePort();
    return successResponse<LessonNarrationResponse>({
      narration: await toLessonNarrationDTO(storage, narration),
    });
  },
});

// ─────────────────────────── POST #46 ───────────────────────────

export const POST = withAuth({
  resolveResource: resolveOwnedLessonForNarration,
  requireState: (resource) => resource.studentProfile.status === "ACTIVE",
  // Step 5: nothing may already be in flight, and there must be something
  // READY to narrate.
  requireFlow: ({ resource }) => {
    if (!resource.parsedScript) return false;
    const inFlight = resource.narration?.status === "PENDING" || resource.narration?.status === "GENERATING";
    return !inFlight;
  },
  requireFlowMessage: (resource) =>
    !resource.parsedScript
      ? "This lesson isn't ready to narrate yet."
      : "Narration for this lesson is already on its way.",
  bodySchema: requestNarrationInputSchema,
  // Step 7, the CHEAP pre-check — mirrors `withinAuthoringCap`
  // (`lib/lessons/request.ts`): a fast, non-transactional rejection for the
  // common case. The AUTHORITATIVE check is re-run inside the transaction
  // that writes the grant (below), because this one alone is a read-then-write
  // race — the exact bug M4's review found in the authoring cap.
  rateLimit: ({ resource }) => withinNarrationRateLimit(resource.studentProfileId),
  handler: async ({ resource }) => {
    const { parsedScript } = resource;
    if (!parsedScript) {
      // `requireFlow` already guarantees this; narrows the type for what
      // follows and refuses to proceed rather than assert.
      return errorResponse(apiErr("CONFLICT"));
    }

    // AC 10, re-asserted defensively at generation-REQUEST time — the same
    // defensive re-check `lib/narration/generate.ts`'s `resolveStepAsset`
    // makes per step. `LessonStepSchema.narration` already bounds this at
    // the zod level, so a stored script can only violate it if it predates
    // a since-lowered `NARRATION_CHAR_CAP` or was written by a path that
    // bypassed the schema — expected to be unreachable in practice, refused
    // cleanly rather than silently sent to the vendor if it ever is.
    const overCapStep = parsedScript.steps.some((step) => step.narration.length > NARRATION_CHAR_CAP);
    if (overCapStep) {
      return errorResponse(apiErr("VALIDATION_ERROR"));
    }

    const profile = await db.studentProfile.findUniqueOrThrow({
      where: { id: resource.studentProfile.id },
      select: { personaId: true },
    });
    const persona = await resolvePersonaForNarration(profile.personaId);

    // Conservative: the full script's characters, not accounting for a step
    // that will turn out to be a cache hit. AC 21's budget must never let a
    // run through that COULD exceed it; a lesson that turns out to be fully
    // cached costs nothing anyway once `charactersBilled` is written by the
    // real run. See `grantNarrationRun`'s docstring for the authoritative,
    // transactional recheck this number feeds.
    const prospectiveChars = parsedScript.steps.reduce((sum, step) => sum + step.narration.length, 0);

    // Guaranteed non-null: `parsedScript` is only ever set (above) when
    // `currentVersion` is the READY version it was parsed from.
    const currentVersion = resource.currentVersion as LessonScriptVersion;

    let granted: LessonNarration;
    try {
      granted = await grantNarrationRun({
        lessonId: resource.id,
        versionId: currentVersion.id,
        studentProfileId: resource.studentProfile.id,
        persona,
        prospectiveChars,
      });
    } catch (err) {
      if (isNarrationCapRejection(err)) return errorResponse(apiErr("RATE_LIMITED"));
      throw err;
    }

    // Registered EAGERLY, in request context, directly in the handler body —
    // never inside a callback or an abort listener (M3's `after()` lesson:
    // `AsyncLocalStorage`'s request context does not propagate into either).
    const storage = getStoragePort();
    after(() => runNarrationGeneration(granted.id, storage));

    return successResponse<LessonNarrationResponse>(
      {
        narration: await toLessonNarrationDTO(storage, {
          id: granted.id,
          versionId: granted.versionId,
          status: granted.status,
          stepCount: granted.stepCount,
          totalDurationMs: granted.totalDurationMs,
          failureCode: granted.failureCode,
          persona: { id: persona.id, slug: persona.slug, label: persona.label },
          // PENDING: `toLessonNarrationDTO` never signs a URL for a non-READY
          // run, so an empty list here is correct regardless of whatever a
          // superseded prior run's step rows still say in the database.
          steps: [],
        }),
      },
      { status: 202 },
    );
  },
});

// ─────────────────────────── internals ───────────────────────────

/** `profile.personaId`, or `DEFAULT_PERSONA_SLUG` (AC 3/AC 4) when unset OR when the chosen persona row no longer exists. */
async function resolvePersonaForNarration(personaId: string | null): Promise<Persona> {
  const chosen = personaId ? await db.persona.findUnique({ where: { id: personaId } }) : null;
  if (chosen) return chosen;

  const fallback = await db.persona.findUnique({ where: { slug: DEFAULT_PERSONA_SLUG } });
  if (!fallback) {
    // Seed data is missing — a migration problem, not a request problem.
    // Thrown rather than returned so `withAuth`'s catch-all maps it to a
    // logged 500 instead of a misleading typed error.
    throw new Error(
      `resolvePersonaForNarration: DEFAULT_PERSONA_SLUG "${DEFAULT_PERSONA_SLUG}" has no seeded Persona row.`,
    );
  }
  return fallback;
}

const NARRATION_RATE_WINDOW_MS = 60 * 60 * 1000;
const NARRATION_BUDGET_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The cheap, step-7 pre-check. Rolling windows (not calendar boundaries),
 * matching every other cap in this app (`withinAuthoringCap`,
 * `withinFlagCap`). Not authoritative — see `grantNarrationRun`.
 */
async function withinNarrationRateLimit(studentProfileId: string): Promise<boolean> {
  const runs = await countNarrationRuns(db, studentProfileId);
  if (runs >= NARRATION_RUNS_PER_HOUR) return false;

  const spent = await sumCharactersBilledInWindow(db, studentProfileId);
  return spent < NARRATION_DAILY_BUDGET_CHARS;
}

type CapCountClient = {
  lessonNarration: {
    count: (args: Parameters<typeof db.lessonNarration.count>[0]) => Promise<number>;
    aggregate: (args: Parameters<typeof db.lessonNarration.aggregate>[0]) => ReturnType<typeof db.lessonNarration.aggregate>;
  };
};

function countNarrationRuns(client: CapCountClient, studentProfileId: string): Promise<number> {
  const windowStart = new Date(Date.now() - NARRATION_RATE_WINDOW_MS);
  return client.lessonNarration.count({ where: { studentProfileId, createdAt: { gte: windowStart } } });
}

async function sumCharactersBilledInWindow(client: CapCountClient, studentProfileId: string): Promise<number> {
  const windowStart = new Date(Date.now() - NARRATION_BUDGET_WINDOW_MS);
  const agg = await client.lessonNarration.aggregate({
    where: { studentProfileId, createdAt: { gte: windowStart } },
    _sum: { charactersBilled: true },
  });
  return agg._sum?.charactersBilled ?? 0;
}

class NarrationCapExceededError extends Error {
  constructor(reason: "runs" | "budget") {
    super(`Narration cap reached (${reason})`);
    this.name = "NarrationCapExceededError";
  }
}

/** True for our own check, and for Postgres refusing to serialize two racing grants (P2034) — both mean "too many at once", which is what a 429 says. Mirrors `isAuthoringCapRejection` (`lib/lessons/request.ts`). */
function isNarrationCapRejection(err: unknown): boolean {
  if (err instanceof NarrationCapExceededError) return true;
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2034";
}

/**
 * **The authoritative check, re-counted INSIDE the transaction that writes
 * the grant row.** `withinNarrationRateLimit` above runs as step 7, outside
 * any transaction, and the row that makes its count go up is written
 * afterwards — so N simultaneous requests could all read the same pre-insert
 * count and all pass, exactly the bug M4's review found in the authoring cap
 * (`lib/lessons/request.ts`'s `assertWithinAuthoringCap`). This function is
 * that fix's shape, applied here: `Serializable` isolation, so two racing
 * grants for the same profile cannot both pass, and Postgres aborts the
 * loser with P2034 rather than letting both commit.
 *
 * A retry (AC 17) `upsert`s the SAME row — `LessonNarration.@@unique
 * ([versionId])` — rather than inserting a second one, matching
 * `runNarrationGeneration`'s own "reuses the SAME row" contract.
 */
async function grantNarrationRun(args: {
  lessonId: string;
  versionId: string;
  studentProfileId: string;
  persona: Persona;
  prospectiveChars: number;
}): Promise<LessonNarration> {
  return db.$transaction(
    async (tx) => {
      const runs = await countNarrationRuns(tx, args.studentProfileId);
      if (runs >= NARRATION_RUNS_PER_HOUR) throw new NarrationCapExceededError("runs");

      const spent = await sumCharactersBilledInWindow(tx, args.studentProfileId);
      if (spent + args.prospectiveChars > NARRATION_DAILY_BUDGET_CHARS) {
        throw new NarrationCapExceededError("budget");
      }

      return tx.lessonNarration.upsert({
        where: { versionId: args.versionId },
        create: {
          lessonId: args.lessonId,
          versionId: args.versionId,
          studentProfileId: args.studentProfileId,
          personaId: args.persona.id,
          status: "PENDING",
          ttsModelId: NARRATION_MODEL_ID,
          providerVoiceId: args.persona.providerVoiceId,
          cueFormatVersion: CUE_FORMAT_VERSION,
        },
        update: {
          status: "PENDING",
          failureCode: null,
          personaId: args.persona.id,
          providerVoiceId: args.persona.providerVoiceId,
          ttsModelId: NARRATION_MODEL_ID,
          startedAt: null,
          completedAt: null,
        },
      });
    },
    { isolationLevel: "Serializable" },
  );
}
