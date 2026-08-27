---
name: lib-uploads-path-collision
description: backend and frontend tracks were both assigned lib/uploads/pdf-page-count.ts in the M0/M1 plan — a real file-path collision, not a merge conflict to paper over
metadata:
  type: project
---

The M0/M1 implementation plan's file-by-file lists (§5.1 backend B17, §5.2
frontend F14) both name `lib/uploads/pdf-page-count.ts` — the backend needs a
`server-only` page-counter trusted to enforce `PDF_PAGE_LIMIT` at confirm
time (M1 AC 10), the frontend needs a client-side, dynamically-imported
UX-only counter with no `server-only` guard. These are genuinely different
files with different trust models that happen to share a path in the plan.

**Why:** discovered mid-implementation when the frontend track's concurrent
write silently replaced the backend's version of that path. Renaming instead
of fighting over the path was the right call — this is a plan defect, not a
merge conflict, and neither implementation is wrong.

**How to apply:** the backend's server-side PDF page counter now lives at
`lib/uploads/server-pdf-page-count.ts` (`countPdfPagesServerSide`), imported
by `lib/uploads/record-upload.ts`. If a future plan revision touches this
area, flag any other `lib/uploads/*` filename the frontend and backend
tracks share before writing — check `git status`/the frontend's recent
commits for a same-named file before assuming a fresh path is free. See also
[local-fs-storage-adapter](local-fs-storage-adapter.md) for the related
client-direct-upload / local-dev seam this file supports.
