import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Camera } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StudentStatusBadge } from "@/components/students/student-status-badge";
import { UploadList, type UploadListRow } from "@/components/uploads/upload-list";
import { requireStudentProfile } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { toStudentProfileDTO } from "@/lib/students/dto";
import { toUploadDTO } from "@/lib/uploads/dto";
import type { StudentProfileDTO } from "@/lib/schemas/dto";

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

  const missingStep =
    student.status === "CONSENT_WITHDRAWN" || student.canUpload
      ? null
      : (MISSING_STEP_COPY[student.nextStep] ?? null);

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
    </div>
  );
}
