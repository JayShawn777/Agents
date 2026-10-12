import "server-only";

import type { StoragePort } from "@/lib/storage/port";
import { STORAGE_DRIVER } from "@/lib/config";
import { LocalFsStorage } from "@/lib/storage/local-fs";
import { VercelBlobStorage } from "@/lib/storage/vercel-blob";

/**
 * The single place a `StoragePort` instance is obtained. Selected by
 * `STORAGE_DRIVER` (`lib/config.ts`, ADR-0003):
 *
 *   - `"local"` (the default) — `lib/storage/local-fs.ts`, a filesystem
 *     adapter that unblocks M1 while the Vercel Blob account/store in
 *     ADR-0003's follow-up list does not exist yet.
 *   - `"vercel-blob"` — `lib/storage/vercel-blob.ts` (B15, ADR-0003), built
 *     2026-10-12 against the SDK's types but NOT yet run against a real
 *     store; see that file's docstring for the three things the first
 *     preview deployment must check. A storage failure surfaces as an error
 *     (`deleteStudentData` treats a `storage.del()` rejection as
 *     `STORAGE_FAILURE`, mapped to `502 UPSTREAM_ERROR`, rows retained for
 *     retry — ADR-0007 §1), never as silent success.
 */
export function getStoragePort(): StoragePort {
  if (STORAGE_DRIVER === "local") {
    return new LocalFsStorage();
  }

  // The production adapter. It needs `BLOB_READ_WRITE_TOKEN` in the environment
  // (the SDK reads it itself); a missing token surfaces as the SDK's own error
  // on first use rather than a silent fallback to local disk, which on Vercel
  // would "work" and then lose every file on the next cold start.
  return new VercelBlobStorage();
}
