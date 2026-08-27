"use client";

/**
 * CLIENT: the only interactive surface on the public consent-verification
 * page (plan §4, F10; M0 AC 19, 21; ADR-0008 §5). Both controls issue a
 * POST — never a GET, never a `<Link>` — because a mutating GET is exactly
 * the defect ADR-0008 §5 exists to prevent: a corporate mail scanner or a
 * link-preview bot following every URL in the confirmation email must not
 * be able to grant, or kill, parental consent on the parent's behalf.
 * Nothing happens until one of these two buttons is clicked; this
 * component performs no request, and no token lookup, on mount.
 *
 * Both outcomes (success or failure) navigate to the terminal `/done`
 * screen rather than rendering an error inline here — `done/page.tsx` is
 * the single place terminal copy lives (component tree: "terminal states:
 * verified / expired / already used").
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api/client";
import type { ErrorCode } from "@/lib/errors";

type Action = "verify" | "decline";

function doneStateForError(code: ErrorCode): string {
  switch (code) {
    case "NOT_FOUND":
      return "not_found";
    case "CONFLICT":
      return "conflict";
    case "RATE_LIMITED":
      return "rate_limited";
    default:
      return "error";
  }
}

export function VerifyActions({
  token,
  declineByDefault,
}: {
  token: string;
  declineByDefault: boolean;
}) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<Action | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(action: Action) {
    setPendingAction(action);
    startTransition(async () => {
      const endpoint = action === "verify" ? "/api/consent/verify" : "/api/consent/decline";
      const result = await apiFetch<{ verified: true } | { declined: true }>(endpoint, {
        method: "POST",
        body: { token },
      });
      if (!result.ok) {
        router.push(`/consent/verify/done?state=${doneStateForError(result.error.code)}`);
        return;
      }
      router.push(`/consent/verify/done?state=${action === "verify" ? "verified" : "declined"}`);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        className="h-11"
        variant={declineByDefault ? "outline" : "default"}
        disabled={isPending}
        onClick={() => submit("verify")}
      >
        {isPending && pendingAction === "verify" ? "Confirming…" : "Yes, I consent"}
      </Button>
      <Button
        className="h-11"
        variant={declineByDefault ? "destructive" : "outline"}
        disabled={isPending}
        onClick={() => submit("decline")}
      >
        {isPending && pendingAction === "decline" ? "Submitting…" : "This was not me"}
      </Button>
    </div>
  );
}
