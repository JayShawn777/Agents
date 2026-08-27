"use client";

/**
 * CLIENT: POST endpoint 29 → a `GENERATING` practice set, then navigates to
 * it (plan §4, F23; M2 AC 1, AC 3). Needs pending/error state for the
 * mutation, so it can't be a server component — the same shape as
 * `ConfirmExtractionButton`.
 *
 * Rendered only when the caller has already checked the extraction is
 * `CONFIRMED` (M2 AC 3's UI half; the server enforces the same rule with a
 * 409, so this is a courtesy, not the boundary).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api/client";
import type { PracticeSetDTO } from "@/lib/schemas/dto";

export function GeneratePracticeButton({ extractionId }: { extractionId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function generate() {
    setError(null);
    startTransition(async () => {
      const result = await apiFetch<{ set: PracticeSetDTO }>(
        `/api/extractions/${extractionId}/practice-sets`,
        { method: "POST", body: {} },
      );
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.push(`/practice/${result.data.set.id}`);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="button" className="h-11 w-fit gap-2" disabled={isPending} onClick={generate}>
        <Sparkles className="size-4" />
        {isPending ? "Getting problems ready…" : "Practice more like this"}
      </Button>
    </div>
  );
}
