import Link from "next/link";
import { GraduationCap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteStudentDialog } from "@/components/students/delete-student-dialog";
import { StudentStatusBadge } from "@/components/students/student-status-badge";
import { GRADE_LEVEL_LABELS, SUBJECT_LABELS } from "@/lib/domain/enums";
import type { StudentProfileDTO } from "@/lib/schemas/dto";

/**
 * One dashboard tile per student profile (plan §4, F6; M0 AC 7, 31, 33).
 * Server component — no interactivity of its own; the delete affordance is
 * delegated to the client `DeleteStudentDialog`.
 *
 * **`displayName` can be `null` on a legitimate, non-broken profile** — an
 * `ACTIVE` profile whose owner hasn't finished the detail step yet, or any
 * pre-consent profile (`NOTICE_PENDING`/`CONSENT_PENDING`), which never has
 * one. Both are rendered as their own explicit label rather than blank
 * space or a raw `null`.
 */

function displayTitle(student: StudentProfileDTO): string {
  if (student.displayName) return student.displayName;
  if (student.status === "ACTIVE") return "Finish setting up";
  if (student.status === "CONSENT_WITHDRAWN") return "Consent withdrawn";
  return "Waiting for your consent";
}

/** Where the primary action button on a card should go, derived from the
 * server-computed `nextStep` — this component never re-implements the
 * status state machine (plan §3, `StudentProfileDTO.nextStep`). */
function primaryAction(student: StudentProfileDTO): { href: string; label: string } {
  switch (student.nextStep) {
    case "NOTICE":
      return { href: `/students/${student.id}/notice`, label: "Continue" };
    case "CONSENT":
      return { href: `/students/${student.id}/consent`, label: "Continue to consent" };
    case "CONSENT_PENDING":
      return {
        href: `/students/${student.id}/consent/pending`,
        label: "Check consent status",
      };
    case "PROFILE_DETAILS":
      return { href: `/students/${student.id}/profile`, label: "Finish setting up" };
    case "NONE":
    default:
      return student.status === "CONSENT_WITHDRAWN"
        ? { href: `/students/${student.id}/privacy`, label: "View details" }
        : { href: `/students/${student.id}`, label: "View" };
  }
}

export function StudentCard({ student }: { student: StudentProfileDTO }) {
  const action = primaryAction(student);
  const label = displayTitle(student);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <GraduationCap className="size-5" aria-hidden="true" />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle className="truncate">{label}</CardTitle>
            {student.gradeLevel ? (
              <p className="truncate text-xs text-muted-foreground">
                {GRADE_LEVEL_LABELS[student.gradeLevel]}
              </p>
            ) : null}
          </div>
        </div>
        <StudentStatusBadge status={student.status} />
      </CardHeader>

      {student.subjects.length > 0 ? (
        <CardContent className="flex flex-wrap gap-1.5">
          {student.subjects.map((subject) => (
            <span
              key={subject}
              className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
            >
              {SUBJECT_LABELS[subject]}
            </span>
          ))}
        </CardContent>
      ) : null}

      <CardContent className="flex items-center justify-between gap-2">
        <Button
          variant="outline"
          className="h-11"
          render={<Link href={action.href} />}
        >
          {action.label}
        </Button>
        <DeleteStudentDialog studentId={student.id} studentLabel={label} />
      </CardContent>
    </Card>
  );
}
