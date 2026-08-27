"use client";

/**
 * CLIENT: polls `GET /api/extractions/[extractionId]` (endpoint 19) every
 * two seconds until the status is terminal (plan §4/§5.2, F16; M1 AC 18,
 * 27). Owns the `PENDING`/`RUNNING`/`FAILED` UI; `COMPLETE`,
 * `COMPLETE_EMPTY` and `CONFIRMED` render nothing here — the server-rendered
 * `ProblemList`/`EmptyExtraction`/`ConfirmExtractionButton` on the parent
 * page own those, which is why reaching a terminal state triggers exactly
 * one `router.refresh()` rather than this component rendering the results
 * itself.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api/client";
import type { ExtractedProblemDTO, ExtractionDTO } from "@/lib/schemas/dto";

const POLL_INTERVAL_MS = 2000;

const TERMINAL_STATUSES: ReadonlySet<ExtractionDTO["status"]> = new Set([
  "COMPLETE",
  "COMPLETE_EMPTY",
  "FAILED",
  "CONFIRMED",
]);

type PollResponse = { extraction: ExtractionDTO; problems: ExtractedProblemDTO[] };

export function ExtractionStatus({
  extractionId,
  initialStatus,
  initialFailureMessage,
}: {
  extractionId: string;
  initialStatus: ExtractionDTO["status"];
  initialFailureMessage: string | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<ExtractionDTO["status"]>(initialStatus);
  const [failureMessage, setFailureMessage] = useState(initialFailureMessage);
  const [isRetrying, setIsRetrying] = useState(false);
  // Guards against firing router.refresh() more than once for the same
  // terminal transition if a poll response arrives just as another does.
  const hasRefreshedRef = useRef(false);

  useEffect(() => {
    if (TERMINAL_STATUSES.has(status)) return;

    let cancelled = false;
    const interval = setInterval(() => {
      void (async () => {
        const result = await apiFetch<PollResponse>(`/api/extractions/${extractionId}`);
        if (cancelled || !result.ok) return;
        setStatus(result.data.extraction.status);
        setFailureMessage(result.data.extraction.failureMessage);
        if (TERMINAL_STATUSES.has(result.data.extraction.status) && !hasRefreshedRef.current) {
          hasRefreshedRef.current = true;
          router.refresh();
        }
      })();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [status, extractionId, router]);

  function retry() {
    setIsRetrying(true);
    void (async () => {
      const result = await apiFetch<{ extraction: ExtractionDTO }>(
        `/api/extractions/${extractionId}/retry`,
        { method: "POST", body: {} },
      );
      setIsRetrying(false);
      if (result.ok) {
        hasRefreshedRef.current = false;
        setFailureMessage(null);
        setStatus(result.data.extraction.status);
      }
    })();
  }

  if (status === "PENDING" || status === "RUNNING") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Reading your worksheet… this can take a minute.
      </div>
    );
  }

  if (status === "FAILED") {
    return (
      <Alert variant="destructive">
        <AlertTitle>We couldn&apos;t read this worksheet</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <p>{failureMessage ?? "Something went wrong. Please try again."}</p>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-fit gap-2"
            disabled={isRetrying}
            onClick={retry}
          >
            <RefreshCw className="size-4" />
            {isRetrying ? "Retrying…" : "Try again"}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return null;
}
