"use client";

/**
 * The lesson entry point (plan §4, F26) — **its own named slice, per retro
 * lesson 15**.
 *
 * That lesson came from M2.5 shipping seven green slices, 616 tests and no
 * screen in the app that offered a way to start a checkpoint. The feature was
 * unreachable code. So this component is built AND wired in the same slice,
 * and "can a user actually reach this?" is part of the definition of done.
 *
 * One component serves both openers (endpoints 40 and 41) because they differ
 * only in their URL: from a confirmed extracted problem, or from a practice
 * problem the student has attempted.
 *
 * A 409 here is ordinary and explicable — "have a go at this one first" is
 * AC 5 working as intended, not an error — so it renders inline rather than as
 * an alarm.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api/client";
import type { LessonDTO } from "@/lib/schemas/dto";

export type LessonSubject =
  | { kind: "EXTRACTED_PROBLEM"; problemId: string }
  | { kind: "PRACTICE_PROBLEM"; problemId: string };

function endpointFor(subject: LessonSubject): string {
  return subject.kind === "EXTRACTED_PROBLEM"
    ? `/api/extracted-problems/${subject.problemId}/lessons`
    : `/api/practice-problems/${subject.problemId}/lessons`;
}

export function RequestLessonButton({
  subject,
  label = "Show me on the whiteboard",
  variant = "outline",
}: {
  subject: LessonSubject;
  label?: string;
  variant?: "default" | "outline" | "secondary" | "ghost";
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isRequesting, startTransition] = useTransition();

  function request() {
    setError(null);
    startTransition(async () => {
      const result = await apiFetch<{ lesson: LessonDTO }>(endpointFor(subject), { method: "POST", body: {} });
      if (!result.ok) {
        // Already an allowlisted, child-safe string (`lib/errors.ts`).
        setError(result.error.message);
        return;
      }
      // The lesson is PENDING; its page polls from there.
      router.push(`/lessons/${result.data.lesson.id}`);
    });
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button type="button" size="sm" variant={variant} onClick={request} disabled={isRequesting}>
        {isRequesting ? "Setting it up…" : label}
      </Button>
      {error ? <p className="text-xs text-muted-foreground">{error}</p> : null}
    </div>
  );
}
