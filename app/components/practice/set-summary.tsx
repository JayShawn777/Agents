import Link from "next/link";

import { Button } from "@/components/ui/button";
import type { PracticeSetDTO, PracticeSetSummaryDTO } from "@/lib/schemas/dto";

/**
 * AC 21: a summary naming the skills practised and how many problems were
 * answered, framed as progress rather than a mark (plan §4, F23). Server
 * component — purely presentational. `summary` is built by the SAME
 * `toPracticeSetSummaryDTO` endpoint 34 uses (`lib/practice/dto.ts`, backend
 * track), so a parent revisiting a completed set later sees the identical
 * skills/counts/message the student saw the moment they finished — one
 * source of truth for this shape, not a page-local recomputation of it.
 * Deliberately renders no score, no percentage and no per-problem
 * correct/incorrect tally — only skill names and plain counts, both
 * monotonic by construction (M2 AC 20).
 */
export function SetSummary({
  set,
  summary,
  studentId,
}: {
  set: PracticeSetDTO;
  summary: PracticeSetSummaryDTO;
  studentId: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Practice set complete</h1>
        <p className="text-sm text-foreground">{summary.message}</p>
        <p className="text-sm text-muted-foreground">
          You worked through {summary.totalAnswered} problem{summary.totalAnswered === 1 ? "" : "s"}{" "}
          across {summary.skills.length} skill{summary.skills.length === 1 ? "" : "s"}.
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {summary.skills.map((skill) => (
          <li key={skill.skillCode} className="rounded-lg border border-border p-3 text-sm text-foreground">
            {skill.skillDescriptor}{" "}
            <span className="text-muted-foreground">
              — {skill.problemsAnswered} problem{skill.problemsAnswered === 1 ? "" : "s"}
            </span>
          </li>
        ))}
      </ul>

      <Button className="h-11 w-fit" render={<Link href={`/students/${studentId}`} />}>
        Done
      </Button>
      <p className="sr-only">Practice set {set.id} complete.</p>
    </div>
  );
}
