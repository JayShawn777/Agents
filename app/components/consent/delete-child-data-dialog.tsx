"use client";

/**
 * CLIENT: the §312.6 parental deletion request (plan §4, F12; M0 AC 48, 49).
 * POSTs endpoint 6 (`/api/students/[studentId]/data-deletion`) — a
 * DIFFERENT action from account closure (endpoint 13, `/api/account/closure`):
 * this deletes THIS student's data immediately, with no recovery window,
 * and never touches `User.closureRequestedAt` or the account at all. It is
 * rendered on the student's own privacy page, reachable without closing the
 * account (AC 49) — closing the account is never offered as the only way to
 * do this.
 *
 * Typed confirmation, per the component tree: the destructive action stays
 * disabled until the parent BOTH ticks the irreversibility acknowledgement
 * AND types a confirmation phrase — stronger friction than a single
 * checkbox, appropriate to an action with, by design, no recovery window.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api/client";

const CONFIRM_PHRASE = "DELETE";

export function DeleteChildDataDialog({
  studentId,
  studentLabel,
}: {
  studentId: string;
  studentLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const canSubmit = acknowledged && confirmText.trim().toUpperCase() === CONFIRM_PHRASE;

  function reset() {
    setAcknowledged(false);
    setConfirmText("");
    setError(null);
  }

  function handleDelete() {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      const result = await apiFetch<{ deleted: true }>(
        `/api/students/${studentId}/data-deletion`,
        {
          method: "POST",
          body: { confirm: true, acknowledgeIrreversible: true },
        },
      );
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setOpen(false);
      router.push("/dashboard");
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={<Button variant="destructive" className="h-11 gap-2" />}>
        <TriangleAlert className="size-4" />
        Delete {studentLabel}&apos;s data
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {studentLabel}&apos;s data?</DialogTitle>
          <DialogDescription>
            This immediately and permanently deletes every record we have
            about {studentLabel} — their profile, uploads, extracted problem
            text and consent record. This is irreversible, and there is no
            recovery window.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-2.5">
            <Checkbox
              id="acknowledgeIrreversible"
              checked={acknowledged}
              onCheckedChange={(checked) => setAcknowledged(checked === true)}
              disabled={isPending}
              className="mt-0.5"
            />
            <Label
              htmlFor="acknowledgeIrreversible"
              className="cursor-pointer font-normal text-muted-foreground"
            >
              I understand this is immediate and cannot be undone.
            </Label>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirmText">Type {CONFIRM_PHRASE} to confirm</Label>
            <Input
              id="confirmText"
              autoComplete="off"
              disabled={isPending}
              className="h-11"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" className="h-11" disabled={isPending} />}>
            Cancel
          </DialogClose>
          <Button
            variant="destructive"
            className="h-11"
            disabled={isPending || !canSubmit}
            onClick={handleDelete}
          >
            {isPending ? "Deleting…" : "Delete permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
