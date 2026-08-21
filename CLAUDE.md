@AGENTS.md

# Project Constitution

## Stack
- Next.js (App Router) + TypeScript strict — frontend AND backend (API routes / server actions)
- Tailwind CSS + shadcn/ui for all UI. Prefer shadcn components over hand-rolled ones.
- Postgres + Prisma. Schema lives in prisma/schema.prisma.
- Vitest for unit/integration. Playwright for e2e.
- pnpm ONLY. Never use npm or yarn commands.
- Deploys to Vercel. Database on Neon/Supabase. Secrets only in .env (gitignored).

## Commands
- Dev: `pnpm dev`         Build: `pnpm build`
- Unit tests: `pnpm test`  E2E: `pnpm test:e2e`
- Lint: `pnpm lint`        Typecheck: `pnpm typecheck`
- Migrate: `pnpm db:migrate`  DB GUI: `pnpm db:studio`

## Workflow (MANDATORY)
1. Any non-trivial task: plan mode first. Delegate to product-spec agent,
   then architect agent. STOP for my approval after the architecture plan.
2. After approval: frontend-engineer and backend-engineer may run as
   parallel subagents against the fixed API contract.
3. Then: qa-tester → code-reviewer → security-reviewer → docs-writer.
4. DONE means: `pnpm typecheck`, `pnpm lint`, and all tests pass.
5. Conventional commits. Never commit secrets. Never force-push.

## Conventions
- TypeScript strict; no `any` without a justifying comment.
- Validate ALL external input with zod at the API boundary.
- Server components by default; "use client" only when interactivity requires it.
- Data access goes through Prisma in server code only — never expose the DB to the client.
- Every API route/server action handles errors and returns a typed error shape.
- Match existing file/folder patterns before inventing new ones.

## Knowledge base
- Specs: docs/specs/  ADRs: docs/adr/  Research: docs/research/  Ops: docs/runbook.md
- Read the relevant doc before starting. Unfamiliar library → researcher agent first.

## Never
- Never add a new major dependency without asking me.
- Never edit applied migration files.
- Never delete or weaken a test to make the suite pass.
- Never put secrets in code or in NEXT_PUBLIC_ variables.
