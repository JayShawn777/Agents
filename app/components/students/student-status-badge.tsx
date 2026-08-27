import { Badge } from "@/components/ui/badge";
import type { StudentProfileStatus } from "@/lib/domain/enums";

/**
 * One badge per `StudentProfileStatus` (plan §4; M0 AC 9, 18, 24). Server
 * component — no interactivity.
 *
 * Both maps are `Record<StudentProfileStatus, …>`, not `Record<string, …>`,
 * so adding a fifth status to the enum is a typecheck failure here rather
 * than a badge silently rendering nothing.
 */

const STATUS_LABELS: Record<StudentProfileStatus, string> = {
  NOTICE_PENDING: "Notice pending",
  CONSENT_PENDING: "Waiting for consent",
  ACTIVE: "Active",
  CONSENT_WITHDRAWN: "Consent withdrawn",
};

const STATUS_VARIANTS: Record<
  StudentProfileStatus,
  "default" | "outline" | "destructive"
> = {
  NOTICE_PENDING: "outline",
  CONSENT_PENDING: "outline",
  ACTIVE: "default",
  CONSENT_WITHDRAWN: "destructive",
};

export function StudentStatusBadge({
  status,
}: {
  status: StudentProfileStatus;
}) {
  return <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>;
}
