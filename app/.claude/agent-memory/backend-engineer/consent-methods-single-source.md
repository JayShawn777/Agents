---
name: consent-methods-single-source
description: Direction chosen for reconciling lib/consent/methods/port.ts's CONSENT_METHODS with the Prisma ConsentMethod enum once the schema landed
metadata:
  type: project
---

`lib/consent/methods/port.ts` originally hand-declared its own `CONSENT_METHODS`
array/type because `prisma/schema.prisma` had no `ConsentMethod` enum yet
(pre-S2). Once the schema + migration landed, reconciled by making
`prisma/schema.prisma`'s `ConsentMethod` enum the single source of truth:
`port.ts` now does
`export const CONSENT_METHODS = Object.values(PrismaConsentMethod) as [PrismaConsentMethod, ...PrismaConsentMethod[]]`
and `export type ConsentMethod = PrismaConsentMethod`, importing the generated
(browser-safe, `as const` object) enum from `@/lib/generated/prisma/enums`.

**Why:** the task instructions explicitly asked for "one source of truth" not
two arrays kept in sync by a compile-time check. The generated enums file has
no `PrismaClient`/adapter/`server-only` import — it's a plain object literal —
so importing it into a "types only" port file doesn't violate the
Prisma-server-only boundary.

**How to apply:** `lib/domain/enums.ts` (S5) is the intended seam for
client-facing code to reach Prisma enums; `lib/consent/methods/port.ts`
imports directly from `@/lib/generated/prisma/enums` instead (not through
`lib/domain/enums.ts`) to avoid a circular import, since `lib/domain/enums.ts`
re-exports `AVATAR_IDS` from `lib/config.ts`, which itself imports
`ConsentMethod`/`CONSENT_METHODS` from `lib/consent/methods/port.ts`. See also
[[coppa-consent-method-enum]].
