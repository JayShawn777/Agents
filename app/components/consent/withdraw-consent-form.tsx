"use client";

/**
 * CLIENT: confirm + POST endpoint #12 (plan §4, F12; M0 AC 24). Withdrawal
 * stops any FURTHER collection about this student and appends a new
 * `ParentalConsent` row with `withdrawnAt` set — it does not, by itself,
 * delete data already collected (that is a distinct action,
 * `DeleteChildDataDialog`, endpoint 6). Keeping the two separate here
 * mirrors the backend's own separation (`lib/consent/service.ts`'s
 * `withdrawConsent` never calls `deleteStudentData`) and this milestone's
 * brief: the two destructive actions on this student's privacy page must
 * not be blurred into one.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api/client";
import type { StudentProfileDTO } from "@/lib/schemas/dto";

export function WithdrawConsentForm({ studentId }: { studentId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleWithdraw() {
    setError(null);
    startTransition(async () => {
      const result = await apiFetch<{ student: StudentProfileDTO }>(
        `/api/students/${studentId}/consent/withdraw`,
        { method: "POST", body: { confirm: true } },
      );
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.push(`/students/${studentId}/privacy`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button
        variant="destructive"
        className="h-11"
        disabled={isPending}
        onClick={handleWithdraw}
      >
        {isPending ? "Withdrawing…" : "Withdraw consent"}
      </Button>
    </div>
  );
}
