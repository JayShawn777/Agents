"use client";

/**
 * CLIENT: the whole reason client-direct upload exists (plan §4/§5.2, F15;
 * M1 AC 1-9). Drag-and-drop, a file-picker button and a camera-capture
 * button are three separate ways to reach the same file-handling path, and
 * an in-flight upload needs live progress and phase state — none of that
 * is expressible as a server component.
 *
 * State machine, in order:
 *
 *   idle -> validating -> [converting] -> uploading -> confirming -> (navigate away)
 *                       \-> error (retry re-enters at "validating")
 *
 * `converting` is its own visible phase, not folded into "uploading" —
 * HEIC decoding can take several seconds on an older iPhone (ADR-0004), and
 * silence during that window reads as a hang. `components/uploads/upload-flow.ts`
 * owns the actual network protocol; this component owns state and layout
 * only.
 */

import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { Camera, FileUp, Loader2, UploadCloud } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { uploadFile } from "@/components/uploads/upload-flow";
import { ACCEPTED_PICKER_TYPES } from "@/lib/config";
import { convertHeicToJpeg, HeicConversionError } from "@/lib/uploads/convert-heic";
import { validateFileForUpload } from "@/lib/uploads/client-validate";

type PanelState =
  | { phase: "idle" }
  | { phase: "validating" }
  | { phase: "converting" }
  | { phase: "uploading"; percentage: number }
  | { phase: "confirming" }
  | { phase: "error"; message: string };

const ACCEPT_ATTR = ACCEPTED_PICKER_TYPES.join(",");

export function UploadPanel({ studentProfileId }: { studentProfileId: string }) {
  const router = useRouter();
  const [state, setState] = useState<PanelState>({ phase: "idle" });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const pickerInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const isBusy = state.phase !== "idle" && state.phase !== "error";

  const handleFile = useCallback(
    async (file: File) => {
      setSelectedFile(file);
      setState({ phase: "validating" });

      const validation = await validateFileForUpload(file);
      if (!validation.ok) {
        setState({ phase: "error", message: validation.message });
        return;
      }

      let bytesToUpload: File = file;
      if (validation.needsHeicConversion) {
        setState({ phase: "converting" });
        try {
          bytesToUpload = await convertHeicToJpeg(file);
        } catch (err) {
          const message =
            err instanceof HeicConversionError
              ? err.message
              : "We couldn't read this photo. Please try again.";
          setState({ phase: "error", message });
          return;
        }
      }

      setState({ phase: "uploading", percentage: 0 });
      const outcome = await uploadFile(bytesToUpload, {
        studentProfileId,
        originalFilename: file.name,
        onProgress: (progress) => setState({ phase: "uploading", percentage: progress.percentage }),
      });

      if (!outcome.ok) {
        setState({ phase: "error", message: outcome.message });
        return;
      }

      setState({ phase: "confirming" });
      router.push(`/students/${studentProfileId}/uploads/${outcome.response.upload.id}`);
    },
    [studentProfileId, router],
  );

  function onInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Allow re-selecting the exact same file after an error without the
    // browser treating it as "no change".
    event.target.value = "";
    if (file) void handleFile(file);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  function retry() {
    if (selectedFile) void handleFile(selectedFile);
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
          isDragging ? "border-primary bg-primary/5" : "border-border"
        }`}
      >
        <UploadCloud className="size-10 text-muted-foreground" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground">
            Drag a photo or PDF here, or choose one below
          </p>
          <p className="text-xs text-muted-foreground">JPEG, PNG, WEBP, HEIC or PDF — up to 20 MB</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            type="button"
            variant="outline"
            className="h-11 gap-2"
            disabled={isBusy}
            onClick={() => pickerInputRef.current?.click()}
          >
            <FileUp className="size-4" />
            Choose a file
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11 gap-2"
            disabled={isBusy}
            onClick={() => cameraInputRef.current?.click()}
          >
            <Camera className="size-4" />
            Take a photo
          </Button>
        </div>
        {/* Two distinct controls (M1 AC 1): a plain file picker and a
            camera-capture input. `capture="environment"` is what opens the
            device camera directly on mobile rather than a file browser. */}
        <input
          ref={pickerInputRef}
          type="file"
          accept={ACCEPT_ATTR}
          className="hidden"
          onChange={onInputChange}
          aria-label="Choose a file to upload"
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept={ACCEPT_ATTR}
          capture="environment"
          className="hidden"
          onChange={onInputChange}
          aria-label="Take a photo to upload"
        />
      </div>

      {state.phase === "validating" ? (
        <StatusRow label="Checking your file…" />
      ) : null}

      {state.phase === "converting" ? (
        <StatusRow label="Converting your photo… this can take a moment on some iPhones." />
      ) : null}

      {state.phase === "uploading" || state.phase === "confirming" ? (
        <div className="flex flex-col gap-2">
          <StatusRow label={state.phase === "confirming" ? "Finishing up…" : "Uploading…"} />
          <Progress value={state.phase === "uploading" ? state.percentage : 100} />
        </div>
      ) : null}

      {state.phase === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>We couldn&apos;t upload that file</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <p>{state.message}</p>
            {selectedFile ? (
              <Button type="button" variant="outline" className="h-11 w-fit" onClick={retry}>
                Try again
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function StatusRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
