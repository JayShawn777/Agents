import "server-only";

import type { Lesson, LessonFlag, LessonScriptVersion } from "@/lib/generated/prisma/client";
import type {
  LessonDetailResponse,
  LessonDTO,
  LessonFlagDTO,
  LessonVersionDTO,
  RenderableDrawOp,
  RenderableLessonScript,
} from "@/lib/schemas/dto";
import { LessonScriptSchema, type LessonScript } from "@/lib/lessons/script-schema";
import { deriveTimeline } from "@/lib/lessons/validate";
import { renderMathText } from "@/lib/math/render";
import {
  ERROR_MESSAGES,
  LESSON_FAILURE_CODES,
  LESSON_FAILURE_MESSAGES,
  type LessonFailureCode,
} from "@/lib/errors";

/**
 * Mapping functions for the M4 lesson DTOs. Mirrors `lib/practice/dto.ts` and
 * `lib/chat/dto.ts`: the ONLY place these shapes are built from Prisma rows.
 *
 * Two properties are load-bearing here, and `tests/unit/lib/lessons/dto.test.ts`
 * asserts both:
 *
 *   1. **`model`, `effort`, `promptVersion`, `schemaVersion`, `failureCode` and
 *      the token counts never leave the server.** They describe how we called a
 *      vendor. `failureCode` in particular is the thing AC 10 forbids reaching
 *      a browser, and it is mapped through a fixed allowlist instead.
 *   2. **A script is only ever returned when the version is `READY`.** A
 *      `FAILED` or in-flight version carries `script: null` — AC 2's "zero
 *      steps persisted" expressed as a shape a client cannot misread.
 */

/**
 * ADR-0019 §3. Each `write` op's LaTeX is rendered to HTML here, on the server,
 * so the player never imports KaTeX. `latex` is kept beside it because AC 16's
 * text view needs readable source and a screen reader must not be handed KaTeX
 * markup.
 *
 * `renderMathText` expects `$…$`-delimited prose; a `write` op's `latex` is a
 * bare expression, so it is wrapped before rendering. That is the one place the
 * two conventions meet, and doing it here means no caller has to remember.
 */
function toRenderableScript(script: LessonScript): RenderableLessonScript {
  return {
    title: script.title,
    steps: script.steps.map((step) => ({
      id: step.id,
      narration: step.narration,
      durationMs: step.durationMs,
      ops: step.ops.map((op): RenderableDrawOp =>
        op.kind === "write" ? { ...op, latexHtml: renderMathText(`$${op.latex}$`) } : op,
      ),
    })),
  };
}

function toFailureMessage(failureCode: string | null): string | null {
  if (failureCode === null) return null;
  return LESSON_FAILURE_CODES.includes(failureCode as LessonFailureCode)
    ? LESSON_FAILURE_MESSAGES[failureCode as LessonFailureCode]
    : // An unrecognised code is still a failure the student must be told about,
      // and the one thing it must never do is arrive verbatim.
      ERROR_MESSAGES.INTERNAL_ERROR;
}

type LessonForDTO = Pick<
  Lesson,
  "id" | "status" | "extractedProblemId" | "practiceProblemId" | "currentVersionId" | "createdAt"
> & {
  versions?: { id: string; failureCode: string | null }[];
};

export function toLessonDTO(lesson: LessonForDTO): LessonDTO {
  // The CHECK constraint guarantees exactly one is non-null
  // (`tests/integration/lesson-binding-constraint.test.ts`). The `?? ""` is
  // unreachable while it is live and exists so a DTO builder is not the thing
  // that throws if it ever is not.
  const subject: LessonDTO["subject"] = lesson.extractedProblemId
    ? { kind: "EXTRACTED_PROBLEM", id: lesson.extractedProblemId }
    : { kind: "PRACTICE_PROBLEM", id: lesson.practiceProblemId ?? "" };

  const current = lesson.versions?.find((version) => version.id === lesson.currentVersionId);

  return {
    id: lesson.id,
    status: lesson.status,
    subject,
    currentVersionId: lesson.currentVersionId,
    versionCount: lesson.versions?.length ?? 0,
    failureMessage: lesson.status === "FAILED" ? toFailureMessage(current?.failureCode ?? null) : null,
    createdAt: lesson.createdAt.toISOString(),
  };
}

type VersionForDTO = Pick<
  LessonScriptVersion,
  "id" | "version" | "status" | "script" | "stepCount" | "totalDurationMs"
>;

export function toLessonVersionDTO(version: VersionForDTO): LessonVersionDTO {
  // Re-parsed rather than cast. `script` is a `Json` column, so its TypeScript
  // type is a lie the moment anything writes to the database outside this app —
  // a migration, a fixture, a future admin tool. Parsing costs microseconds and
  // means a malformed document surfaces as "no script" rather than as a
  // renderer crash in front of a child.
  const parsed = version.status === "READY" && version.script !== null
    ? LessonScriptSchema.safeParse(version.script)
    : null;
  const script = parsed?.success ? parsed.data : null;

  return {
    id: version.id,
    version: version.version,
    status: version.status,
    script: script ? toRenderableScript(script) : null,
    stepCount: version.stepCount,
    totalDurationMs: version.totalDurationMs,
    timeline: script ? deriveTimeline(script).offsets : null,
  };
}

export function toLessonFlagDTO(flag: Pick<LessonFlag, "id" | "versionId" | "stepIndex" | "reason" | "createdAt">): LessonFlagDTO {
  return {
    id: flag.id,
    versionId: flag.versionId,
    stepIndex: flag.stepIndex,
    reason: flag.reason,
    createdAt: flag.createdAt.toISOString(),
  };
}

/** The response every lesson endpoint returns, built in one place. */
export function toLessonDetail(lesson: LessonForDTO, version: VersionForDTO | null): LessonDetailResponse {
  return {
    lesson: toLessonDTO(lesson),
    version: version ? toLessonVersionDTO(version) : null,
  };
}
