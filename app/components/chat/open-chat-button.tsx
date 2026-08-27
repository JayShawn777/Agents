"use client";

/**
 * The chat entry point (plan §4, F26) — **kept as its own named slice**, per
 * the M2.5 retro's finding that an entry point buried inside a bigger slice is
 * the thing that silently never gets built.
 *
 * One component serves both openers (endpoints 35 and 36) because they return
 * the same shape and differ only in their URL: from a confirmed extracted
 * problem, or from a graded attempt the student got wrong — M2 AC 10's join
 * point, and the user story this whole milestone exists for ("I want to ask why
 * my answer was wrong, so that I understand the mistake instead of just seeing
 * a red cross").
 *
 * On success it pushes to the session. On failure it renders the allowlisted
 * message inline — a 409 here is ordinary and explicable ("check this worksheet
 * over first", "add a grade level"), not an error state worth a dialog.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api/client";
import type { ChatSessionDetailResponse } from "@/lib/schemas/dto";

export type ChatSubject =
  | { kind: "EXTRACTED_PROBLEM"; problemId: string }
  | { kind: "ATTEMPT"; attemptId: string };

function endpointFor(subject: ChatSubject): string {
  return subject.kind === "EXTRACTED_PROBLEM"
    ? `/api/extracted-problems/${subject.problemId}/chat-sessions`
    : `/api/attempts/${subject.attemptId}/chat-sessions`;
}

export function OpenChatButton({
  subject,
  label = "Ask the tutor",
  variant = "outline",
}: {
  subject: ChatSubject;
  label?: string;
  variant?: "default" | "outline" | "secondary" | "ghost";
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isOpening, startTransition] = useTransition();

  function open() {
    setError(null);
    startTransition(async () => {
      const result = await apiFetch<ChatSessionDetailResponse>(endpointFor(subject), {
        method: "POST",
        body: {},
      });

      if (!result.ok) {
        // Already an allowlisted, child-safe string (`lib/errors.ts`).
        setError(result.error.message);
        return;
      }

      router.push(`/chat/${result.data.session.id}`);
    });
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button type="button" size="sm" variant={variant} onClick={open} disabled={isOpening}>
        {isOpening ? "Opening…" : label}
      </Button>
      {error ? <p className="text-xs text-muted-foreground">{error}</p> : null}
    </div>
  );
}
