import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DirectNotice } from "@/components/consent/direct-notice";
import { requireStudentProfile } from "@/lib/auth/dal";

/**
 * STEP 2 of the four-step add-a-student flow (plan §4/§5.2, F8; M0 AC 12,
 * 13, 14). Server component: the §312.4 notice itself is static, versioned
 * copy (`direct-notice.tsx`) — nothing here needs client interactivity.
 *
 * `requireStudentProfile` (`lib/auth/dal.ts`) returns `null` for both "no
 * such profile" and "not this account's profile" (AC 32) — both bounce to
 * the dashboard identically, same as any other status that isn't
 * `NOTICE_PENDING`.
 */

export const metadata: Metadata = {
  title: "Before you continue",
};

export default async function StudentNoticePage({
  params,
}: PageProps<"/students/[studentId]/notice">) {
  const { studentId } = await params;
  const student = await requireStudentProfile(studentId);

  if (!student || student.status !== "NOTICE_PENDING") {
    redirect("/dashboard");
  }

  return <DirectNotice studentId={student.id} />;
}
