import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AuthoringState } from "@/components/lessons/authoring-state";
import { FailedLesson } from "@/components/lessons/failed-lesson";
import { LessonTextView } from "@/components/lessons/lesson-text-view";
import { LessonView } from "@/components/lessons/lesson-view";
import { RegenerateLessonButton } from "@/components/lessons/regenerate-lesson-button";
import { requireLesson } from "@/lib/auth/dal";
import { reapIfStale } from "@/lib/lessons/author";
import { toLessonDetail } from "@/lib/lessons/dto";
import { atVersionCap } from "@/lib/lessons/request";

/**
 * The lesson screen (plan §4, F24; M4 AC 6, 10, 11, 12, 15, 16, 18, 19).
 *
 * Server component: loads through the DAL (`requireLesson`, owner-scoped)
 * rather than fetching its own route handler, the same convention as the M1
 * upload, M2 practice and M3 chat pages (ADR-0006). `notFound()` on a null
 * resolve is AC 20 — a cross-account id and a nonexistent one are
 * indistinguishable.
 *
 * The LaTeX in every `write` op is rendered to HTML here, on the server
 * (ADR-0019 §3), so no KaTeX JavaScript ships for this route either.
 *
 * **The text view renders alongside the player, always** — not behind a toggle.
 * AC 16 wants a static worked example that stands on its own, and a child who
 * needs it is exactly the child least likely to go looking for a mode switch.
 */

export const metadata: Metadata = {
  title: "Lesson",
};

export default async function LessonPage({ params }: PageProps<"/lessons/[lessonId]">) {
  const { lessonId } = await params;

  const lessonRow = await requireLesson(lessonId);
  if (!lessonRow) notFound();

  // AC 6's lazy reap, gated on ACTIVE for the same reason endpoint 42 gates it:
  // this WRITES, and a parent may open a lesson after withdrawing consent.
  const reaped =
    lessonRow.studentProfile.status === "ACTIVE" ? await reapIfStale(lessonRow) : lessonRow;

  const current = lessonRow.versions.find((version) => version.id === lessonRow.currentVersionId) ?? null;
  const { lesson, version } = toLessonDetail(
    { ...lessonRow, status: reaped.status },
    reaped.status !== lessonRow.status && current ? { ...current, status: "FAILED" } : current,
  );

  const capped = atVersionCap(lesson.versionCount);

  /**
   * **Whether there is something to play, which is not the same as
   * `lesson.status === "READY"`.**
   *
   * `currentVersionId` is repointed only by a SUCCESSFUL run, so after a failed
   * regeneration it still points at the version that worked — `openNextVersion`
   * leaves it alone on purpose, and AC 19 is the promise that "a failed
   * regeneration leaves the student with the lesson they already had".
   * Gating the player on the LESSON's status broke that promise: `finalizeFailed`
   * sets the lesson to FAILED, the player disappeared, and a perfectly good
   * stored lesson became unreachable — permanently, if the child was at
   * `MAX_LESSON_VERSIONS`, because the regenerate button hides there too.
   */
  const playable = Boolean(version?.script && version.timeline);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      {lesson.status === "PENDING" || lesson.status === "AUTHORING" ? (
        <AuthoringState lessonId={lesson.id} />
      ) : null}

      {lesson.status === "FAILED" && !playable ? (
        <FailedLesson lessonId={lesson.id} failureMessage={lesson.failureMessage} atVersionCap={capped} />
      ) : null}

      {lesson.status === "FAILED" && playable ? (
        // The new explanation failed but the old one still plays. Say so
        // without taking the lesson away.
        <p
          role="status"
          className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
        >
          {lesson.failureMessage ?? "That new explanation didn’t work out."} Here’s the one you had
          before.
        </p>
      ) : null}

      {playable && version?.script && version.timeline ? (
        <>
          <LessonView
            lessonId={lesson.id}
            versionId={version.id}
            script={version.script}
            timeline={version.timeline}
            atVersionCap={capped}
          />

          {/*
            AC 19's affordance, next to the lesson rather than hidden in the
            flag flow — a child may simply want it explained differently
            without having said anything was wrong with it.
          */}
          {capped ? null : <RegenerateLessonButton lessonId={lesson.id} />}

          <div className="border-t border-border pt-6">
            <LessonTextView script={version.script} />
          </div>
        </>
      ) : null}
    </div>
  );
}
