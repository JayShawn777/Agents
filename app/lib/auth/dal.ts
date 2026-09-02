import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/config";
import { isInClosureRecoveryWindow } from "@/lib/auth/closure";
import { db } from "@/lib/db";
import type {
  Attempt,
  ChatMessage,
  ChatSession,
  Lesson,
  LessonScriptVersion,
  LessonNarration,
  LessonNarrationStep,
  NarrationAsset,
  Persona,
  Extraction,
  ExtractedProblem,
  PracticeAnswerKey,
  PracticeProblem,
  PracticeSet,
  StudentProfile,
  Upload,
} from "@/lib/generated/prisma/client";

/**
 * The Data Access Layer (Next.js's own recommended pattern — see
 * `node_modules/next/dist/docs/01-app/02-guides/authentication.md`,
 * "Creating a Data Access Layer"). This file is the ONLY place session
 * state is read and the ONLY way to load a student profile in server code
 * (plan §0: "a student profile id in a URL is not authorization"). Every
 * lookup below is scoped by `userId` — there is no other path to a
 * profile.
 *
 * `verifySession`, `requireStudentProfile` and `requireActiveStudentProfile`
 * return `null` on failure rather than redirecting or throwing, so the SAME
 * functions serve both callers: `lib/api/handler.ts` turns a `null` into a
 * typed 401/404/403 JSON response, and a page (frontend track) can turn it
 * into whatever redirect fits that page's place in the flow. Only
 * `requireUser` redirects, matching AC 1 ("a signed-out visitor requesting
 * /dashboard is redirected to /sign-in") and the Next.js DAL example this
 * mirrors — it exists for pages, not for route handlers.
 *
 * All four functions are wrapped in React's `cache()` so repeated calls
 * within one render pass (or one route-handler invocation) hit the
 * database at most once per distinct argument.
 */

export type SessionInfo = { userId: string };

/**
 * The session, or `null` if the caller has no valid session. Never
 * redirects.
 *
 * Also refuses a session belonging to an account inside its closure
 * recovery window (AC 47 / ADR-0007 §4). `lib/auth/config.ts`'s `signIn`
 * callback already refuses REDEMPTION of a new magic link for a closed
 * account, but the database session strategy means a `Session` row (and
 * its cookie) issued before closure was requested keeps resolving to a
 * valid session on every subsequent request — closure must also be
 * checked HERE, on every read, not just at the moment a new link is
 * opened. `toPublicSession()` deliberately strips `closureRequestedAt`
 * from `auth()`'s return value (it must never reach the client), so this
 * function queries it directly rather than reading it off `session.user`.
 */
export const verifySession = cache(async (): Promise<SessionInfo | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { closureRequestedAt: true },
  });
  if (!user || isInClosureRecoveryWindow(user.closureRequestedAt)) return null;

  return { userId };
});

/**
 * For server components / pages ONLY. Redirects to `/sign-in` if there is
 * no session (AC 1). Route handlers must use `verifySession()` directly and
 * build their own typed 401 (`lib/api/handler.ts`) — a route handler must
 * never call `redirect()` in place of a JSON error response.
 */
export async function requireUser(): Promise<SessionInfo> {
  const session = await verifySession();
  if (!session) redirect("/sign-in");
  return session;
}

/**
 * Resolves a student profile scoped to the CALLING user. Cross-account
 * access and a nonexistent id are indistinguishable — both return `null` —
 * which is exactly the 404 that AC 32 and M1 AC 33 demand
 * (`db.studentProfile.findFirst({ where: { id, userId } })`, ADR-0002,
 * ADR-0006). This is the only function anywhere in the app that may load a
 * `StudentProfile` row by id.
 */
export const requireStudentProfile = cache(
  async (studentProfileId: string): Promise<StudentProfile | null> => {
    const session = await verifySession();
    if (!session) return null;
    return db.studentProfile.findFirst({
      where: { id: studentProfileId, userId: session.userId },
    });
  },
);

/**
 * `requireStudentProfile` plus the consent-state gate (`status === "ACTIVE"`).
 * Returns `null` for both "not found/not owned" and "found but not active" —
 * callers that must distinguish 404 from 403 (route handlers, via
 * `lib/api/handler.ts`) call `requireStudentProfile` directly instead and
 * check `.status` themselves. This helper exists for the common case (a
 * page or handler that only cares "may I act on this profile right now?").
 */
export const requireActiveStudentProfile = cache(
  async (studentProfileId: string): Promise<StudentProfile | null> => {
    const profile = await requireStudentProfile(studentProfileId);
    if (!profile || profile.status !== "ACTIVE") return null;
    return profile;
  },
);

/** An `Upload` row plus its `Extraction` sibling's status and problem count — the shape M1's routes need without a second query. */
export type UploadWithExtraction = Upload & {
  extraction: (Extraction & { _count: { problems: number } }) | null;
};

/**
 * Resolves an upload scoped to the CALLING user via the
 * `Upload -> StudentProfile.userId` join — the same "id in a URL is not
 * authorization" rule (plan §0) applied to uploads. Cross-account and
 * nonexistent ids are indistinguishable (both `null`), which is exactly the
 * 404 M1 AC 33 demands. Used by endpoints 16-18
 * (`app/api/uploads/[uploadId]/**`).
 */
export const requireUpload = cache(async (uploadId: string): Promise<UploadWithExtraction | null> => {
  const session = await verifySession();
  if (!session) return null;
  return db.upload.findFirst({
    where: { id: uploadId, studentProfile: { userId: session.userId } },
    include: { extraction: { include: { _count: { select: { problems: true } } } } },
  });
});

/** An `Extraction` row plus its parent `Upload` and its `ExtractedProblem` rows, ordered by `ordinal` (never renumbered, ADR-0005). */
export type ExtractionWithProblems = Extraction & { upload: Upload; problems: ExtractedProblem[] };

/**
 * Resolves an extraction scoped to the CALLING user via the
 * `Extraction -> Upload -> StudentProfile.userId` join. Used by endpoints
 * 19-23 (`app/api/extractions/**`); a cross-account or nonexistent
 * `extractionId` is a 404 (M1 AC 33), never a 403 that would confirm the id
 * exists.
 */
export type ExtractionWithStudentProfile = Extraction & { upload: Upload & { studentProfile: StudentProfile } };

/**
 * `requireExtraction`, extended (S19 / plan §5.0): `upload` now carries its
 * `studentProfile` too, so M2 endpoint 29 (`POST
 * .../extractions/[extractionId]/practice-sets`) can run its Owner+ACTIVE
 * gate (`requireState`, ADR-0006 step 4) off the SAME resolved resource,
 * without a second query. Every existing caller (M1's confirm/retry/problem
 * routes) already loads `upload` and is unaffected by the extra nested field.
 */
export const requireExtraction = cache(
  async (extractionId: string): Promise<(ExtractionWithProblems & ExtractionWithStudentProfile) | null> => {
    const session = await verifySession();
    if (!session) return null;
    return db.extraction.findFirst({
      where: { id: extractionId, upload: { studentProfile: { userId: session.userId } } },
      include: { upload: { include: { studentProfile: true } }, problems: { orderBy: { ordinal: "asc" } } },
    });
  },
);

// ─────────────────────── M2: practice and mastery ───────────────────────

/**
 * A `PracticeSet` plus its ordered `PracticeProblem` rows, each with its
 * `Attempt` history and — the ONE place outside `lib/grading/**` this DAL
 * selects anything off `PracticeAnswerKey` — its `workedSolution` ONLY
 * (`select`, never `include`). `canonicalAnswer` and `acceptedForms` are
 * structurally impossible to obtain through this function: Prisma never
 * fetches a column that isn't named in a `select`, so the secret half of the
 * answer key cannot reach this row's memory at all, let alone a DTO
 * (ADR-0011 §5, M2 AC 17). `workedSolution` itself is still gated on
 * `revealed` by `lib/practice/dto.ts`'s `toPracticeProblemDTO` — see that
 * function's docstring for why this DAL can't withhold it structurally the
 * same way and what closes the gap instead.
 */
export type PracticeSetWithProblems = PracticeSet & {
  /** Just enough of the owning profile for the Owner+ACTIVE gate (endpoint 34's `requireState`) without a second query. */
  studentProfile: Pick<StudentProfile, "status">;
  problems: (PracticeProblem & {
    attempts: Attempt[];
    answerKey: Pick<PracticeAnswerKey, "workedSolution"> | null;
  })[];
};

/**
 * Resolves a practice set scoped to the CALLING user via the
 * `PracticeSet -> StudentProfile.userId` join — the same "id in a URL is not
 * authorization" rule (plan §0) applied to practice. Cross-account and
 * nonexistent ids are indistinguishable (both `null`), which is exactly the
 * 404 M2 AC 24 demands. Used by endpoint 30 and the practice-set page
 * (`app/(app)/practice/[practiceSetId]/page.tsx`).
 */
export const requirePracticeSet = cache(
  async (practiceSetId: string): Promise<PracticeSetWithProblems | null> => {
    const session = await verifySession();
    if (!session) return null;
    return db.practiceSet.findFirst({
      where: { id: practiceSetId, studentProfile: { userId: session.userId } },
      include: {
        studentProfile: { select: { status: true } },
        problems: {
          orderBy: { ordinal: "asc" },
          include: {
            attempts: { orderBy: { attemptNumber: "asc" } },
            answerKey: { select: { workedSolution: true } },
          },
        },
      },
    });
  },
);

/** A `PracticeProblem` plus its parent `PracticeSet` (with just enough of the owning profile for the Owner+ACTIVE gate) and its own `Attempt` history, ordered by `attemptNumber`. Deliberately WITHOUT `answerKey` — see `lib/grading/grade.ts`'s docstring for the one place that may load it (ADR-0011 §5, M2 AC 17). */
export type PracticeProblemWithContext = PracticeProblem & {
  practiceSet: PracticeSet & { studentProfile: Pick<StudentProfile, "status" | "gradeLevel"> };
  attempts: Attempt[];
};

/**
 * Resolves a practice problem scoped to the CALLING user via the
 * `PracticeProblem -> PracticeSet -> StudentProfile.userId` join. Used by
 * endpoints 32/33 (`app/api/practice-problems/[problemId]/**`). Cross-account
 * and nonexistent ids are both a 404 (M2 AC 24).
 */
export const requirePracticeProblem = cache(
  async (practiceProblemId: string): Promise<PracticeProblemWithContext | null> => {
    const session = await verifySession();
    if (!session) return null;
    return db.practiceProblem.findFirst({
      where: { id: practiceProblemId, practiceSet: { studentProfile: { userId: session.userId } } },
      include: {
        practiceSet: { include: { studentProfile: { select: { status: true, gradeLevel: true } } } },
        attempts: { orderBy: { attemptNumber: "asc" } },
      },
    });
  },
);

/**
 * The ONE function that may load a `PracticeAnswerKey` row (ADR-0011 §5,
 * M2 AC 17) — a reviewer grep for `practiceAnswerKey.findUnique` /
 * `include: { answerKey`, same control as ADR-0007's `parentalConsent.update`
 * convention. By convention only two call sites use it, both AFTER
 * independently re-verifying ownership via `requirePracticeProblem` above:
 * `lib/grading/grade.ts` and the reveal handler
 * (`app/api/practice-problems/[problemId]/reveal/route.ts`). This helper
 * takes an already-owned `practiceProblemId` rather than a session — it is a
 * second, narrower query on a resource ownership has already established,
 * not a second authorization path.
 */
export async function requirePracticeAnswerKey(practiceProblemId: string): Promise<PracticeAnswerKey | null> {
  return db.practiceAnswerKey.findUnique({ where: { practiceProblemId } });
}

/**
 * A chat session with everything one turn needs, and nothing it does not.
 *
 * `messages` carries the full transcript in `sequence` order because that IS
 * the conversation sent to the model — the API is stateless, so a turn resends
 * every prior turn. It is not a convenience include.
 *
 * The bound problem's TEXT arrives through exactly one of the two relations,
 * mirroring the CHECK constraint that guarantees exactly one is non-null.
 */
export type ChatSessionWithContext = ChatSession & {
  studentProfile: Pick<StudentProfile, "id" | "status">;
  extractedProblem: Pick<ExtractedProblem, "id" | "text"> | null;
  attempt: (Pick<Attempt, "id"> & { practiceProblem: Pick<PracticeProblem, "id" | "text"> }) | null;
  messages: ChatMessage[];
};

/**
 * Resolves a chat session scoped to the CALLING user via the
 * `ChatSession -> StudentProfile.userId` join. Used by endpoints 37/38/39
 * (`app/api/chat/sessions/[sessionId]/**`). A cross-account id and an unknown
 * id are both `null`, so both are a 404 — M3 AC 15's "no content is disclosed"
 * is this query's `where` clause, not a check the handler remembers to run.
 *
 * NOT wrapped in `cache()`, unlike its siblings above. The streaming route
 * re-reads this session AFTER its own transaction has written two message rows,
 * and a memoised read would hand back the pre-transaction transcript — the
 * request-scoped cache is a correctness hazard rather than a saving for the one
 * caller that mutates what it just read.
 */
export async function requireChatSession(sessionId: string): Promise<ChatSessionWithContext | null> {
  const session = await verifySession();
  if (!session) return null;
  return db.chatSession.findFirst({
    where: { id: sessionId, studentProfile: { userId: session.userId } },
    include: {
      studentProfile: { select: { id: true, status: true } },
      extractedProblem: { select: { id: true, text: true } },
      attempt: { select: { id: true, practiceProblem: { select: { id: true, text: true } } } },
      messages: { orderBy: { sequence: "asc" } },
    },
  });
}

/** An `ExtractedProblem` with the extraction whose status gates chat, and just enough of the owning profile for the Owner+ACTIVE gate. */
export type ExtractedProblemWithContext = ExtractedProblem & {
  extraction: Extraction & {
    upload: Upload & { studentProfile: Pick<StudentProfile, "id" | "status" | "gradeLevel"> };
  };
};

/**
 * Resolves an extracted problem scoped to the CALLING user via the
 * `ExtractedProblem -> Extraction -> Upload -> StudentProfile.userId` join.
 * Used by endpoint 35 (`POST /api/extracted-problems/[problemId]/chat-sessions`).
 *
 * Unlike M1's problem routes, this one addresses a problem by its OWN id with
 * no extraction in the path, so the ownership join is this query's `where` and
 * there is no parent resource to hang it off. Cross-account and nonexistent ids
 * are both `null`, so both are a 404 (M3 AC 15).
 */
export const requireExtractedProblem = cache(
  async (problemId: string): Promise<ExtractedProblemWithContext | null> => {
    const session = await verifySession();
    if (!session) return null;
    return db.extractedProblem.findFirst({
      where: { id: problemId, extraction: { upload: { studentProfile: { userId: session.userId } } } },
      include: {
        extraction: {
          include: {
            upload: { include: { studentProfile: { select: { id: true, status: true, gradeLevel: true } } } },
          },
        },
      },
    });
  },
);

/** An `Attempt` with the practice problem whose text a chat session is about, and its set's status. */
export type AttemptWithContext = Attempt & {
  practiceProblem: PracticeProblem & { practiceSet: PracticeSet };
  studentProfile: Pick<StudentProfile, "id" | "status" | "gradeLevel">;
};

/**
 * Resolves an attempt scoped to the CALLING user. `Attempt.studentProfileId` is
 * denormalised (see the schema note), so this is one index hit rather than a
 * three-table join — and it is the same profile either way.
 *
 * Used by endpoint 36 (`POST /api/attempts/[attemptId]/chat-sessions`), M2
 * AC 10's join point: the student got it wrong, and now wants to ask why.
 */
export const requireAttempt = cache(
  async (attemptId: string): Promise<AttemptWithContext | null> => {
    const session = await verifySession();
    if (!session) return null;
    return db.attempt.findFirst({
      where: { id: attemptId, studentProfile: { userId: session.userId } },
      include: {
        practiceProblem: { include: { practiceSet: true } },
        studentProfile: { select: { id: true, status: true, gradeLevel: true } },
      },
    });
  },
);

/** A `Lesson` with its versions, ordered, and just enough of the owning profile for the gates. */
export type LessonWithVersions = Lesson & {
  studentProfile: Pick<StudentProfile, "id" | "status" | "gradeLevel">;
  versions: LessonScriptVersion[];
};

/**
 * Resolves a lesson scoped to the CALLING user via the
 * `Lesson -> StudentProfile.userId` join. Used by endpoints 42-45
 * (`app/api/lessons/**`). A cross-account id and an unknown id are both `null`,
 * so both are a 404 — M4 AC 20's "no content is disclosed" is this query's
 * `where` clause rather than a check a handler has to remember.
 *
 * NOT wrapped in `cache()`. The regenerate and flag routes both write and then
 * re-read within one request, and a memoised read would hand back the
 * pre-write row — the same hazard `requireChatSession` carries and for the same
 * reason.
 */
export async function requireLesson(lessonId: string): Promise<LessonWithVersions | null> {
  const session = await verifySession();
  if (!session) return null;
  return db.lesson.findFirst({
    where: { id: lessonId, studentProfile: { userId: session.userId } },
    include: {
      studentProfile: { select: { id: true, status: true, gradeLevel: true } },
      versions: { orderBy: { version: "asc" } },
    },
  });
}

/** A `LessonNarration` row plus just enough of its relations to build `LessonNarrationDTO` (`lib/narration/dto.ts`'s `toLessonNarrationDTO`). */
export type LessonNarrationWithRelations = LessonNarration & {
  persona: Pick<Persona, "id" | "slug" | "label"> | null;
  steps: (LessonNarrationStep & { asset: Pick<NarrationAsset, "pathname" | "durationMs" | "cues"> })[];
};

/** A `LessonWithVersions` plus the CURRENT version's narration run, if any. */
export type LessonForNarration = LessonWithVersions & {
  narration: LessonNarrationWithRelations | null;
};

const NARRATION_RELATIONS_INCLUDE = {
  persona: { select: { id: true, slug: true, label: true } },
  steps: { include: { asset: { select: { pathname: true, durationMs: true, cues: true } } } },
} as const;

/**
 * `requireLesson` plus the current version's narration run — M5 endpoints
 * 46/47 (`app/api/lessons/[lessonId]/narration/route.ts`). Scoped by the
 * SAME `requireLesson` ownership join, so a cross-account id is still a 404
 * before this function's own query ever runs.
 *
 * **Narration belongs to a SCRIPT VERSION, not a lesson** (M5 plan §1) — the
 * lookup is keyed on `lesson.currentVersionId`, never on the lesson id, so
 * narrating version 2 never surfaces version 1's audio. `narration` is
 * `null` when there is no current version yet, or none has ever been
 * requested for it.
 */
export async function requireLessonForNarration(lessonId: string): Promise<LessonForNarration | null> {
  const lesson = await requireLesson(lessonId);
  if (!lesson) return null;

  const narration = lesson.currentVersionId
    ? await db.lessonNarration.findUnique({
        where: { versionId: lesson.currentVersionId },
        include: NARRATION_RELATIONS_INCLUDE,
      })
    : null;

  return { ...lesson, narration };
}

/** Re-reads one `LessonNarration` row with the relations `toLessonNarrationDTO` needs. Used after a reap changes status, when the caller's own snapshot may be stale (see the GET route's docstring). NOT ownership-scoped — callers must already hold an ownership-checked narration id. */
export async function fetchNarrationWithRelations(narrationId: string): Promise<LessonNarrationWithRelations> {
  return db.lessonNarration.findUniqueOrThrow({
    where: { id: narrationId },
    include: NARRATION_RELATIONS_INCLUDE,
  });
}
