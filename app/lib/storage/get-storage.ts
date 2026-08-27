import "server-only";

import type { StoragePort } from "@/lib/storage/port";

/**
 * The single place a `StoragePort` instance is obtained. `lib/storage/vercel-blob.ts`
 * (B15, ADR-0003) has not been built yet, so this returns a port whose every
 * method rejects, rather than importing a concrete provider that doesn't
 * exist.
 *
 * That is safe today: nothing in the shipped surface can create an `Upload`
 * row yet (B15-B18 — the client-direct-upload route, the confirm route —
 * are also not built), so `lib/deletion/service.ts`'s `deleteStudentData`
 * never finds a pathname to pass to `storage.del()` and this port's methods
 * are never actually invoked in production. If that invariant is ever
 * violated before B15 lands, failing loudly here is the correct behaviour:
 * `deleteStudentData` treats a `storage.del()` rejection as `STORAGE_FAILURE`
 * (mapped by callers to `502 UPSTREAM_ERROR`, rows retained for retry —
 * ADR-0007 §1), never as silent success.
 *
 * B15 replaces only this function's body — every caller of `getStoragePort()`
 * is unaffected.
 */
export function getStoragePort(): StoragePort {
  const notImplemented = (): never => {
    throw new Error(
      "StoragePort has no implementation yet — lib/storage/vercel-blob.ts is pending (plan B15, ADR-0003).",
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
