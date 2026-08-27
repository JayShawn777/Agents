import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FailedSet } from "@/components/practice/failed-set";
import { GeneratingState } from "@/components/practice/generating-state";
import { PracticeRunner } from "@/components/practice/practice-runner";
import { SetSummary } from "@/components/practice/set-summary";
import { CheckpointResult } from "@/components/checkpoints/checkpoint-result";
import { CheckpointRunner } from "@/components/checkpoints/checkpoint-runner";
import { requirePracticeSet } from "@/lib/auth/dal";
import { toPracticeProblemDTO, toPracticeSetDTO, toPracticeSetSummaryDTO } from "@/lib/practice/dto";
import type { PracticeProblemDTO } from "@/lib/schemas/dto";

/**
 * The practice session screen (plan §4, F21/F22; M2 AC 1, 6, 9, 10-17, 21,
 * 22). Server component: loads the set and its problems through the DAL
 * (`requirePracticeSet`, backend track) and hands the DTO-shaped result to
 * whichever child owns that status — the same "no route handler exists to
 * serve data a server component already has" convention as the M1 upload
 * page (ADR-0006), and the SAME `toPracticeSetDTO`/`toPracticeProblemDTO`/
 * `toPracticeSetSummaryDTO` mapping functions endpoint 30/34's route
 * handlers use, so this page's shapes can never drift from the API's.
 *
 * Server-renders each problem's LaTeX to `textHtml` (via the DTO builder,
 * ADR-0005) and passes the array down to the client runner — no KaTeX
 * JavaScript ships for this surface. NEVER selects the answer key itself;
 * `PracticeAnswerKey` access is entirely inside the DTO builder, which nulls
 * `workedSolution`/`workedSolutionHtml` unless the problem is already
 * `revealed` (M2 AC 12, AC 17).
 */

export const metadata: Metadata = {
  title: "Practice",
};

export default async function PracticeSetPage({
  params,
}: PageProps<"/practice/[practiceSetId]">) {
  const { practiceSetId } = await params;

  const setRow = await requirePracticeSet(practiceSetId);
  if (!setRow) notFound();

  if (setRow.status === "GENERATING") {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
        <GeneratingState practiceSetId={practiceSetId} />
      </div>
    );
  }

  const set = toPracticeSetDTO(setRow);

  if (set.status === "FAILED") {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
        <FailedSet practiceSetId={set.id} failureMessage={set.failureMessage} />
      </div>
    );
  }

  if (set.status === "COMPLETE") {
    const summary = toPracticeSetSummaryDTO(setRow.problems);
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
        {set.kind === "CHECKPOINT" ? (
          // ADR-0017: one page serves both kinds, because a checkpoint IS a
          // PracticeSet. Only the surface differs — `CheckpointResult` is given
          // this one summary and nothing else, so an earlier checkpoint is not
          // reachable from it and AC 13 cannot be broken by a later edit.
          <CheckpointResult summary={summary} />
        ) : (
          <SetSummary set={set} summary={summary} studentId={setRow.studentProfileId} />
        )}
      </div>
    );
  }

  const problems: PracticeProblemDTO[] = [...setRow.problems]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((problem) => toPracticeProblemDTO(problem));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      {set.kind === "CHECKPOINT" ? (
        <CheckpointRunner set={set} problems={problems} />
      ) : (
        <PracticeRunner set={set} problems={problems} />
      )}
    </div>
  );
}
