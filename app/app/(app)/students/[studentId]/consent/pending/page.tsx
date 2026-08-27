import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { getConsentMethodCopy } from "@/components/consent/method-copy";
import { requireStudentProfile } from "@/lib/auth/dal";
import { activeConsentMethodProvider } from "@/lib/consent/methods/registry";

/**
 * STEP 3b of the four-step add-a-student flow (plan §4/§5.2, F9; M0 AC 18).
 * "Check your email" for `EMAIL_PLUS`, method-neutral copy resolved from
 * the active provider's `stepCopyId` — never a hard-coded message and never
 * a branch on `ConsentMethod` (ADR-0008 §3). Polls nothing: the parent
 * returns to the app on their own, via the link in the confirmation email
 * (the public, session-free `/consent/verify/[token]` page — out of this
 * file's tree — is what actually completes the corroborating step).
 */

export const metadata: Metadata = {
  title: "Waiting on consent confirmation",
};

export default async function ConsentPendingPage({
  params,
}: PageProps<"/students/[studentId]/consent/pending">) {
  const { studentId } = await params;
  const student = await requireStudentProfile(studentId);

  if (!student) {
    redirect("/dashboard");
  }

  if (student.status === "ACTIVE") {
    redirect(
      student.displayName === null
        ? `/students/${studentId}/profile`
        : `/students/${studentId}`,
    );
  }

  if (student.status !== "CONSENT_PENDING") {
    redirect("/dashboard");
  }

  const copy = getConsentMethodCopy(activeConsentMethodProvider.stepCopyId);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-6 px-4 py-16 text-center sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        {copy.pending.title}
      </h1>
      <div className="flex flex-col gap-2 text-sm text-muted-foreground">
        {copy.pending.body.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      <Button variant="outline" className="h-11" render={<Link href="/dashboard" />}>
        Back to dashboard
      </Button>
    </div>
  );
}
