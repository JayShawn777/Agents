import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { DeleteChildDataDialog } from "@/components/consent/delete-child-data-dialog";
import { requireStudentProfile } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { toConsentDTO, toDirectNoticeDTO } from "@/lib/students/dto";
import type { ConsentMethod, ConsentRelationship } from "@/lib/domain/enums";

/**
 * The parent's §312.6 surface (plan §4, F12; M0 AC 24, 48, 49). Reachable
 * from the student profile (linked from the dashboard for a
 * `CONSENT_WITHDRAWN` profile today; `students/[studentId]/page.tsx`, F13,
 * out of this task's scope, is the other intended link-in point once it
 * lands — see the frontend report for this milestone).
 *
 * Deliberately shows TWO SEPARATE actions, never blurred into one (this
 * milestone's brief): "Withdraw consent" (endpoint 12 — stops further
 * collection, appends a record, keeps existing data) and "Delete this
 * student's data" (endpoint 6 — immediate, irreversible, no recovery
 * window). Account closure is never mentioned here — it is a different act
 * on a different resource (the account, not this student), and AC 49
 * requires this deletion path to be reachable WITHOUT it.
 *
 * `toConsentDTO`/`toDirectNoticeDTO` (`lib/students/dto.ts`) are reused
 * as-is for the same reason `toStudentProfileDTO` is reused on the
 * dashboard: one mapping function per shape, and this page's own direct
 * `@/lib/db` read (same pattern as `app/(app)/dashboard/page.tsx`) never
 * touches `methodEvidence`, `ipAddress` or `userAgent` — those DTOs already
 * exclude them.
 */

export const metadata: Metadata = {
  title: "Privacy and data",
};

const RELATIONSHIP_LABELS: Record<ConsentRelationship, string> = {
  PARENT: "Parent",
  LEGAL_GUARDIAN: "Legal guardian",
  OTHER_CAREGIVER: "Other authorized caregiver",
  SELF: "The student themself",
};

const METHOD_LABELS: Record<ConsentMethod, string> = {
  SIGNED_FORM: "Signed consent form",
  PAYMENT_CARD: "Payment card verification",
  TOLL_FREE_PHONE: "Toll-free phone call",
  VIDEO_CONFERENCE: "Video conference",
  GOV_ID_CHECK: "Government ID check",
  KBA: "Knowledge-based authentication",
  FMVPI: "Face match to verified photo ID",
  EMAIL_PLUS: "Email confirmation",
  TEXT_PLUS: "Text message confirmation",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default async function StudentPrivacyPage({
  params,
}: PageProps<"/students/[studentId]/privacy">) {
  const { studentId } = await params;
  const student = await requireStudentProfile(studentId);

  if (!student) {
    redirect("/dashboard");
  }

  const [noticeRow, consentRow] = await Promise.all([
    db.directNotice.findFirst({
      where: { studentProfileId: student.id },
      orderBy: { presentedAt: "desc" },
    }),
    db.parentalConsent.findFirst({
      where: { studentProfileId: student.id },
      orderBy: { submittedAt: "desc" },
    }),
  ]);

  const notice = noticeRow ? toDirectNoticeDTO(noticeRow) : null;
  const consent = consentRow ? toConsentDTO(consentRow) : null;
  const label = student.displayName ?? "This student";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {label}&apos;s privacy and data
        </h1>
        <p className="text-sm text-muted-foreground">
          What we have on record for this student, and your options for
          managing it.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Notice</CardTitle>
          <CardDescription>
            The direct notice shown before consent was requested.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5 text-sm text-muted-foreground">
          {notice ? (
            <>
              <p>Version {notice.noticeVersion}</p>
              <p>Shown {formatDate(notice.presentedAt)}</p>
              <p>
                {notice.sentAt
                  ? `Emailed ${formatDate(notice.sentAt)}`
                  : "Not yet confirmed as emailed"}
              </p>
            </>
          ) : (
            <p>No notice has been shown yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Consent record</CardTitle>
          <CardDescription>
            The most recent verifiable parental consent record for this
            student.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5 text-sm text-muted-foreground">
          {consent ? (
            <>
              <p>Relationship: {RELATIONSHIP_LABELS[consent.relationship]}</p>
              <p>Method: {METHOD_LABELS[consent.method]}</p>
              <p>
                Consent text version {consent.consentTextVersion}, notice
                version {consent.noticeVersion}
              </p>
              <p>Submitted {formatDate(consent.submittedAt)}</p>
              <p>
                {consent.verifiedAt
                  ? `Confirmed ${formatDate(consent.verifiedAt)}`
                  : "Not yet confirmed — waiting on the confirmation step."}
              </p>
              {consent.withdrawnAt ? (
                <p>Withdrawn {formatDate(consent.withdrawnAt)}</p>
              ) : null}
            </>
          ) : (
            <p>No consent has been submitted yet.</p>
          )}
        </CardContent>
      </Card>

      {student.status === "ACTIVE" ? (
        <Card>
          <CardHeader>
            <CardTitle>Withdraw consent</CardTitle>
            <CardDescription>
              Stops any further collection of information about this
              student. Information already collected stays on file under our
              normal retention policy unless you also delete it below.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              className="h-11"
              render={<Link href={`/students/${studentId}/consent/withdraw`} />}
            >
              Withdraw consent
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {student.status === "CONSENT_WITHDRAWN" ? (
        <p className="text-sm text-muted-foreground">
          Consent has been withdrawn for this student. No further
          information is being collected about them.
        </p>
      ) : null}

      <Separator />

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle>Delete this student&apos;s data</CardTitle>
          <CardDescription>
            Immediately and permanently deletes everything we have about
            this student. This is separate from closing your account — you
            do not need to close your account to do this.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DeleteChildDataDialog studentId={studentId} studentLabel={label} />
        </CardContent>
      </Card>
    </div>
  );
}
