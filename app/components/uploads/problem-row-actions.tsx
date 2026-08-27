"use client";

/**
 * CLIENT: inline edit textarea + delete (plan §4/§5.2, F16; M1 AC 28, 29).
 * This is the point of the whole results screen — a student can correct a
 * misread problem or remove one that doesn't belong — so it needs local
 * edit-mode state and in-flight mutation state, which a server component
 * can't hold.
 *
 * The server parent (`problem-list.tsx`) computes `renderedHtml` via
 * `katex.renderToString` (ADR-0005) and passes the STRING down — this
 * component never imports `katex` itself, so no KaTeX JavaScript reaches
 * the browser. While editing, the rendered HTML is replaced by a plain
 * textarea over the RAW text (LaTeX delimiters and all); the math
 * re-renders only after a successful save triggers `router.refresh()`
 * (ADR-0005: "no live preview; the re-render happens on save").
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Trash2, X } from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api/client";
import type { ExtractedProblemDTO } from "@/lib/schemas/dto";

type PatchResponse = { problem: ExtractedProblemDTO };

export function ProblemRowActions({
  extractionId,
  problem,
  renderedHtml,
  editable,
}: {
  extractionId: string;
  problem: ExtractedProblemDTO;
  renderedHtml: string;
  editable: boolean;
}) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(problem.text);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function saveEdit() {
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      setError("A problem can't be blank — delete it instead if it doesn't belong.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await apiFetch<PatchResponse>(
        `/api/extractions/${extractionId}/problems/${problem.id}`,
        { method: "PATCH", body: { text: trimmed } },
      );
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setIsEditing(false);
      router.refresh();
    });
  }

  function cancelEdit() {
    setDraft(problem.text);
    setError(null);
    setIsEditing(false);
  }

  function deleteProblem() {
    setError(null);
    startTransition(async () => {
      const result = await apiFetch<{ deleted: true }>(
        `/api/extractions/${extractionId}/problems/${problem.id}`,
        { method: "DELETE" },
      );
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.refresh();
    });
  }

  if (isEditing) {
    return (
      <div className="flex flex-col gap-2">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={isPending}
          maxLength={2000}
          rows={4}
          autoFocus
          aria-label="Edit problem text"
        />
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex gap-2">
          <Button type="button" size="sm" className="h-11 gap-1.5" disabled={isPending} onClick={saveEdit}>
            <Check className="size-4" />
            {isPending ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 gap-1.5"
            disabled={isPending}
            onClick={cancelEdit}
          >
            <X className="size-4" />
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        className="text-sm leading-relaxed text-foreground [&_.katex-display]:my-2 [&_.katex-display]:overflow-x-auto"
        // Server-rendered KaTeX output with trust:false (ADR-0005) — model
        // output, length-capped, never raw user input.
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
      />
      {problem.studentCorrected ? (
        <p className="text-xs text-muted-foreground">You edited this problem.</p>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {editable ? (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 gap-1.5"
            onClick={() => setIsEditing(true)}
          >
            <Pencil className="size-4" />
            Edit
          </Button>
          <Dialog>
            <DialogTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-11 gap-1.5 text-muted-foreground hover:text-destructive"
                />
              }
            >
              <Trash2 className="size-4" />
              Delete
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete this problem?</DialogTitle>
                <DialogDescription>
                  This removes it from the list. This can&apos;t be undone.
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
                <Button variant="destructive" className="h-11" disabled={isPending} onClick={deleteProblem}>
                  {isPending ? "Deleting…" : "Delete"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      ) : null}
    </div>
  );
}
