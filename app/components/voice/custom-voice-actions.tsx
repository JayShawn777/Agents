"use client";

/**
 * M6 AC 18/19 — revoke or delete a custom voice from the account's Settings.
 *
 * Two actions, deliberately different and deliberately both offered:
 *
 * - **Stop using this voice** (endpoint 53, revoke) withdraws permission. The
 *   clone is removed at the vendor, no child can select it, and lessons already
 *   narrated in it keep playing.
 * - **Delete this voice** (endpoint 52) removes everything, including that
 *   already-narrated audio — so a lesson replayed afterwards is re-narrated in
 *   a standard voice. The confirmation says so (spec open question: it may be
 *   startling for a child, and the parent should be the one to know).
 *
 * Every message is our own wording (AC 14): a failure shows the API envelope's
 * message or the generic line below, never a vendor string.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api/client";

const GENERIC = "Something went wrong. Please try again.";

type Props = {
  personaId: string;
  label: string;
  /** A revoked voice can only be deleted — there is nothing left to stop. */
  canRevoke: boolean;
};

export function CustomVoiceActions({ personaId, label, canRevoke }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [openKind, setOpenKind] = useState<"revoke" | "delete" | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(kind: "revoke" | "delete") {
    setError(null);
    startTransition(async () => {
      const response =
        kind === "revoke"
          ? await apiFetch(`/api/voice/${personaId}/revoke`, { method: "POST", body: {} })
          : await apiFetch(`/api/voice/${personaId}`, { method: "DELETE" });
      if (!response.ok) {
        setError(response.error.message ?? GENERIC);
        return;
      }
      setOpenKind(null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {error && openKind === null ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {canRevoke ? (
          <Dialog open={openKind === "revoke"} onOpenChange={(next) => setOpenKind(next ? "revoke" : null)}>
            <DialogTrigger render={<Button variant="outline" className="h-11" />}>
              Stop using this voice
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Stop using {label}?</DialogTitle>
                <DialogDescription>
                  This withdraws your permission. The voice is removed from our voice provider and your children
                  can no longer choose it. Lessons that were already narrated in this voice keep playing; you can
                  delete those too from here afterwards.
                </DialogDescription>
              </DialogHeader>
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              <DialogFooter>
                <DialogClose render={<Button variant="outline" className="h-11" disabled={isPending} />}>
                  Keep it
                </DialogClose>
                <Button className="h-11" disabled={isPending} onClick={() => run("revoke")}>
                  {isPending ? "Working…" : "Stop using this voice"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}

        <Dialog open={openKind === "delete"} onOpenChange={(next) => setOpenKind(next ? "delete" : null)}>
          <DialogTrigger render={<Button variant="destructive" className="h-11" />}>Delete this voice</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {label}?</DialogTitle>
              <DialogDescription>
                This permanently deletes the voice from our voice provider and removes every lesson narration
                made with it. A lesson your child replays afterwards is narrated again in a standard voice,
                which may sound different to them. The recorded permission statement is kept for our audit
                trail, as described on the retention page.
              </DialogDescription>
            </DialogHeader>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" className="h-11" disabled={isPending} />}>
                Cancel
              </DialogClose>
              <Button variant="destructive" className="h-11" disabled={isPending} onClick={() => run("delete")}>
                {isPending ? "Deleting…" : "Delete this voice"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
