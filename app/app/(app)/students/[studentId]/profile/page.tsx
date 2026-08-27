import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { StudentDetailForm } from "@/components/students/student-detail-form";
import { requireStudentProfile } from "@/lib/auth/dal";

/**
 * STEP 4 of the four-step add-a-student flow (plan §4/§5.2, F11; M0 AC 25).
 * Redirects unless `status === "ACTIVE"` — this is the collection point
 * `nextStep: "PROFILE_DETAILS"` names, and nothing collected here can
 * legally exist before consent is verified.
 *
 * If the profile already has a `displayName`, this step has already been
 * completed once — `/edit` (same form, same component) is the canonical
 * place to change these fields afterward (plan §4).
 */

export const metadata: Metadata = {
  title: "Set up this student's profile",
};

export default async function StudentProfilePage({
  params,
}: PageProps<"/students/[studentId]/profile">) {
  const { studentId } = await params;
  const student = await requireStudentProfile(studentId);

  if (!student || student.status !== "ACTIVE") {
    redirect("/dashboard");
  }

  if (student.displayName !== null) {
    redirect(`/students/${studentId}/edit`);
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Set up this student&apos;s profile
        </h1>
        <p className="text-sm text-muted-foreground">
          Add a display name, grade level, subjects and an avatar to finish
          setting up this profile.
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
