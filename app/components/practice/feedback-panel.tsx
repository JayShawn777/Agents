"use client";

/**
 * CLIENT: renders `FeedbackDTO` (plan §4, F22; M2 AC 11, 14; ADR-0011 §3).
 * A leaf of `practice-runner.tsx`.
 *
 * Deliberately renders all three outcomes with the SAME calm, informational
 * tone rather than an error/success dichotomy: `variant="destructive"` (the
 * red used elsewhere for real failures) is never used here, because a wrong
 * answer is not a failure of the product and should not look like one to a
 * child (M2's brief: "a wrong answer should read as information, not as a
 * verdict"). `UNSCORED` gets its own distinct copy and icon and is never
 * styled or worded as wrong (AC 14) — the server-provided `message` already
 * enforces the wording; this component only chooses tone, never invents
 * copy.
 */

import { CheckCircle2, CircleHelp, Lightbulb } from "lucide-react";

import type { FeedbackDTO } from "@/lib/schemas/dto";

const RESULT_STYLE: Record<
  FeedbackDTO["result"],
  { icon: typeof CheckCircle2; container: string; title: string }
> = {
  CORRECT: {
    icon: CheckCircle2,
    container: "border-primary/40 bg-primary/10",
    title: "Correct!",
  },
  INCORRECT: {
    icon: Lightbulb,
    container: "border-border bg-muted/40",
    title: "Not quite yet",
  },
  UNSCORED: {
    icon: CircleHelp,
    container: "border-border bg-muted/40",
    title: "Not sure about that one",
  },
};

export function FeedbackPanel({ feedback }: { feedback: FeedbackDTO }) {
  const style = RESULT_STYLE[feedback.result];
  const Icon = style.icon;

  return (
    <div className={`flex flex-col gap-2 rounded-lg border p-4 ${style.container}`} role="status">
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        <h3 className="text-sm font-medium text-foreground">{style.title}</h3>
      </div>
      <p className="text-sm text-foreground">{feedback.message}</p>
      {feedback.hintHtml ? (
        <p className="text-sm text-muted-foreground" dangerouslySetInnerHTML={{ __html: feedback.hintHtml }} />
      ) : feedback.hint ? (
        <p className="text-sm text-muted-foreground">{feedback.hint}</p>
      ) : null}
    </div>
  );
}
