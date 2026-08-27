import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { WithdrawConsentForm } from "@/components/consent/withdraw-consent-form";
import { requireStudentProfile } from "@/lib/auth/dal";

/**
 * Shell for the withdraw-consent action (plan §4, F12; M0 AC 24). Reachable
 * from the student's privacy page. Endpoint 12 itself 409s anything that
 * isn't `ACTIVE` (`lib/consent/service.ts`'s `withdrawConsent`); redirecting
 * here means the parent never lands on a form that can't succeed.
 */

export const metadata: Metadata = {
  title: "Withdraw consent",
};

export default async function WithdrawConsentPage({
  params,
}: PageProps<"/students/[studentId]/consent/withdraw">) {
  const { studentId } = await params;
  const student = await requireStudentProfile(studentId);

  if (!student) {
    redirect("/dashboard");
  }

  if (student.status !== "ACTIVE") {
    redirect(`/students/${studentId}/privacy`);
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Withdraw consent for {student.displayName ?? "this student"}
        </h1>
        <p className="text-sm text-muted-foreground">
          This stops any further collection of information about this
          student. It does not delete what we&apos;ve already collected —
          use the delete option on the privacy page for that.
        </p>
      </div>
      <WithdrawConsentForm studentId={student.id} />
    </div>
  );
}
