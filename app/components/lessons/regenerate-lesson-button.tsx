"use client";

/**
 * AC 19's request, and AC 18's "the student is offered a regeneration".
 *
 * Posts endpoint 43 and refreshes. The previous version stays playable
 * throughout — the server only repoints `currentVersionId` once the new run
 * succeeds — so a child who asks for a different explanation and gets a failure
 * still has the lesson they had before.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api/client";
import type { LessonDTO } from "@/lib/schemas/dto";

export function RegenerateLessonButton({
  lessonId,
  label = "Explain it a different way",
  variant = "outline",
}: {
  lessonId: string;
  label?: string;
  variant?: "default" | "outline" | "secondary" | "ghost";
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isRequesting, startTransition] = useTransition();

  function regenerate() {
    setError(null);
    startTransition(async () => {
      const result = await apiFetch<{ lesson: LessonDTO }>(`/api/lessons/${lessonId}/versions`, {
        method: "POST",
        body: {},
      });
      if (!result.ok) {
        // Already an allowlisted, child-safe string.
        setError(result.error.message);
        return;
      }
      // The page polls from PENDING, so a refresh is enough to pick the new
      // run up — there is nothing to hold open here.
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button type="button" size="sm" variant={variant} onClick={regenerate} disabled={isRequesting}>
        {isRequesting ? "Asking…" : label}
      </Button>
      {error ? <p className="text-xs text-muted-foreground">{error}</p> : null}
    </div>
  );
}
