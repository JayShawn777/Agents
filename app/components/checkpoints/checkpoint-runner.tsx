"use client";

/**
 * The checkpoint equivalent of `PracticeRunner` (M2.5 spec AC 11-13).
 *
 * Separate from it, not a mode of it. The two share an answer input and
 * nothing else: a checkpoint takes ONE answer per problem, offers no retry, no
 * hint and no worked solution, and — the decision worth naming — **shows no
 * verdict as you go.**
 *
 * That is deliberate. A drip of "not quite right" across eight questions is
 * demoralising in a way it is not during practice, where a wrong answer is an
 * invitation to try again. Here it is just data, and the student sees how they
 * did once, at the end. The reveal route already promises exactly this in its
 * refusal copy — "you'll see how you did at the end" — so the two surfaces tell
 * the same story.
 *
 * AC 13 is the constraint that governs everything on screen: no child-facing
 * payload may contain a value lower than one previously rendered. The only
 * counter here is "question N of M", which counts up. There is no score during
 * the run, no per-question mark, and nothing about any earlier checkpoint.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AnswerInput } from "@/components/practice/answer-input";
import { apiFetch } from "@/lib/api/client";
import { PRACTICE_ANSWER_MAX_LENGTH } from "@/lib/config";
import type {
  AttemptResponse,
  PracticeProblemDTO,
  PracticeSetDTO,
  PracticeSetSummaryDTO,
} from "@/lib/schemas/dto";

export function CheckpointRunner({
  set,
  problems,
}: {
  set: PracticeSetDTO;
  problems: PracticeProblemDTO[];
}) {
  const router = useRouter();

  // A checkpoint problem is answered once, so "already has an attempt" is the
  // whole of the resume rule — no `resumeOrdinal` arithmetic needed.
  const [currentIndex, setCurrentIndex] = useState<number>(() => {
    const index = problems.findIndex((problem) => problem.attemptCount === 0);
    return index === -1 ? problems.length : index;
  });
  const [answerValue, setAnswerValue] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmitting, startSubmitTransition] = useTransition();
  const [isFinishing, startFinishTransition] = useTransition();

  const currentProblem = problems[currentIndex];

  function submitAnswer(rawAnswer: string) {
    if (!currentProblem) return;
    const answer = rawAnswer.trim();
    if (!answer) {
      setValidationError("Write something before moving on.");
      return;
    }
    setValidationError(null);
    setActionError(null);
    startSubmitTransition(async () => {
      const result = await apiFetch<AttemptResponse>(
        `/api/practice-problems/${currentProblem.id}/attempts`,
        { method: "POST", body: { answer } },
      );
      if (!result.ok) {
        setActionError(result.error.message);
        return;
      }
      // The response carries a verdict. We deliberately do not read it —
      // see this file's header. Advance, and keep the outcome for the end.
      setAnswerValue("");
      setCurrentIndex((index) => index + 1);
    });
  }

  function finishCheckpoint() {
    setActionError(null);
    startFinishTransition(async () => {
      const result = await apiFetch<{ set: PracticeSetDTO; summary: PracticeSetSummaryDTO }>(
        `/api/practice-sets/${set.id}/complete`,
        { method: "POST", body: {} },
      );
      if (!result.ok) {
        setActionError(result.error.message);
        return;
      }
      // Server-rendered: COMPLETE swaps in CheckpointResult.
      router.refresh();
    });
  }

  if (!currentProblem) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-foreground">That&apos;s everything — nice work sticking with it.</p>
        {actionError ? (
          <Alert variant="destructive">
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        ) : null}
        <Button type="button" className="h-11 w-fit" disabled={isFinishing} onClick={finishCheckpoint}>
          {isFinishing ? "Finishing…" : "See how you did"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-muted-foreground">
          Question {currentIndex + 1} of {problems.length}
        </span>
        <span className="text-sm text-muted-foreground">
          One answer each — you&apos;ll see how you did at the end.
        </span>
      </div>

      <div
        className="rounded-lg border border-border p-4 text-base text-foreground"
        dangerouslySetInnerHTML={{ __html: currentProblem.textHtml }}
      />

      <AnswerInput
        format={currentProblem.answerFormat}
        choices={currentProblem.choices}
        value={answerValue}
        onChange={(value) => setAnswerValue(value)}
        onSelectChoice={(choice) => submitAnswer(choice)}
        disabled={isSubmitting}
        maxLength={PRACTICE_ANSWER_MAX_LENGTH}
      />

      {validationError ? (
        <Alert>
          <AlertDescription>{validationError}</AlertDescription>
        </Alert>
      ) : null}
      {actionError ? (
        <Alert variant="destructive">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}

      {currentProblem.answerFormat === "MULTIPLE_CHOICE" ? null : (
        <Button
          type="button"
          className="h-11 w-fit"
          disabled={isSubmitting}
          onClick={() => submitAnswer(answerValue)}
        >
          {isSubmitting ? "Saving…" : currentIndex === problems.length - 1 ? "Done" : "Next question"}
        </Button>
      )}
    </div>
  );
}
