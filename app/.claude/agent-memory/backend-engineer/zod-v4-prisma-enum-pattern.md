---
name: zod-v4-prisma-enum-pattern
description: In this repo's zod v4 + Prisma 7, z.enum() accepts the generated const-object enums directly — no need for z.nativeEnum or a separate literal array
metadata:
  type: project
---

zod v4's `z.enum()` accepts any `EnumLike` (`Readonly<Record<string, string |
number>>`), which includes Prisma 7's generated enum pattern
(`export const Foo = {...} as const; export type Foo = (typeof Foo)[keyof
typeof Foo]`, in `lib/generated/prisma/enums.ts`, re-exported from
`lib/domain/enums.ts`). So schemas just do `z.enum(AgeBand)`,
`z.enum(GradeLevel)`, etc., directly against the imported enum object — never
`z.nativeEnum()` (deprecated, merged into `z.enum()`) and never a
hand-duplicated literal array of the same values.

**Why:** confirmed by reading `node_modules/zod/v4/classic/schemas.d.ts` and
matches the plan's own example (`z.object({ ageBand: z.enum(AgeBand) })`).

**How to apply:** any new zod schema in `lib/schemas/` that validates a
Prisma-backed enum field should import the enum from `lib/domain/enums.ts` and
call `z.enum(EnumObject)` directly.
