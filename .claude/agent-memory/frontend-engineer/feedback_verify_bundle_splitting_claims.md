---
name: feedback-verify-bundle-splitting-claims
description: When a task requires proving a dynamic import is actually code-split out of the initial bundle (e.g. a lazy-loaded decoder), verify against real build output, not just the source structure.
metadata:
  type: feedback
---

Asked to confirm a heavy dependency (`heic-to`'s wasm decoder, M1 AC 5) is
never fetched by the browser for the common case, "the only `import()` call
is inside a guarded function" is necessary but was treated as sufficient
before being pushed on — the coordinator specifically asked HOW it was
confirmed, not just that it was intended.

**Why:** source structure proves intent, not outcome. A bundler can still
inline a dynamic import if conditions are right, or a manifest can list a
chunk eagerly. The actual claim ("the browser never fetches this for a
JPEG upload") is a build-artifact fact, not a source-code fact.

**How to apply:** run `pnpm build`, then (1) `grep` the compiled output for
a distinctive string only the heavy dependency contains (e.g. `libheif`) to
find its emitted chunk, and (2) check that chunk's name is absent from the
`build-manifest.json` of every page that could trigger the code path,
especially the one page that actually contains the call
(`.next/server/app/**/page/build-manifest.json`). Presence of the chunk on
disk plus absence from every page's eager script list is the actual
evidence; report the grep/manifest results, not "the import is
dynamically guarded, so it should be fine."
