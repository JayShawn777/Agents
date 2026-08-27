import { vi } from "vitest";

import type { StoragePort } from "@/lib/storage/port";

/**
 * A FAKE `StoragePort` for the `lib/jobs/*.ts` unit suites (plan B22: "so
 * they are unit-testable with a fake and a frozen time"). No `@vercel/blob`
 * import anywhere in this file, matching
 * `tests/unit/lib/deletion/service.test.ts`'s existing pattern for the same
 * reason: the real implementation (B15) doesn't exist yet.
 *
 * `objects` seeds what `listAll(prefix?)` yields — `reconcile-blobs.ts`
 * enumerates the whole store; `purge-pre-consent.ts` enumerates one
 * profile's prefix. `del()` records every call's pathname batch on
 * `.deletedBatches` unless `overrides.del` replaces it (for a
 * simulated-failure test).
 */
export type FakeStorageObject = { pathname: string; uploadedAt: Date };

export type FakeStoragePort = StoragePort & { deletedBatches: string[][] };

export function createFakeStorage(
  objects: FakeStorageObject[] = [],
  overrides?: Partial<StoragePort>,
): FakeStoragePort {
  const deletedBatches: string[][] = [];

  const port: StoragePort = {
    handleClientUpload: vi.fn(),
    head: vi.fn(),
    signedReadUrl: vi.fn(),
    readBytes: vi.fn(),
    del: vi.fn(async (pathnames: string[]) => {
      deletedBatches.push(pathnames);
    }),
    listAll: vi.fn(function listAll(prefix?: string) {
      async function* generate() {
        for (const obj of objects) {
          if (!prefix || obj.pathname.startsWith(prefix)) yield obj;
        }
      }
      return generate();
    }),
    ...overrides,
  };

  return Object.assign(port, { deletedBatches });
}
