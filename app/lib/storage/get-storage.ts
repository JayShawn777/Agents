import "server-only";

import type { StoragePort } from "@/lib/storage/port";
import { STORAGE_DRIVER } from "@/lib/config";
import { LocalFsStorage } from "@/lib/storage/local-fs";

/**
 * The single place a `StoragePort` instance is obtained. Selected by
 * `STORAGE_DRIVER` (`lib/config.ts`, ADR-0003):
 *
 *   - `"local"` (the default) — `lib/storage/local-fs.ts`, a filesystem
 *     adapter that unblocks M1 while the Vercel Blob account/store in
 *     ADR-0003's follow-up list does not exist yet.
 *   - `"vercel-blob"` — `lib/storage/vercel-blob.ts` (B15, ADR-0003) has not
 *     been built yet, so this branch returns a port whose every method
 *     rejects, rather than importing a concrete provider that doesn't
 *     exist. Failing loudly here is the correct behaviour: a missing
 *     implementation must never silently pretend to store a child's file.
 *     `deleteStudentData` treats a `storage.del()` rejection as
 *     `STORAGE_FAILURE` (mapped by callers to `502 UPSTREAM_ERROR`, rows
 *     retained for retry — ADR-0007 §1), never as silent success.
 *
 * B15 replaces only the `"vercel-blob"` branch below — every caller of
 * `getStoragePort()` is unaffected, and so is the `"local"` branch.
 */
export function getStoragePort(): StoragePort {
  if (STORAGE_DRIVER === "local") {
    return new LocalFsStorage();
  }

  const notImplemented = (): never => {
    throw new Error(
      "StoragePort has no vercel-blob implementation yet — lib/storage/vercel-blob.ts is pending " +
        "(plan B15, ADR-0003). Set STORAGE_DRIVER=local to use the filesystem adapter instead.",
    );
  };

  return {
    handleClientUpload: notImplemented,
    head: notImplemented,
    signedReadUrl: notImplemented,
    readBytes: notImplemented,
    del: notImplemented,
    listAll: notImplemented,
  };
}
