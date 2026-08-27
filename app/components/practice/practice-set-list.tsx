import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { PracticeSetDTO } from "@/lib/schemas/dto";

/**
 * The profile's practice sets, resumable (plan §4, F23; M2 AC 22-23). Server
 * component — a plain list of links, no interactivity. Progress is always
 * framed as a count ("2 problems left"), never a score (M2 AC 20).
 */

const STATUS_LABEL: Record<PracticeSetDTO["status"], string> = {
  GENERATING: "Preparing…",
  READY: "Ready to start",
  IN_PROGRESS: "In progress",
  COMPLETE: "Completed",
  FAILED: "Couldn't generate",
};

const STATUS_BADGE_VARIANT: Record<PracticeSetDTO["status"], "outline" | "secondary" | "destructive"> = {
  GENERATING: "outline",
  READY: "outline",
  IN_PROGRESS: "outline",
  COMPLETE: "secondary",
  FAILED: "destructive",
};

function progressCopy(set: PracticeSetDTO): string {
  if (set.status === "FAILED") return set.failureMessage ?? "Something went wrong generating this set.";
  if (set.status === "COMPLETE") {
    return `${set.problemCount} problem${set.problemCount === 1 ? "" : "s"} completed`;
  }
  if (set.status === "GENERATING") return "Getting your problems ready…";

  const remaining = set.problemCount - set.answeredCount;
  if (remaining <= 0) return "Ready to finish";
  return `${remaining} problem${remaining === 1 ? "" : "s"} left`;
}

export function PracticeSetList({ sets }: { sets: PracticeSetDTO[] }) {
  if (sets.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
        No practice sets yet. Confirm a worksheet&apos;s problems to generate one.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {sets.map((set) => (
        <li key={set.id}>
          <Link
            href={`/practice/${set.id}`}
            className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/40"
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">Practice set</span>
              <span className="text-xs text-muted-foreground">{progressCopy(set)}</span>
            </div>
            <Badge variant={STATUS_BADGE_VARIANT[set.status]}>{STATUS_LABEL[set.status]}</Badge>
          </Link>
        </li>
      ))}
    </ul>
  );
}
