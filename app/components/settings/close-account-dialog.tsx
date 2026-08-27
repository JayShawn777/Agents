"use client";

/**
 * CLIENT: confirm dialog + a pending mutation + a post-success receipt
 * state, none of which a server component can hold (plan §4, F17; M0
 * AC 47).
 *
 * POSTs endpoint 13 (`/api/account/closure`) — the ACCOUNT-level soft
 * delete: a 30-day recovery window during which sign-in is refused
 * (`lib/auth/closure.ts`), then a hard purge. This is a DIFFERENT action
 * from `DeleteChildDataDialog` (endpoint 6): that one deletes a single
 * STUDENT's data immediately, with no recovery window, and is not offered
 * here — the copy below only points at it (AC 49; closing the account is
 * never the only way to delete a child's data).
 *
 * `recoveryWindowDays` and `purgeAfter` are read from the endpoint's own
 * response and rendered only in the post-success receipt, never
 * hard-coded into the pre-confirmation copy — the response is the one
 * place those numbers are authoritative (plan §3, endpoint 13's doc:
 * "returned so the confirmation screen states the window rather than
 * hard-coding it"). AC 47's "confirmation screen" is this receipt: it is
 * shown once closure has actually been confirmed and processed, not
 * before.
 *
 * `AccountClosureResult` is declared here, not in `lib/schemas/dto.ts` —
 * this feature's constraints keep that file (and the rest of
 * `lib/schemas/*`) off limits to the frontend track, so the one response
 * shape endpoint 13 returns is typed once, next to its only consumer,
 * instead of duplicated inline at each use below.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LogOut } from "lucide-react";

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

/** The success body of `POST /api/account/closure` (plan §3, endpoint 13). */
type AccountClosureResult = {
  closureRequestedAt: string;
  purgeAfter: string;
  recoveryWindowDays: number;
};

const CONFIRM_PHRASE = "CLOSE";

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    dateStyle: "long",
  });
}

export function CloseAccountDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AccountClosureResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const canSubmit =
    acknowledged && confirmText.trim().toUpperCase() === CONFIRM_PHRASE;

  function reset() {
    setAcknowledged(false);
    setConfirmText("");
    setError(null);
    setResult(null);
  }

  function handleClose() {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      const response = await apiFetch<AccountClosureResult>(
        "/api/account/closure",
        { method: "POST", body: { confirm: true } },
      );
      if (!response.ok) {
        setError(response.error.message);
        return;
      }
      setResult(response.data);
    });
  }

  function handleDone() {
    setOpen(false);
    // The server already deleted every Session row (AC 5/47) — this
    // browser's cookie is dead. There is nowhere signed-in left to send
    // the parent back to.
    router.push("/");
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Once closure has succeeded there's nothing left to cancel back
        // out of — route the "close" affordance (Escape, overlay click)
        // through the same exit as the "Done" button instead of silently
        // discarding the receipt.
        if (!next && result) {
          handleDone();
          return;
        }
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={<Button variant="destructive" className="h-11" />}>
        Close account
      </DialogTrigger>
      <DialogContent>
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>Your account is scheduled for closure</DialogTitle>
              <DialogDescription>
                You have until <strong>{formatDate(result.purgeAfter)}</strong>{" "}
                — {result.recoveryWindowDays} days from today — before
                everything is permanently purged: every student profile,
                consent record and uploaded file. Until then, sign-in is
                refused, so if this was a mistake, contact support before
                that date. A record of this request and its completion is
                kept afterward for our own audit trail; nothing else
                survives.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button className="h-11 gap-2" onClick={handleDone}>
                <LogOut className="size-4" />
                Return to homepage
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Close your account?</DialogTitle>
              <DialogDescription>
                Your account and everything in it — every student profile,
                consent record and uploaded file — becomes inaccessible
                right away and sign-in is refused. It is recoverable by
                contacting support during the recovery window; after that
                window it is permanently and irreversibly purged.
                <br />
                <br />
                This is <strong>not</strong> the same as deleting a single
                student&apos;s data. That is immediate, has no recovery
                window, and is available from that student&apos;s own
                privacy page — you do not need to close your account to do
                it.
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
                  id="acknowledgeClosure"
                  checked={acknowledged}
                  onCheckedChange={(checked) => setAcknowledged(checked === true)}
                  disabled={isPending}
                  className="mt-0.5"
                />
                <Label
                  htmlFor="acknowledgeClosure"
                  className="cursor-pointer font-normal text-muted-foreground"
                >
                  I understand sign-in will be refused until the recovery
                  window ends, after which this is permanent.
                </Label>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="confirmCloseText">
                  Type {CONFIRM_PHRASE} to confirm
                </Label>
                <Input
                  id="confirmCloseText"
                  autoComplete="off"
                  disabled={isPending}
                  className="h-11"
                  value={confirmText}
                  onChange={(event) => setConfirmText(event.target.value)}
                />
              </div>
            </div>

            <DialogFooter className="sm:justify-between">
              <Button
                variant="outline"
                className="h-11"
                render={<Link href="/dashboard" />}
              >
                Manage a student&apos;s data instead
              </Button>
              <div className="flex gap-2">
                <DialogClose
                  render={<Button variant="outline" className="h-11" disabled={isPending} />}
                >
                  Cancel
                </DialogClose>
                <Button
                  variant="destructive"
                  className="h-11"
                  disabled={isPending || !canSubmit}
                  onClick={handleClose}
                >
                  {isPending ? "Closing…" : "Close account"}
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
