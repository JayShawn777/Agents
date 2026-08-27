"use client";

/**
 * CLIENT: POST endpoint 31 → a fresh `GENERATING` set (plan §4, F21; M2
 * AC 5, AC 6). A leaf of `failed-set.tsx`, split out the same way
 * `ConfirmExtractionButton` is split from the M1 upload page: it needs
 * pending/error state for the mutation, so it can't be a server component.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api/client";
import type { PracticeSetDTO } from "@/lib/schemas/dto";

export function RetryPracticeSetButton({ practiceSetId }: { practiceSetId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function retry() {
    setError(null);
    startTransition(async () => {
      const result = await apiFetch<{ set: PracticeSetDTO }>(
        `/api/practice-sets/${practiceSetId}/retry`,
        { method: "POST", body: {} },
      );
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      // The page is server-rendered; a refresh is what swaps in the
      // GENERATING state now that the retry has been accepted.
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
      <Button type="button" variant="outline" className="h-11 w-fit gap-2" disabled={isPending} onClick={retry}>
        <RefreshCw className="size-4" />
        {isPending ? "Retrying…" : "Try again"}
      </Button>
    </div>
  );
}
