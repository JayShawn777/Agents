"use client";

/**
 * CLIENT: "I have read this" → POST endpoint #7 → step 3 (plan §4, F8; M0
 * AC 12, 13, 14). Needs pending/error state around a mutation, so it can't
 * be a server component.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api/client";
import type { DirectNoticeDTO } from "@/lib/schemas/dto";

export function NoticeAcknowledge({
  studentId,
  noticeVersion,
}: {
  studentId: string;
  noticeVersion: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleAcknowledge() {
    setError(null);
    startTransition(async () => {
      const result = await apiFetch<{ notice: DirectNoticeDTO }>(
        `/api/students/${studentId}/notice`,
        { method: "POST", body: { noticeVersion, acknowledged: true } },
      );
      if (!result.ok) {
        // Covers the 409 "you read stale copy" case too (plan §3, #7) — the
        // allowlisted CONFLICT message already asks the caller to refresh
        // and retry, and repeat calls to this endpoint are not an error
        // (AC 12/13/14), so simply letting the parent click again is safe.
        setError(result.error.message);
        return;
      }
      // Endpoint 7 deliberately leaves the profile in NOTICE_PENDING — it
      // advances only when consent is submitted (plan §3, #7). STEP 3 is
      // the consent screen.
      router.push(`/students/${studentId}/consent`);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button className="h-11" disabled={isPending} onClick={handleAcknowledge}>
        {isPending ? "Continuing…" : "I have read this notice"}
      </Button>
    </div>
  );
}
