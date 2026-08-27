"use client";

/**
 * CLIENT: confirm dialog + DELETE + `router.refresh()` (plan §4, F6; M0
 * AC 31). Needs open/close state and a pending mutation, so it can't be a
 * server component.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

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

export function DeleteStudentDialog({
  studentId,
  studentLabel,
}: {
  studentId: string;
  studentLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await apiFetch<{ deleted: true }>(
        `/api/students/${studentId}`,
        { method: "DELETE" },
      );
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setOpen(false);
      // AC 31: the profile disappears from the list. The dashboard is a
      // server component reading straight from the database, so a client
      // router refresh — not local state — is what makes it disappear.
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-11 text-muted-foreground hover:text-destructive"
            aria-label={`Delete ${studentLabel}`}
          />
        }
      >
        <Trash2 className="size-4" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {studentLabel}?</DialogTitle>
          <DialogDescription>
            This removes {studentLabel}&apos;s profile, uploads and consent
            record. This can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <DialogClose
            render={<Button variant="outline" className="h-11" disabled={isPending} />}
          >
            Cancel
          </DialogClose>
          <Button
            variant="destructive"
            className="h-11"
            disabled={isPending}
            onClick={handleDelete}
          >
            {isPending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
