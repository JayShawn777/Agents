"use client";

/**
 * AC 18 — a student marks a lesson as confusing or wrong.
 *
 * **This is the only way a lesson that teaches the wrong thing is ever caught**
 * outside the fixture set. The spec says so plainly and accepts it: there is no
 * review queue, and it depends on a child noticing. That makes the affordance's
 * job to be *easy to reach and easy to use*, not to be thorough.
 *
 * Four fixed reasons, no free text. That is a COPPA decision rather than a UI
 * one — a free-text box on a child-facing surface is a new unbounded
 * personal-data channel, with a retention row and a §312.4 notice line behind
 * it — and four buttons are also simply faster for a nine-year-old than a
 * textarea.
 *
 * The current step is sent along when one is showing (AC 18's "with the step
 * index if one was selected"), because "the bit where you circled the four" is
 * far more actionable than "somewhere in this lesson".
 */

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { RegenerateLessonButton } from "@/components/lessons/regenerate-lesson-button";
import { apiFetch } from "@/lib/api/client";
import type { LessonFlagDTO, LessonFlagReasonValue } from "@/lib/schemas/dto";

/** The child's words, not the schema's. `NOT_MY_PROBLEM` is not a sentence anyone says. */
const REASONS: { value: LessonFlagReasonValue; label: string }[] = [
  { value: "CONFUSING", label: "This is confusing" },
  { value: "TOO_FAST", label: "Too fast" },
  { value: "WRONG", label: "This looks wrong" },
  { value: "NOT_MY_PROBLEM", label: "Not my problem" },
];

export function FlagLesson({
  lessonId,
  versionId,
  stepIndex,
  atVersionCap,
}: {
  lessonId: string;
  versionId: string;
  /** The step showing when the child pressed the button, or null. */
  stepIndex: number | null;
  atVersionCap: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [flagged, setFlagged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSending, startTransition] = useTransition();

  function send(reason: LessonFlagReasonValue) {
    setError(null);
    startTransition(async () => {
      const result = await apiFetch<{ flag: LessonFlagDTO }>(`/api/lessons/${lessonId}/flags`, {
        method: "POST",
        body: { versionId, stepIndex, reason },
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setFlagged(true);
      setOpen(false);
    });
  }

  if (flagged) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-lg border border-border p-3">
        {/*
          Thanks, and then the next useful thing. AC 18 asks for a regeneration
          to be OFFERED after a flag — telling a child "thanks for letting us
          know" and leaving them with the same lesson they just said was wrong
          is the wrong place to stop.
        */}
        <p className="text-sm text-foreground">Thanks for telling us — that helps.</p>
        {atVersionCap ? (
          <p className="text-xs text-muted-foreground">
            Ask the tutor about this problem instead — it can talk it through with you.
          </p>
        ) : (
          <RegenerateLessonButton lessonId={lessonId} label="Try a different explanation" />
        )}
      </div>
    );
  }

  if (!open) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Something&apos;s not right
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <p className="text-sm text-foreground">What&apos;s wrong with it?</p>
      <div className="flex flex-wrap gap-2">
        {REASONS.map((reason) => (
          <Button
            key={reason.value}
            type="button"
            size="sm"
            variant="outline"
            disabled={isSending}
            onClick={() => send(reason.value)}
          >
            {reason.label}
          </Button>
        ))}
      </div>
      {error ? <p className="text-xs text-muted-foreground">{error}</p> : null}
      <Button type="button" size="sm" variant="ghost" className="w-fit" onClick={() => setOpen(false)}>
        Never mind
      </Button>
    </div>
  );
}
