import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { StudentDetailForm } from "@/components/students/student-detail-form";
import { requireStudentProfile } from "@/lib/auth/dal";

/**
 * Same form as STEP 4, for an already-complete profile (plan §4/§5.2, F11;
 * M0 AC 30). Requires `ACTIVE` — the PATCH endpoint's own `requireState`
 * gate (`app/api/students/[studentId]/route.ts`) would 403 anything else
 * anyway, but redirecting here means the parent never sees a form they
 * can't submit.
 */

export const metadata: Metadata = {
  title: "Edit student profile",
};

export default async function StudentEditPage({
  params,
}: PageProps<"/students/[studentId]/edit">) {
  const { studentId } = await params;
  const student = await requireStudentProfile(studentId);

  if (!student || student.status !== "ACTIVE") {
    redirect("/dashboard");
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Edit {student.displayName ?? "this student"}&apos;s profile
        </h1>
        <p className="text-sm text-muted-foreground">
          Update the display name, grade level, subjects or avatar.
        </p>
      </div>
      <StudentDetailForm
        studentId={student.id}
        initial={{
          displayName: student.displayName,
          gradeLevel: student.gradeLevel,
          subjects: student.subjects,
          avatarId: student.avatarId,
        }}
      />
    </div>
  );
}
