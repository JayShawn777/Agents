"use client";

/**
 * M5 slice 9. Owns the narration lifecycle for one lesson version: polls
 * `GET /api/lessons/[lessonId]/narration` (#47) while a run is
 * `PENDING`/`GENERATING`, auto-requests a first run via `POST` (#46) for a
 * lesson that has never been narrated, and offers a retry when a run is
 * `FAILED` (AC 17 — the same endpoint re-claims a `FAILED` row rather than
 * a third route).
 *
 * "use client": it owns a poll interval — the one thing a server component
 * structurally cannot do.
 *
 * **The poll interval MUST stop, on every terminal path.** M4's authoring
 * poller (`authoring-state.tsx`) shipped a version that called
 * `router.refresh()` on error and never cleared its timer, producing a
 * refresh storm every 2s against an already-failing route. This file follows
 * that fix's shape exactly: `cancelled`/`inFlight` guards against overlap,
 * and `clearInterval` runs on `READY`, on `FAILED`, AND on a network/parse
 * failure — not only on success.
 *
 * **It passes `onNarrationStale`, and that is load-bearing** (2026-09-02 review).
 * `LessonPlayer` schedules the signed-URL refresh a minute before the earliest
 * URL expires, but its effect returns early when the prop is absent — and this
 * file, the only production caller of `LessonView`, did not pass it. Deleting
 * the entire refresh effect left every in-scope test green, because no test
 * passed the prop either. The visible symptom was audio for any lesson longer
 * than `SIGNED_URL_TTL_MS` (5 minutes) going dead with nothing reported.
 *
 * **The poller restarts on retry.** `retry()` used to POST and set state while
 * the FAILED branch had already cleared the interval, so the new run was never
 * polled and never resolved without a full page reload. The effect keys on
 * `pollNonce`; retry bumps it.
 */

import { useCallback, useEffect, useState } from "react";

import { LessonView } from "@/components/lessons/lesson-view";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api/client";
import type { Cue } from "@/lib/lessons/cues";
import type { LessonNarrationDTO, LessonNarrationResponse, RenderableLessonScript } from "@/lib/schemas/dto";

const POLL_INTERVAL_MS = 2_000;

export function NarrationState({
  lessonId,
  versionId,
  studentId,
  script,
  timeline,
  atVersionCap,
  initialCaptionsEnabled,
}: {
  lessonId: string;
  versionId: string;
  studentId: string;
  script: RenderableLessonScript;
  timeline: Cue[];
  atVersionCap: boolean;
  initialCaptionsEnabled: boolean;
}) {
  const [narration, setNarration] = useState<LessonNarrationDTO | null>(null);
  const [checked, setChecked] = useState(false); // whether the first GET has resolved at all
  const [retryError, setRetryError] = useState<string | null>(null);
  /** Bumped to restart the poll effect — see the docstring's retry note. */
  const [pollNonce, setPollNonce] = useState(0);

  /**
   * One-shot re-read, handed to the player as `onNarrationStale`. A GET mints
   * fresh signed URLs (endpoint 47 signs only when READY), so re-reading IS the
   * refresh — there is no separate renew endpoint. `useCallback` keeps the
   * identity stable, because the player's refresh effect lists it as a
   * dependency and would otherwise re-schedule on every render.
   */
  const refreshNarration = useCallback(async () => {
    const result = await apiFetch<LessonNarrationResponse>(`/api/lessons/${lessonId}/narration`);
    if (result.ok) setNarration(result.data.narration);
  }, [lessonId]);

  const handleNarrationStale = useCallback(() => {
    void refreshNarration();
  }, [refreshNarration]);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let requestedOnce = false; // guards the auto-POST to at most one attempt per mount
    let timer: ReturnType<typeof setInterval> | null = null;

    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }

    async function requestNarration() {
      const result = await apiFetch<{ narration: LessonNarrationDTO }>(
        `/api/lessons/${lessonId}/narration`,
        { method: "POST", body: {} },
      );
      if (!cancelled && result.ok) setNarration(result.data.narration);
    }

    async function poll() {
      if (cancelled || inFlight) return;
      inFlight = true;
      const result = await apiFetch<LessonNarrationResponse>(`/api/lessons/${lessonId}/narration`);
      inFlight = false;
      if (cancelled) return;

      setChecked(true);

      if (!result.ok) {
        // A network failure, a 404 (route not built yet, or genuinely none),
        // or anything else unparseable — stop polling rather than hammering a
        // route that is already failing (the M4 poller's own fix).
        stop();
        return;
      }

      const data = result.data.narration;
      setNarration(data);

      if (data === null) {
        // AC 6's other half: a READY lesson with no narration run gets one
        // requested automatically, once, rather than waiting for a child to
        // find a button for it.
        if (!requestedOnce) {
          requestedOnce = true;
          void requestNarration();
        }
        return;
      }

      if (data.status === "READY" || data.status === "FAILED") stop();
    }

    void poll();
    timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [lessonId, pollNonce]);

  function retry() {
    setRetryError(null);
    void (async () => {
      const result = await apiFetch<{ narration: LessonNarrationDTO }>(
        `/api/lessons/${lessonId}/narration`,
        { method: "POST", body: {} },
      );
      if (!result.ok) {
        setRetryError(result.error.message);
        return;
      }
      setNarration(result.data.narration);
      // Restart the interval the FAILED branch stopped. Without this the retried
      // run sits at PENDING on screen until the child reloads the page.
      setPollNonce((nonce) => nonce + 1);
    })();
  }

  const narrationSteps = narration?.status === "READY" ? narration.steps : null;

  return (
    <div className="flex flex-col gap-3">
      {checked && narration?.status === "FAILED" ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          <p>
            {narration.failureMessage ?? "The read-aloud voice isn't available right now."} The lesson still
            plays, with captions.
          </p>
          <Button type="button" size="sm" variant="outline" onClick={retry}>
            Try narration again
          </Button>
        </div>
      ) : null}
      {retryError ? <p className="text-xs text-muted-foreground">{retryError}</p> : null}

      <LessonView
        lessonId={lessonId}
        versionId={versionId}
        studentId={studentId}
        script={script}
        timeline={timeline}
        atVersionCap={atVersionCap}
        narrationSteps={narrationSteps}
        onNarrationStale={handleNarrationStale}
        initialCaptionsEnabled={initialCaptionsEnabled}
      />
    </div>
  );
}
