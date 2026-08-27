"use client";

/**
 * CLIENT: "I have read this" → POST endpoint #7 → step 3 (plan §4, F8; M0
 * AC 12, 13, 14). Needs pending/error state around a mutation, so it can't
 * be a server component.
 *
 * **Contract note (resolved while building F9):** endpoint 7 returns 502
 * `UPSTREAM_ERROR` whenever the mail transport doesn't confirm delivery —
 * locally, with `EMAIL_TRANSPORT=console`, that is EVERY call — even though
 * `lib/notice/service.ts`'s own docstring is explicit that the
 * `DirectNotice` row is written either way, with `sentAt: null`, and a
 * dedicated cron endpoint (#28) retries dispatch later. Treating this
 * specific, documented 502 as blocking would make STEP 3 (the consent
 * screen, F9) unreachable in local development, and would give a parent a
 * hard error for a delivery-retry condition that isn't theirs to fix. This
 * component therefore advances to the consent step on a 502 from THIS
 * endpoint exactly as it would on success — every other code in the
 * contract's error column (400/401/404/409) still blocks and surfaces the
 * allowlisted message, since those mean the request itself didn't
 * succeed, not that a downstream email retry is pending.
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
      if (!result.ok && result.error.code !== "UPSTREAM_ERROR") {
        // Covers the 409 "you read stale copy" case too (plan §3, #7) — the
        // allowlisted CONFLICT message already asks the caller to refresh
        // and retry, and repeat calls to this endpoint are not an error
        // (AC 12/13/14), so simply letting the parent click again is safe.
        setError(result.error.message);
        return;
      }
      // A 502 UPSTREAM_ERROR here means only that the mail transport didn't
      // confirm delivery — the DirectNotice row was written regardless (see
      // this file's docstring), so the flow continues exactly as on
      // success. Endpoint 7 deliberately leaves the profile in
      // NOTICE_PENDING either way — it advances only when consent is
      // submitted (plan §3, #7). STEP 3 is the consent screen.
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
