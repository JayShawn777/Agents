import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";

/**
 * Flags a problem below `LOW_CONFIDENCE_THRESHOLD` as needing the student's
 * check (plan §4/§5.2, F16; M1 AC 26). Server component — a static badge,
 * no interactivity of its own.
 */
export function LowConfidenceBadge() {
  return (
    <Badge variant="outline" className="gap-1 border-primary/40 text-primary">
      <AlertTriangle className="size-3" aria-hidden="true" />
      Please double-check
    </Badge>
  );
}
