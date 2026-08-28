"use client";

/**
 * AC 6's waiting state: polls endpoint 42 while a lesson is `PENDING` or
 * `AUTHORING`, and refreshes the page once it reaches a terminal state.
 *
 * **The wait is real and the copy says so.** Authoring was measured at 12-59
 * seconds (p50 35s), which is far too long to pretend is instant — a spinner
 * with no explanation reads as "broken" well before 35 seconds have passed.
 *
 * The poll doubles as the reaper's trigger: endpoint 42 lazily fails an
 * `AUTHORING` row whose function was killed, so a lesson can never leave a
 * child polling forever even if the background work vanished.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { apiFetch } from "@/lib/api/client";
import type { LessonDetailResponse } from "@/lib/schemas/dto";

/** Frequent enough to feel responsive, sparse enough not to hammer a 35-second wait. */
const POLL_INTERVAL_MS = 2_000;

export function AuthoringState({ lessonId }: { lessonId: string }) {
  const router = useRouter();
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const timer = setInterval(async () => {
      if (cancelled) return;
      setElapsedMs((ms) => ms + POLL_INTERVAL_MS);

      const result = await apiFetch<LessonDetailResponse>(`/api/lessons/${lessonId}`);
      if (cancelled) return;
      // Any terminal state hands over to the page, which renders the player or
      // the failure. A poll that cannot read the lesson at all stops too —
      // continuing to poll a 404 helps nobody.
      if (!result.ok || result.data.lesson.status === "READY" || result.data.lesson.status === "FAILED") {
        router.refresh();
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [lessonId, router]);

  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-border p-6" role="status" aria-live="polite">
      <p className="text-sm font-medium text-foreground">Drawing your lesson…</p>
      <p className="text-sm text-muted-foreground">
        {elapsedMs < 20_000
          ? "This takes about half a minute — it's working out how to show you, step by step."
          : "Still going. Complicated problems take a little longer to draw."}
      </p>
    </div>
  );
}
