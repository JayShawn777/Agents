"use client";

/**
 * CLIENT: POST endpoint 33, gated on `revealAvailable` (plan §4, F22; M2
 * AC 12; ADR-0011 §5). A leaf of `practice-runner.tsx`.
 *
 * Only ever rendered by the parent while the current problem is NOT yet
 * revealed, and it renders nothing but the request itself — the worked
 * solution it fetches is handed back to the parent via `onRevealed` and
 * displayed by the parent, never held here. This keeps the answer key out of
 * this component's own state for longer than the single response that
 * unlocks it (M2 AC 17's "never in a client component's props before the
 * reveal" carried through to "never lingers in a component that doesn't
 * need it").
 */

import { useState, useTransition } from "react";
import { LifeBuoy } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api/client";

export type RevealResult = {
  workedSolution: string;
  workedSolutionHtml: string;
  canonicalAnswer: string;
};

export function RevealPanel({
  problemId,
  onRevealed,
}: {
  problemId: string;
  onRevealed: (result: RevealResult) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function reveal() {
    setError(null);
    startTransition(async () => {
      const result = await apiFetch<RevealResult>(`/api/practice-problems/${problemId}/reveal`, {
        method: "POST",
        body: {},
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      onRevealed(result.data);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="button" variant="outline" className="h-11 w-fit gap-2" disabled={isPending} onClick={reveal}>
        <LifeBuoy className="size-4" />
        {isPending ? "Getting the answer…" : "Show me how it's done"}
      </Button>
    </div>
  );
}
