"use client";

/**
 * THE one big client component in M2 (plan §4, F22; M2 AC 10-17, AC 22).
 * Owns: current ordinal, the answer draft, submit, feedback, retry, reveal,
 * and moving to the next problem. Resumes at `set.resumeOrdinal` (AC 22).
 *
 * Receives pre-rendered problem HTML as props — `problem.textHtml` and
 * `problem.workedSolutionHtml` are produced server-side (ADR-0005; the page
 * that renders this component builds them through the backend's DTO
 * builder). No KaTeX JavaScript is imported here.
 *
 * The one thing this component may never do is show the student a score, a
 * percentage, or a streak (M2 AC 20) — the only counters on screen are
 * "problem N of M", which only ever counts up. A wrong answer renders
 * through `FeedbackPanel`, which deliberately shares the SAME calm visual
 * treatment as a correct one; see that file's header comment.
 *
 * `UNSCORED` (ADR-0011 §3) is handled as its own branch, not as an error and
 * not as "wrong": the student keeps the answer box (to try phrasing it
 * differently) and is also offered an explicit "skip for now" that advances
 * without needing to guess again.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AnswerInput } from "@/components/practice/answer-input";
import { FeedbackPanel } from "@/components/practice/feedback-panel";
import { OpenChatButton } from "@/components/chat/open-chat-button";
import { RevealPanel, type RevealResult } from "@/components/practice/reveal-panel";
import { apiFetch } from "@/lib/api/client";
import { ATTEMPTS_BEFORE_REVEAL, PRACTICE_ANSWER_MAX_LENGTH } from "@/lib/config";
import type {
  AttemptResponse,
  FeedbackDTO,
  PracticeProblemDTO,
  PracticeSetDTO,
  PracticeSetSummaryDTO,
} from "@/lib/schemas/dto";

export function PracticeRunner({
  set,
  problems,
}: {
  set: PracticeSetDTO;
  problems: PracticeProblemDTO[];
}) {
  const router = useRouter();

  const [currentIndex, setCurrentIndex] = useState<number>(() => {
    if (set.resumeOrdinal == null) return problems.length; // nothing left unanswered
    const index = problems.findIndex((problem) => problem.ordinal === set.resumeOrdinal);
    return index === -1 ? 0 : index;
  });
  const [answerValue, setAnswerValue] = useState("");
  const [feedback, setFeedback] = useState<FeedbackDTO | null>(null);
  /**
   * M3 AC 1 / M2 AC 10's join point: the attempt a chat session would be bound
   * to. Held only for the CURRENT problem's latest attempt — cleared with the
   * rest of the interaction state on every move — because a session must bind
   * to the answer the student is actually looking at.
   */
  const [lastAttemptId, setLastAttemptId] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [revealByProblemId, setRevealByProblemId] = useState<Record<string, RevealResult>>({});
  const [isSubmitting, startSubmitTransition] = useTransition();
  const [isFinishing, startFinishTransition] = useTransition();

  const currentProblem = problems[currentIndex];

  function resetInteractionState() {
    setAnswerValue("");
    setFeedback(null);
    setLastAttemptId(null);
    setValidationError(null);
    setActionError(null);
  }

  function goToNext() {
    resetInteractionState();
    setCurrentIndex((index) => index + 1);
  }

  function submitAnswer(rawAnswer: string) {
    if (!currentProblem) return;
    const answer = rawAnswer.trim();
    if (!answer) {
      // AC 15: no attempt row, just a prompt.
      setValidationError("Enter an answer before submitting.");
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
      setFeedback(result.data.feedback);
      setLastAttemptId(result.data.attempt.id);
      setAnswerValue("");
    });
  }

  function handleRevealed(problemId: string, result: RevealResult) {
    setRevealByProblemId((prev) => ({ ...prev, [problemId]: result }));
  }

  function finishSet() {
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
      // The page is server-rendered; COMPLETE swaps in SetSummary.
      router.refresh();
    });
  }

  if (!currentProblem) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-foreground">You&apos;ve answered every problem in this set.</p>
        {actionError ? (
          <Alert variant="destructive">
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        ) : null}
        <Button type="button" className="h-11 w-fit" disabled={isFinishing} onClick={finishSet}>
          {isFinishing ? "Finishing…" : "Finish this set"}
        </Button>
      </div>
    );
  }

  const revealResult = revealByProblemId[currentProblem.id];
  const revealed = currentProblem.revealed || Boolean(revealResult);
  const attemptsRemainingBeforeReveal =
    feedback?.attemptsRemainingBeforeReveal ??
    Math.max(0, ATTEMPTS_BEFORE_REVEAL - currentProblem.attemptCount);
  const revealAvailable = feedback?.revealAvailable ?? attemptsRemainingBeforeReveal <= 0;
  const isLastProblem = currentIndex === problems.length - 1;

  return (
    <div className="flex flex-col gap-6">
      <span className="text-sm font-medium text-muted-foreground">
        Problem {currentIndex + 1} of {problems.length}
      </span>

      <div
        className="rounded-lg border border-border p-4 text-base text-foreground"
        dangerouslySetInnerHTML={{ __html: currentProblem.textHtml }}
      />

      {revealed ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-4">
            <h3 className="text-sm font-medium text-foreground">Here&apos;s how it&apos;s done</h3>
            {revealResult ? (
              <p className="text-sm font-medium text-foreground">Answer: {revealResult.canonicalAnswer}</p>
            ) : null}
            <div
              className="text-sm text-foreground"
              dangerouslySetInnerHTML={{
                __html: revealResult?.workedSolutionHtml ?? currentProblem.workedSolutionHtml ?? "",
              }}
            />
          </div>
          {actionError ? (
            <Alert variant="destructive">
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          ) : null}
          <Button type="button" className="h-11 w-fit" onClick={isLastProblem ? finishSet : goToNext} disabled={isFinishing}>
            {isLastProblem ? (isFinishing ? "Finishing…" : "Finish this set") : "Next problem"}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {feedback ? <FeedbackPanel feedback={feedback} /> : null}

          {/*
            M3 AC 1, and the user story this milestone exists for: "I want to
            ask why my answer was wrong, so that I understand the mistake
            instead of just seeing a red cross." Offered only when there is
            something to ask ABOUT — a wrong or unscored answer — because
            after a correct one the useful next action is the next problem.
          */}
          {lastAttemptId && feedback && feedback.result !== "CORRECT" ? (
            <OpenChatButton
              subject={{ kind: "ATTEMPT", attemptId: lastAttemptId }}
              label="Ask the tutor why"
            />
          ) : null}

          {validationError ? <p className="text-sm text-muted-foreground">{validationError}</p> : null}
          {actionError ? (
            <Alert variant="destructive">
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          ) : null}

          {feedback?.result === "CORRECT" ? (
            <Button type="button" className="h-11 w-fit" onClick={isLastProblem ? finishSet : goToNext} disabled={isFinishing}>
              {isLastProblem ? (isFinishing ? "Finishing…" : "Finish this set") : "Next problem"}
            </Button>
          ) : (
            <>
              <AnswerInput
                format={currentProblem.answerFormat}
                choices={currentProblem.choices}
                value={answerValue}
                onChange={setAnswerValue}
                onSelectChoice={(choice) => submitAnswer(choice)}
                disabled={isSubmitting}
                maxLength={PRACTICE_ANSWER_MAX_LENGTH}
              />

              <div className="flex flex-wrap items-center gap-3">
                {currentProblem.answerFormat !== "MULTIPLE_CHOICE" ? (
                  <Button
                    type="button"
                    className="h-11 w-fit"
                    disabled={isSubmitting}
                    onClick={() => submitAnswer(answerValue)}
                  >
                    {isSubmitting ? "Checking…" : feedback ? "Try again" : "Submit"}
                  </Button>
                ) : null}

                {feedback?.result === "UNSCORED" ? (
                  <Button type="button" variant="ghost" className="h-11 w-fit" onClick={goToNext}>
                    Skip for now
                  </Button>
                ) : null}
              </div>

              {revealAvailable ? (
                <RevealPanel
                  problemId={currentProblem.id}
                  onRevealed={(result) => handleRevealed(currentProblem.id, result)}
                />
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}
