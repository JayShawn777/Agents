---
name: prisma7-auth-adapter-silent-any
description: "@auth/prisma-adapter" against Prisma 7's custom-output generator erases to unchecked `any`, not a loud TS error — hand-write the Adapter instead
metadata:
  type: project
---

`@auth/prisma-adapter`'s `PrismaAdapter(prisma)` types its parameter as
`PrismaClient` imported from `@prisma/client`. When the Prisma schema uses
the v7 `prisma-client` generator with a custom `output` path (this project:
`output = "../lib/generated/prisma"`, imported via `@/lib/db` — never
`@prisma/client` directly, per CLAUDE.md), `node_modules/.prisma/client`
is never populated, so `@prisma/client`'s own type export
(`export * from '.prisma/client/default'`) can't resolve.

**Non-obvious part:** with this project's `tsconfig.json` (`skipLibCheck:
true`), that unresolvable re-export does NOT surface as a loud `TS2307`
at the call site. It silently degrades the `PrismaClient` parameter type
to an unchecked type — confirmed by passing a literal `42` to
`PrismaAdapter(...)` and getting zero type errors. `pnpm typecheck` stays
green while the adapter boundary is completely unchecked. Toggling
`skipLibCheck` off would turn this into an immediate hard failure instead.

**Why it matters:** ADR-0002 anticipated "might not typecheck" and named a
contingency (hand-write the ~15-function `Adapter` interface from
`@auth/core/adapters` against the generated client directly). Confirmed
during M0 backend work (2026-08-26) that the failure mode is real, just
quieter than expected. Built `lib/auth/prisma-adapter.ts` as the
hand-written adapter; it is correct and complete for the email-provider +
database-session flow (no OAuth/webauthn methods implemented, since
nothing in this app configures those providers).

**How to apply:** Don't reach for `@auth/prisma-adapter` (or trust that a
clean `pnpm typecheck` proves it's wired correctly) in any project using
Prisma 7's `prisma-client` generator with a non-default output path. Write
the adapter by hand against the generated client's own model types
(`@/lib/generated/prisma/client`), never against `@prisma/client`. Report
this to the architect if a future milestone considers depending on
`@auth/prisma-adapter` again — the dependency is approved but not usable
in this schema-generator configuration.
