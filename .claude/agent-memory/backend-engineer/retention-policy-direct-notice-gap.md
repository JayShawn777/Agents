---
name: retention-policy-direct-notice-gap
description: RETENTION_POLICY's DIRECT_NOTICE entry names an anchor (deletedAt) that doesn't exist as a DirectNotice column — flagged, not worked around.
metadata:
  type: project
---

`lib/config.ts`'s `RETENTION_POLICY` table has a `DIRECT_NOTICE` entry with
`windowDays: DELETION_AUDIT_RETENTION_DAYS, anchor: 'deletedAt'`. `DirectNotice`
(`prisma/schema.prisma`) has no `deletedAt` column, and the row is
`onDelete: Cascade` from `StudentProfile` (no foreign-key-free survival the
way `DeletionAudit`/`ConsentAuditArtifact` are deliberately built to have) —
so a `DirectNotice` row cannot outlive the profile it belongs to, and there is
no query `lib/jobs/enforce-retention.ts` (B22) could run against the stated
anchor.

`enforceRetention()` reports `byCategory.DIRECT_NOTICE: 0` unconditionally,
with a docstring explaining why, and
`tests/unit/lib/jobs/retention-policy-coverage.test.ts` encodes this as a
named, deliberate exception (`WINDOWED_KEYS_WITH_NO_ENFORCEABLE_JOB`) rather
than silently passing.

**This needs an architect decision, not an engineering workaround:** either
(a) build a real post-deletion notice-evidence artifact mirroring
`ConsentAuditArtifact` (a schema change), or (b) remove the `anchor`/window
from the `DIRECT_NOTICE` policy entry and `app/retention/page.tsx`'s copy if
`DirectNotice` was never actually meant to survive deletion. Left unresolved,
the published `/retention` page and this table both describe a control that
does not exist — the exact "published policy describes a window nothing
enforces" risk ADR-0007's own `RETENTION_POLICY` design says it prevents.

**How to apply:** don't invent a schema-less enforcement for this key if
asked to "make the coverage test pass for real" — surface this note instead.
