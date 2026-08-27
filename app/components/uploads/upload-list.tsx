import Link from "next/link";
import { FileText, ImageIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { ExtractionStatus, UploadStatus } from "@/lib/domain/enums";
import type { UploadDTO } from "@/lib/schemas/dto";

/**
 * Uploads + extraction status per row (plan §4/§5.2, F13). Server
 * component, purely presentational — the student's own page
 * (`students/[studentId]/page.tsx`) does the DB query and passes typed rows
 * down.
 */

const EXTRACTION_STATUS_LABELS: Record<ExtractionStatus, string> = {
  PENDING: "Reading…",
  RUNNING: "Reading…",
  COMPLETE: "Ready to review",
  COMPLETE_EMPTY: "No problems found",
  FAILED: "Couldn't read this one",
  CONFIRMED: "Confirmed",
};

const UPLOAD_STATUS_LABELS: Record<UploadStatus, string> = {
  PENDING: "Uploading…",
  STORED: "Uploaded",
  FAILED: "Upload failed",
  SOURCE_DELETED: "Uploaded",
};

export type UploadListRow = {
  upload: UploadDTO;
  extractionStatus: ExtractionStatus | null;
};

export function UploadList({
  uploads,
  studentId,
  canUpload,
}: {
  uploads: UploadListRow[];
  studentId: string;
  canUpload: boolean;
}) {
  if (uploads.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
        <ImageIcon className="size-8 text-muted-foreground" aria-hidden="true" />
        <p className="max-w-xs text-sm text-muted-foreground">
          {canUpload
            ? "No uploads yet. Upload a photo or PDF of a worksheet to get started."
            : "No uploads yet."}
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {uploads.map(({ upload, extractionStatus }) => (
        <li key={upload.id}>
          <Link
            href={`/students/${studentId}/uploads/${upload.id}`}
            className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3 text-sm transition-colors hover:bg-muted"
          >
            <span className="flex min-w-0 items-center gap-2">
              {upload.contentType === "application/pdf" ? (
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              ) : (
                <ImageIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <span className="truncate">{upload.originalFilename}</span>
            </span>
            <Badge variant="outline" className="shrink-0">
              {extractionStatus ? EXTRACTION_STATUS_LABELS[extractionStatus] : UPLOAD_STATUS_LABELS[upload.status]}
            </Badge>
          </Link>
        </li>
      ))}
    </ul>
  );
}
