---
name: local-fs-storage-adapter
description: lib/storage/local-fs.ts implements StoragePort against the filesystem to unblock M1 before a Vercel Blob account exists; one interface method (handleClientUpload) can't be honoured honestly by any non-CDN provider.
metadata:
  type: project
---

`StoragePort` (`lib/storage/port.ts`, ADR-0003) is now implemented twice:
`lib/storage/local-fs.ts` (`LocalFsStorage`, real, default) and the
`vercel-blob` branch of `lib/storage/get-storage.ts` (still a throwing
placeholder — B15). Selected by `STORAGE_DRIVER` (`lib/config.ts`, default
`"local"`).

**Layout:** two parallel trees under a root dir (default `.storage/`,
gitignored) — `objects/<pathname>` for bytes, `meta/<pathname>.json` for a
`{contentType, sizeBytes, uploadedAt}` sidecar. `listAll()` walks `objects/`
only, in fixed-size batches (100), so pagination-boundary bugs are
exercisable in a test without needing a real cursor API.

**The one interface method that is structurally awkward to implement
honestly: `handleClientUpload`.** The real `@vercel/blob` protocol it stands
in for never carries file bytes in EITHER of its two request bodies (token
request or completed-callback) even in production — bytes travel
browser-to-CDN out of band. That means no `StoragePort` implementation can
move bytes through this method, full stop; it isn't specific to a
filesystem-backed provider. `LocalFsStorage` handles this by treating the
method as inert (validates the pathname, returns a token nothing verifies)
and exposing a separate `put()` method — NOT part of `StoragePort` — as the
actual local write path, for tests and for a future local-only upload route.
**If a second non-CDN provider is ever built against this port, expect the
same gap** — worth an architect note if that happens, since two independent
implementations hitting the identical wall is the signal the interface
assumes a CDN-backed provider more than `port.ts`'s docstring lets on.

**A real filesystem surfaced one thing a mock couldn't:** `metaPath()`
originally validated `` `${pathname}.json` `` (the suffixed string) instead
of `pathname` itself, which let `""`, `"."`, and `".."` slip past the
traversal guard — a suffix can turn an invalid segment into a valid-looking
one (`"" + ".json"` = `".json"`, which passes the "non-empty, not `.`/`..`"
checks that `""` alone fails). Fixed by validating `pathname` before the
suffix is appended (`resolveSafePath(root, pathname, suffix)`). Caught by
the contract test suite (`tests/unit/lib/storage/local-fs.test.ts`) against
a real temp directory — the in-memory fake (`tests/unit/mocks/fake-storage.ts`)
has no path-construction logic at all, so it could never have caught this
class of bug. General lesson: sidecar/derived-path schemes for any future
storage adapter need the SAME "validate before you transform" discipline.

**How to apply:** when B15 (`lib/storage/vercel-blob.ts`) is eventually
built, re-verify this memory's claims (`get-storage.ts`'s branches, the
`STORAGE_DRIVER` default) with grep rather than trusting this summary — it
decays as soon as that file lands.
