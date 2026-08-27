"use client";

/**
 * CLIENT: POST `/api/students/[id]/checkpoints` → a `GENERATING` checkpoint,
 * then navigates to it. The counterpart of `GeneratePracticeButton`, and the
 * only entry point into M2.5 — without it every slice before this one is
 * unreachable code, which is retro lesson 11 in its purest form.
 *
 * Rendered only when the caller has already checked readiness (AC 4). The
 * server refuses independently with a 409, so this is a courtesy rather than
 * the boundary — the same relationship `GeneratePracticeButton` has with the
 * CONFIRMED check.
 *
 * The `available: false` case is rendered as an invitation, never as a locked
 * door: a child who has not practised enough yet is told what would make a
 * checkpoint possible, not that they are ineligible for one.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api/client";
import type { PracticeSetDTO } from "@/lib/schemas/dto";

export function StartCheckpointButton({
  studentId,
  available,
}: {
  studentId: string;
  available: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function start() {
    setError(null);
    startTransition(async () => {
      const result = await apiFetch<{ set: PracticeSetDTO }>(`/api/students/${studentId}/checkpoints`, {
        method: "POST",
        body: {},
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.push(`/practice/${result.data.set.id}`);
    });
  }

  if (!available) {
    return (
      <p className="text-sm text-muted-foreground">
        Once there&apos;s a bit more practice done, you can check what&apos;s stuck.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        className="h-11 w-fit gap-2"
        disabled={isPending}
        onClick={start}
      >
        <CircleCheck className="size-4" />
        {isPending ? "Putting a check-in together…" : "Check what's stuck"}
      </Button>
    </div>
  );
}
