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
    // A slow response must not let ticks pile up on top of each other.
    let inFlight = false;

    const timer = setInterval(async () => {
      if (cancelled || inFlight) return;
      setElapsedMs((ms) => ms + POLL_INTERVAL_MS);

      inFlight = true;
      let result;
      try {
        result = await apiFetch<LessonDetailResponse>(`/api/lessons/${lessonId}`);
      } finally {
        inFlight = false;
      }
      if (cancelled) return;

      // Any terminal state hands over to the page, which renders the player or
      // the failure. A poll that cannot read the lesson at all stops too —
      // continuing to poll a 404 helps nobody.
      //
      // **Stopping means clearing the interval, which this did not do.** It
      // called `router.refresh()` and left the timer running, so a GET that
      // keeps failing — a 403 after consent withdrawal, a 5xx, an offline tab —
      // fired a full refresh every two seconds for as long as the tab stayed
      // open, against a route that was already failing, on a page a child is
      // sitting in front of.
      //
      // Stopping is safe even for a transient error: `router.refresh()`
      // re-renders the page, and if the lesson is still in flight this
      // component remounts and polls again. The recovery is the refresh, not
      // the timer.
      if (!result.ok || result.data.lesson.status === "READY" || result.data.lesson.status === "FAILED") {
        cancelled = true;
        clearInterval(timer);
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
