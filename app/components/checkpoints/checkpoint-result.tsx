/**
 * What a student sees when a checkpoint finishes (M2.5 spec AC 12, AC 13).
 *
 * Server component — nothing here is interactive.
 *
 * **AC 13 is the whole design.** No child-facing payload may carry a value
 * lower than one previously rendered, and this is the surface where that is
 * most tempting to break. So, explicitly:
 *
 *   - "6 of 8" for THIS checkpoint is allowed. It is a point-in-time outcome,
 *     which the spec's non-goals call out as fine.
 *   - Nothing compares it to an earlier checkpoint. No previous score, no
 *     delta, no arrow, no "down from", no trend line, no percentage. A second
 *     checkpoint that went worse must not be renderable as a fall — which is
 *     why this component is given ONE summary and has no access to any other.
 *   - Skills are named with their descriptors and a count of what was asked,
 *     never with a per-skill mark. "Which skills came up" is the useful part
 *     for a child; "you got fractions wrong" is not.
 *
 * The mastery levels a student may see elsewhere still only move up
 * (ADR-0010, ADR-0018) — a missed checkpoint resets a streak server-side and
 * lowers nothing on screen.
 */

import { Badge } from "@/components/ui/badge";
import type { PracticeSetSummaryDTO } from "@/lib/schemas/dto";

/**
 * Deliberately not a percentage and deliberately not graded. The message is
 * chosen from a fixed allowlist by how much was answered, never by how much
 * was right — a child who found it hard is told the same thing as one who did
 * not, because the point of a checkpoint is that it happened.
 */
function framing(totalAnswered: number): string {
  if (totalAnswered === 0) return "No answers this time — that's alright, it'll keep.";
  return "Thanks for checking in. Here's what came up.";
}

export function CheckpointResult({ summary }: { summary: PracticeSetSummaryDTO }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-medium text-foreground">How that went</h2>
        <p className="text-sm text-muted-foreground">{framing(summary.totalAnswered)}</p>
      </div>

      <div className="rounded-lg border border-border p-4">
        <p className="text-base text-foreground">
          You got <span className="font-medium">{summary.totalCorrect}</span> of{" "}
          <span className="font-medium">{summary.totalAnswered}</span> right.
        </p>
      </div>

      {summary.skills.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-foreground">Skills this checked</h3>
          <ul className="flex flex-col gap-2">
            {summary.skills.map((skill) => (
              <li
                key={skill.skillCode}
                className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3"
              >
                <span className="text-sm text-foreground">{skill.skillDescriptor}</span>
                <Badge variant="secondary">
                  {skill.problemsAnswered} question{skill.problemsAnswered === 1 ? "" : "s"}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
