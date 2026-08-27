"use client";

/**
 * CLIENT: POST endpoint 21 → `CONFIRMED` (plan §4/§5.2, F16; M1 AC 30).
 * Needs pending/error state for the mutation, so it can't be a server
 * component.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api/client";
import type { ExtractionDTO } from "@/lib/schemas/dto";

export function ConfirmExtractionButton({ extractionId }: { extractionId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await apiFetch<{ extraction: ExtractionDTO }>(
        `/api/extractions/${extractionId}/confirm`,
        { method: "POST", body: { confirm: true } },
      );
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      // The M2 handoff point (M1 AC 30). This page is server-rendered, so a
      // refresh — not local state — is what shows the CONFIRMED state.
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="button" className="h-11 w-fit gap-2" disabled={isPending} onClick={confirm}>
        <Check className="size-4" />
        {isPending ? "Confirming…" : "This looks right"}
      </Button>
    </div>
  );
}
