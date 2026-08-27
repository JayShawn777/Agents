"use client";

/**
 * CLIENT: fetches the signed preview URL on demand and holds it in memory
 * only — never server-rendered into HTML (plan §4/§5.2, F16; M1 AC 31, 32).
 * A signed URL is a bearer credential (ADR-0003): minting it eagerly, or
 * passing it through a server component's render, would put a time-limited
 * but still-live credential into HTML the browser could cache or a student
 * could screenshot/share the address bar of — so this component only ever
 * requests one after an explicit click, and only ever puts it in `<img
 * src>`/an anchor's `href`, never in text a parent page could serialize.
 *
 * `sourceDeleted` handles the case named in the M1 spec's open questions
 * (and this task's brief): 14 days after extraction, the source file is
 * gone. That is a normal outcome, not an error — rendered as its own
 * explicit state, never a broken image or a silent empty box.
 */

import { useState } from "react";
import { FileText, ImageIcon, ShieldOff } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api/client";

type PreviewUrlResponse = { url: string; expiresAt: string };

type PreviewState = "idle" | "loading" | "ready" | "gone" | "error";

export function UploadPreview({
  uploadId,
  contentType,
  sourceDeleted,
}: {
  uploadId: string;
  contentType: string;
  sourceDeleted: boolean;
}) {
  const [state, setState] = useState<PreviewState>(sourceDeleted ? "gone" : "idle");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadPreview() {
    setState("loading");
    const result = await apiFetch<PreviewUrlResponse>(`/api/uploads/${uploadId}/preview-url`);
    if (!result.ok) {
      if (result.error.code === "CONFLICT") {
        // The retention job deleted the source between page load and this
        // click — the same "gone" state as if we'd known from the start.
        setState("gone");
        return;
      }
      setError(result.error.message);
      setState("error");
      return;
    }
    setUrl(result.data.url);
    setState("ready");
  }

  if (state === "gone") {
    return (
      <Alert>
        <ShieldOff className="size-4" aria-hidden="true" />
        <AlertDescription>
          The original photo has been removed. Once we&apos;ve read the
          problems off a page, we don&apos;t keep the picture itself — the
          problems below are still yours to review and correct.
        </AlertDescription>
      </Alert>
    );
  }

  if (state === "error") {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (state === "ready" && url) {
    if (contentType === "application/pdf") {
      return (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-11 w-fit items-center gap-2 rounded-lg border border-border px-3 text-sm text-foreground hover:bg-muted"
        >
          <FileText className="size-4" aria-hidden="true" />
          Open the original PDF
        </a>
      );
    }
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL, deliberately not proxied through Next's image optimizer (ADR-0003)
      <img
        src={url}
        alt="Your uploaded worksheet"
        className="max-h-96 w-full rounded-lg border border-border object-contain"
      />
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="h-11 w-fit gap-2"
      disabled={state === "loading"}
      onClick={loadPreview}
    >
      <ImageIcon className="size-4" aria-hidden="true" />
      {state === "loading" ? "Loading…" : "Show original photo"}
    </Button>
  );
}
