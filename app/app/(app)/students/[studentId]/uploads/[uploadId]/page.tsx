import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ConfirmExtractionButton } from "@/components/uploads/confirm-extraction-button";
import { EmptyExtraction } from "@/components/uploads/empty-extraction";
import { ExtractionStatus } from "@/components/uploads/extraction-status";
import { ProblemList } from "@/components/uploads/problem-list";
import { UploadPreview } from "@/components/uploads/upload-preview";
import { requireExtraction, requireUpload } from "@/lib/auth/dal";
import { toExtractedProblemDTO, toExtractionDTO, toUploadDTO } from "@/lib/uploads/dto";
import type { ExtractedProblemDTO, ExtractionDTO } from "@/lib/schemas/dto";

/**
 * The extraction results screen (plan §4/§5.2, F16; M1 AC 18, 21, 25, 26,
 * 28-31). Server component: loads the upload, its extraction and problems
 * directly through the DAL (`requireUpload`, `requireExtraction`,
 * `lib/auth/dal.ts`, backend track) — no route handler round trip, the same
 * convention the dashboard uses. `lib/uploads/dto.ts`'s mapping functions
 * (also backend track, now landed) are the SAME ones the route handlers
 * for endpoints 16/19 use, so this page's shapes can never drift from the
 * API's.
 */

export const metadata: Metadata = {
  title: "Your worksheet",
};

export default async function UploadResultsPage({
  params,
}: PageProps<"/students/[studentId]/uploads/[uploadId]">) {
  const { studentId, uploadId } = await params;

  // `requireUpload` scopes by the CALLING SESSION via the
  // Upload -> StudentProfile.userId join (M1 AC 33: cross-account and
  // nonexistent are indistinguishable, both 404).
  const uploadRow = await requireUpload(uploadId);
  if (!uploadRow) notFound();
  // Defense in depth: the URL also carries a studentId segment for nice
  // routing; confirm it actually names this upload's own profile rather
  // than trusting it blindly (a mismatch here is still someone's own
  // account, just the wrong student segment — treated the same as "not
  // found" rather than silently rendering under the wrong student).
  if (uploadRow.studentProfileId !== studentId) notFound();

  const upload = toUploadDTO(uploadRow);

  let extraction: ExtractionDTO | null = null;
  let problems: ExtractedProblemDTO[] = [];
  if (uploadRow.extraction) {
    const extractionRow = await requireExtraction(uploadRow.extraction.id);
    if (extractionRow) {
      extraction = toExtractionDTO(extractionRow, extractionRow.problems.length);
      problems = extractionRow.problems.map(toExtractedProblemDTO);
    }
  }

  // AC 30: nothing further happens once CONFIRMED — editing/deleting stops
  // being offered, but the list itself stays visible.
  const isEditable = extraction?.status === "COMPLETE";
  const isConfirmable = extraction?.status === "COMPLETE";
  const showProblems =
    (extraction?.status === "COMPLETE" || extraction?.status === "CONFIRMED") && problems.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">
          {upload.originalFilename}
        </h1>
        <p className="text-sm text-muted-foreground">
          Uploaded {new Date(upload.createdAt).toLocaleDateString()}
        </p>
      </div>

      <UploadPreview
        uploadId={upload.id}
        contentType={upload.contentType}
        sourceDeleted={upload.status === "SOURCE_DELETED"}
      />

      {extraction ? (
        <ExtractionStatus
          extractionId={extraction.id}
          initialStatus={extraction.status}
          initialFailureMessage={extraction.failureMessage}
        />
      ) : (
        <p className="text-sm text-muted-foreground">Getting your worksheet ready…</p>
      )}

      {extraction?.status === "COMPLETE_EMPTY" ? <EmptyExtraction studentId={studentId} /> : null}

      {showProblems && extraction ? (
        <>
          <ProblemList extractionId={extraction.id} problems={problems} editable={Boolean(isEditable)} />
          {isConfirmable ? <ConfirmExtractionButton extractionId={extraction.id} /> : null}
          {extraction.status === "CONFIRMED" ? (
            <p className="text-sm text-muted-foreground">
              You&apos;ve confirmed this list is correct.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
