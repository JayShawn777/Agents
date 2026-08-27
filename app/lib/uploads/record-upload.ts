import "server-only";

import { after } from "next/server";

import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import type { Upload } from "@/lib/generated/prisma/client";
import type { StoragePort } from "@/lib/storage/port";
import { ALLOWED_UPLOAD_CONTENT_TYPES, EXTRACTION_MODEL, PDF_PAGE_LIMIT, type UploadContentType } from "@/lib/config";
import { countPdfPagesServerSide } from "@/lib/uploads/server-pdf-page-count";
import { runExtraction } from "@/lib/extraction/run-extraction";

/**
 * `POST /api/uploads/confirm` (endpoint 15, B17, ADR-0003 step 5) — the
 * PRIMARY persistence path. `contentType` and `sizeBytes` come from
 * `storage.head()`, NEVER from the client's claims (the schema's own
 * comment on `Upload.contentType`/`sizeBytes`, and this endpoint's whole
 * trust model).
 */
export type RecordUploadResult =
  | { ok: true; upload: Upload; extractionId: string; created: boolean }
  | { ok: false; code: "NOT_FOUND_IN_STORE" }
  | { ok: false; code: "DISALLOWED_CONTENT_TYPE" }
  | { ok: false; code: "PDF_PAGE_LIMIT_EXCEEDED" };

export async function recordUpload(args: {
  studentProfileId: string;
  pathname: string;
  originalFilename: string;
  storage: StoragePort;
}): Promise<RecordUploadResult> {
  const { studentProfileId, pathname, originalFilename, storage } = args;

  // Idempotency FIRST (M1 AC 15: a confirmation delivered twice — including
  // a race with the `blob.upload-completed` backstop callback — leaves
  // exactly one row). `Upload.pathname` is `@unique`, and an `Upload` row is
  // never created without its `Extraction` sibling in the same transaction
  // below, so an existing row always has one.
  const existing = await readUploadWithExtraction(pathname);
  if (existing) {
    return { ok: true, upload: existing.upload, extractionId: existing.extractionId, created: false };
  }

  const meta = await storage.head(pathname);
  if (!meta) {
    return { ok: false, code: "NOT_FOUND_IN_STORE" };
  }

  if (!ALLOWED_UPLOAD_CONTENT_TYPES.includes(meta.contentType as UploadContentType)) {
    return { ok: false, code: "DISALLOWED_CONTENT_TYPE" };
  }

  let pageCount: number | null = null;
  if (meta.contentType === "application/pdf") {
    const bytes = await storage.readBytes(pathname);
    pageCount = await countPdfPagesServerSide(bytes);
    if (pageCount > PDF_PAGE_LIMIT) {
      return { ok: false, code: "PDF_PAGE_LIMIT_EXCEEDED" };
    }
  }

  try {
    const { upload, extraction } = await db.$transaction(async (tx) => {
      const createdUpload = await tx.upload.create({
        data: {
          studentProfileId,
          pathname,
          contentType: meta.contentType,
          sizeBytes: meta.sizeBytes,
          originalFilename,
          pageCount,
          status: "STORED",
        },
      });
      // ADR-0005: `Extraction` is created in `PENDING` in the SAME
      // transaction as `Upload` — the two are never separated, which is
      // what lets `readUploadWithExtraction` above assume an existing
      // `Upload` row always has an `Extraction` sibling.
      const createdExtraction = await tx.extraction.create({
        data: { uploadId: createdUpload.id, model: EXTRACTION_MODEL, status: "PENDING" },
      });
      return { upload: createdUpload, extraction: createdExtraction };
    });

    // ADR-0005: scheduled in the SAME invocation as the confirm response,
    // after the transaction above has committed, via `after()` from
    // `next/server`. A thrown error inside the scheduled callback is caught
    // and logged here — never left to surface to a browser that has already
    // moved on to polling `GET /api/extractions/[id]`.
    after(() => {
      runExtraction(extraction.id).catch((err: unknown) => {
        console.error(`Scheduled runExtraction(${extraction.id}) failed`, err);
      });
    });

    return { ok: true, upload, extractionId: extraction.id, created: true };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Lost a race to a concurrent confirm (or the `blob.upload-completed`
      // backstop) for the SAME pathname — re-read rather than error
      // (M1 AC 15: exactly one row for two concurrent confirms).
      const raced = await readUploadWithExtraction(pathname);
      if (raced) {
        return { ok: true, upload: raced.upload, extractionId: raced.extractionId, created: false };
      }
    }
    throw err;
  }
}

async function readUploadWithExtraction(
  pathname: string,
): Promise<{ upload: Upload; extractionId: string } | null> {
  const row = await db.upload.findUnique({ where: { pathname }, include: { extraction: true } });
  if (!row) return null;
  if (!row.extraction) {
    // Invariant violated: every `Upload` is created alongside its
    // `Extraction` in the same transaction above. Surface loudly rather
    // than silently returning a broken DTO.
    throw new Error(`recordUpload: Upload ${row.id} has no Extraction row.`);
  }
  const { extraction, ...upload } = row;
  return { upload, extractionId: extraction.id };
}
