import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ConsentForm } from "@/components/consent/consent-form";
import { ConsentText } from "@/components/consent/consent-text";
import { requireStudentProfile } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { activeConsentMethodProvider } from "@/lib/consent/methods/registry";
import { CONSENT_TEXT_VERSION } from "@/lib/config";

/**
 * STEP 3 of the four-step add-a-student flow (plan §4/§5.2, F9; M0 AC 15,
 * 17, 18, 20, 21). Server component: server-resolves the configured
 * `ConsentMethodProvider` and renders its `stepCopyId`-driven copy; the
 * form itself needs client state, so it lives in `ConsentForm`.
 *
 * `requireStudentProfile` (`lib/auth/dal.ts`) returns `null` for both "no
 * such profile" and "not this account's profile" (AC 32) — both bounce to
 * the dashboard, same as any status this screen doesn't apply to.
 *
 * AC 15: a `DirectNotice` must already exist for this profile before this
 * screen may render — read directly here (the dashboard page,
 * `app/(app)/dashboard/page.tsx`, already establishes the precedent of a
 * frontend server component querying `@/lib/db` directly for its own
 * page-level read). No notice yet → back to STEP 2.
 */

export const metadata: Metadata = {
  title: "Give your consent",
};

export default async function StudentConsentPage({
  params,
}: PageProps<"/students/[studentId]/consent">) {
  const { studentId } = await params;
  const student = await requireStudentProfile(studentId);

  if (!student) {
    redirect("/dashboard");
  }

  if (student.status === "CONSENT_PENDING") {
    redirect(`/students/${studentId}/consent/pending`);
  }

  if (student.status !== "NOTICE_PENDING") {
    // ACTIVE or CONSENT_WITHDRAWN: nothing left to do on this screen.
    redirect("/dashboard");
  }

  const notice = await db.directNotice.findFirst({
    where: { studentProfileId: student.id },
    orderBy: { presentedAt: "desc" },
  });

  if (!notice) {
    redirect(`/students/${studentId}/notice`);
  }

  const provider = activeConsentMethodProvider;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <ConsentText stepCopyId={provider.stepCopyId} />
      <ConsentForm
        studentId={student.id}
        directNoticeId={notice.id}
        noticeVersion={notice.noticeVersion}
        consentTextVersion={CONSENT_TEXT_VERSION}
        method={provider.method}
      />
    </div>
  );
}
