"use client";

/**
 * CLIENT: polls `GET /api/practice-sets/[practiceSetId]` (endpoint 30) every
 * two seconds until the status leaves `GENERATING` (plan §4, F21; M2 AC 1,
 * AC 6). Owns only the `GENERATING` UI, the same convention as M1's
 * `ExtractionStatus`: reaching a terminal status triggers exactly one
 * `router.refresh()`, and the server-rendered `PracticeRunner` / `SetSummary`
 * / `FailedSet` on the parent page own the actual result — this component
 * never renders problem content itself.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { apiFetch } from "@/lib/api/client";
import type { PracticeSetDetailResponse, PracticeSetDTO } from "@/lib/schemas/dto";

const POLL_INTERVAL_MS = 2000;

export function GeneratingState({ practiceSetId }: { practiceSetId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<PracticeSetDTO["status"]>("GENERATING");
  const hasRefreshedRef = useRef(false);

  useEffect(() => {
    if (status !== "GENERATING") return;

    let cancelled = false;
    const interval = setInterval(() => {
      void (async () => {
        const result = await apiFetch<PracticeSetDetailResponse>(`/api/practice-sets/${practiceSetId}`);
        if (cancelled || !result.ok) return;
        setStatus(result.data.set.status);
        if (result.data.set.status !== "GENERATING" && !hasRefreshedRef.current) {
          hasRefreshedRef.current = true;
          router.refresh();
        }
      })();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [status, practiceSetId, router]);

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      Putting together your practice problems… this can take a minute.
    </div>
  );
}
