import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { UploadPanel } from "@/components/uploads/upload-panel";
import { requireStudentProfile } from "@/lib/auth/dal";

/**
 * Shell for the upload flow (plan §4/§5.2, F15). Server component — its
 * only job is the ownership/status gate and passing `studentProfileId` down
 * to the client panel that does the actual work.
 *
 * `requireStudentProfile` returns `null` for both "not found" and "not
 * owned" (M1 AC 33), which is exactly the 404 this page renders via
 * `notFound()`. A profile that IS owned but not `ACTIVE` redirects back to
 * the student's own page (M1 AC 11) — that page is where the "which step is
 * outstanding" explanation lives (F13), not here; this is defense in depth,
 * not the real security boundary. The real boundary is
 * `POST /api/blob/upload` (endpoint 14, backend track) refusing to issue a
 * token for a non-`ACTIVE` profile.
 */

export const metadata: Metadata = {
  title: "Upload schoolwork",
};

export default async function NewUploadPage({
  params,
}: PageProps<"/students/[studentId]/uploads/new">) {
  const { studentId } = await params;
  const student = await requireStudentProfile(studentId);
  if (!student) notFound();
  if (student.status !== "ACTIVE") {
    redirect(`/students/${studentId}`);
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Upload schoolwork
        </h1>
        <p className="text-sm text-muted-foreground">
          Take a photo or upload a PDF of a worksheet. We&apos;ll read the
          problems off the page so you can start working through them.
        </p>
      </div>
      <UploadPanel studentProfileId={studentId} />
    </div>
  );
}
