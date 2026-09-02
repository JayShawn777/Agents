import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Camera } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MasteryStrip } from "@/components/practice/mastery-strip";
import { StartCheckpointButton } from "@/components/checkpoints/start-checkpoint-button";
import { composeCheckpoint } from "@/lib/checkpoints/compose";
import { PracticeSetList } from "@/components/practice/practice-set-list";
import { StudentStatusBadge } from "@/components/students/student-status-badge";
import { UploadList, type UploadListRow } from "@/components/uploads/upload-list";
import { requireStudentProfile } from "@/lib/auth/dal";
import { DEFAULT_PERSONA_SLUG } from "@/lib/config";
import { toPracticeSetDTO, toSkillMasteryDTO } from "@/lib/practice/dto";
import { db } from "@/lib/db";
import { findPersonaById, findSharedPersonaBySlug } from "@/lib/personas/dal";
import { toStudentProfileDTO } from "@/lib/students/dto";
import { toUploadDTO } from "@/lib/uploads/dto";
import type { PracticeSetDTO, SkillMasteryDTO, StudentProfileDTO } from "@/lib/schemas/dto";

/**
 * The student's own page (plan §4/§5.2, F13; M0 AC 36, M1 AC 11). Gates
 * uploading on `status === 'ACTIVE'` — the ONLY precondition
 * `StudentProfileDTO.canUpload` encodes — but unlike a redirect, a profile
 * in any other status still lands here and sees an explanation of which
 * step is outstanding, with a link to continue it, rather than a disabled
 * control with no reason (this task's brief). The upload list itself is
 * shown regardless of status: uploads made before consent was withdrawn
 * remain visible.
 */

export const metadata: Metadata = {
  title: "Student",
};

type MissingStepCopy = {
  message: string;
  href: (studentId: string) => string;
  cta: string;
};

const MISSING_STEP_COPY: Partial<Record<StudentProfileDTO["nextStep"], MissingStepCopy>> = {
  NOTICE: {
    message: "Before uploads can start, a parent needs to review the notice about what we collect.",
    href: (id) => `/students/${id}/notice`,
    cta: "Review the notice",
  },
  CONSENT: {
    message: "Before uploads can start, a parent needs to give consent.",
    href: (id) => `/students/${id}/consent`,
    cta: "Continue to consent",
  },
  CONSENT_PENDING: {
    message: "We're waiting on a parent to confirm consent before uploads can start.",
    href: (id) => `/students/${id}/consent/pending`,
    cta: "Check consent status",
  },
};

export default async function StudentHomePage({
  params,
}: PageProps<"/students/[studentId]">) {
  const { studentId } = await params;
  const profileRow = await requireStudentProfile(studentId);
  if (!profileRow) notFound();

  const hasNotice = (await db.directNotice.count({ where: { studentProfileId: studentId } })) > 0;
  const student = toStudentProfileDTO(profileRow, { hasNotice });

  const uploadRows = await db.upload.findMany({
    where: { studentProfileId: studentId },
    orderBy: { createdAt: "desc" },
    include: { extraction: { select: { status: true } } },
  });

  const uploads: UploadListRow[] = uploadRows.map((row) => ({
    upload: toUploadDTO(row),
    extractionStatus: row.extraction?.status ?? null,
  }));

  // M2 AC 9/18-20 (plan §4, F20): mastery is a PARENT-facing read — this
  // page, not the practice runner, is where it renders. Reuses the SAME
  // `toSkillMasteryDTO` builder `lib/practice/dto.ts` exports, so this
  // strip can never diverge from what a future parent-report surface (M7)
  // reads off the same rows.
  const masteryRows = await db.skillMastery.findMany({
    where: { studentProfileId: studentId },
    orderBy: { lastPracticedAt: "desc" },
  });
  const mastery: SkillMasteryDTO[] = masteryRows.map(toSkillMasteryDTO);

  // M2.5 AC 4. Readiness is computed here from rows this page has ALREADY
  // loaded, through the same pure function the readiness endpoint calls — so
  // the button and the API can never disagree, and rendering it costs no extra
  // query and no client round trip. The endpoint still exists for clients that
  // need to ask without loading a page.
  const checkpointAvailable = composeCheckpoint(masteryRows).ok;

  // M2 AC 22-23 (plan §4, F23): the resumable practice-set list, reusing the
  // SAME `toPracticeSetDTO` the practice page and endpoint 30 use, so this
  // list can never drift from what the runner itself shows.
  // `kind: "PRACTICE"` is load-bearing, not tidiness. Without it a checkpoint
  // appears in this list labelled as practice, and — the part that matters —
  // every COMPLETE checkpoint becomes one click from every other, which is a
  // browsable score history assembled by accident. Spec AC 13 forbids showing
  // a value lower than one previously rendered; two old results a click apart
  // is that, built by hand instead of by us. Filtering in the QUERY rather
  // than after it makes it structurally impossible rather than remembered.
  const practiceSetRows = await db.practiceSet.findMany({
    where: { studentProfileId: studentId, kind: "PRACTICE" },
    orderBy: { createdAt: "desc" },
    include: { problems: { include: { attempts: true } } },
  });
  const practiceSets: PracticeSetDTO[] = practiceSetRows.map(toPracticeSetDTO);

  // An unfinished check-in is resumable; a finished one is not re-openable from
  // here. A child who walked away mid-checkpoint gets back to it, and nobody
  // gets a list of past scores to compare. `GENERATING` counts as unfinished so
  // the page does not offer a second one while the first is still being built.
  const unfinishedCheckpoint = await db.practiceSet.findFirst({
    where: {
      studentProfileId: studentId,
      kind: "CHECKPOINT",
      status: { in: ["GENERATING", "READY", "IN_PROGRESS"] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  const missingStep =
    student.status === "CONSENT_WITHDRAWN" || student.canUpload
      ? null
      : (MISSING_STEP_COPY[student.nextStep] ?? null);

  // M5 AC 4 / slice 11 — the child's way IN to the persona picker (previously
  // reachable only by typing `/students/[id]/voice`). `personaId` reads
  // straight off `profileRow`, the raw `StudentProfile` row `requireStudentProfile`
  // already returned — `StudentProfileDTO` carries no `personaId` (plan §3's
  // DTO shape), and `lessons/[lessonId]/page.tsx` resolves the same way for the
  // same reason. `personaId: null` is the DEFAULT persona, never "no voice" —
  // AC 4 — so this reads the default's own label rather than telling a child
  // they have nothing chosen, gated the same as uploading (`canUpload`) because
  // the picker page itself redirects a non-ACTIVE profile straight back here.
  const chosenPersona = student.canUpload
    ? await (profileRow.personaId
        ? findPersonaById(profileRow.personaId, profileRow.userId)
        : findSharedPersonaBySlug(DEFAULT_PERSONA_SLUG))
    : null;
  const personaIsChosen = Boolean(profileRow.personaId);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {student.displayName ?? "This student"}
          </h1>
          <StudentStatusBadge status={student.status} />
        </div>
        {student.canUpload ? (
          <Button className="h-11 gap-2" render={<Link href={`/students/${studentId}/uploads/new`} />}>
            <Camera className="size-4" />
            Upload schoolwork
          </Button>
        ) : null}
      </div>

      {!student.canUpload ? (
        <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          {student.status === "CONSENT_WITHDRAWN" ? (
            <p>
              Consent has been withdrawn for this profile, so new uploads
              aren&apos;t possible right now. Previously uploaded schoolwork
              below is unaffected.
            </p>
          ) : missingStep ? (
            <div className="flex flex-col gap-3">
              <p>{missingStep.message}</p>
              <Button
                variant="outline"
                className="h-11 w-fit"
                render={<Link href={missingStep.href(studentId)} />}
              >
                {missingStep.cta}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {student.canUpload && student.nextStep === "PROFILE_DETAILS" ? (
        <p className="text-xs text-muted-foreground">
          Tip:{" "}
          <Link href={`/students/${studentId}/profile`} className="underline underline-offset-2">
            finish setting up this profile
          </Link>{" "}
          to add a name, grade and subjects.
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-foreground">Uploads</h2>
        <UploadList uploads={uploads} studentId={studentId} canUpload={student.canUpload} />
      </div>

      {practiceSets.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-foreground">Practice</h2>
          <PracticeSetList sets={practiceSets} />
        </div>
      ) : null}

      <MasteryStrip mastery={mastery} />

      {/*
        M3 AC 14 — the parent's way into the tutor transcripts. The user story
        is trust: a machine talks to their child unsupervised, so the record of
        what it said has to be reachable without being hunted for. Always
        present, even with no sessions yet, because a parent looking for this
        and not finding it learns the wrong thing.
      */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-foreground">Tutor conversations</h2>
        <p className="text-sm text-muted-foreground">
          Everything the tutor and your child said to each other.
        </p>
        <Link
          href={`/students/${studentId}/chat`}
          className="w-fit rounded-lg border border-border px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted/40"
        >
          Read the conversations
        </Link>
      </div>

      {student.canUpload ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-foreground">Tutor&apos;s voice</h2>
          <p className="text-sm text-muted-foreground">
            {personaIsChosen && chosenPersona
              ? `${chosenPersona.label} reads ${student.displayName ?? "this student"}'s lessons aloud.`
              : chosenPersona
                ? `${chosenPersona.label} reads lessons aloud by default — pick a different voice any time.`
                : "Every lesson can be read aloud. Choose who reads it."}
          </p>
          <Link
            href={`/students/${studentId}/voice`}
            className="w-fit rounded-lg border border-border px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted/40"
          >
            {personaIsChosen ? "Change your tutor's voice" : "Choose your tutor's voice"}
          </Link>
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-foreground">Check-in</h2>
        <p className="text-sm text-muted-foreground">
          A short mix of questions from things practised a while back, to see what&apos;s stuck.
        </p>
        {unfinishedCheckpoint ? (
          <Link
            href={`/practice/${unfinishedCheckpoint.id}`}
            className="w-fit rounded-lg border border-border px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted/40"
          >
            Finish your check-in
          </Link>
        ) : (
          <StartCheckpointButton studentId={studentId} available={checkpointAvailable} />
        )}
      </div>
    </div>
  );
}
