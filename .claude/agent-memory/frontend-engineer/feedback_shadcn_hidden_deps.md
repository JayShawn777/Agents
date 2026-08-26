---
name: feedback-shadcn-hidden-deps
description: Some shadcn CLI components silently install real npm packages, not just source files — always diff package.json after `shadcn add`.
metadata:
  type: feedback
---

Not every `pnpm dlx shadcn@latest add <component>` invocation is dependency-free.
Most shadcn components in this codebase's "base-nova" style are pure source
files layered on top of `@base-ui/react` (already a dependency) — but some,
like `sonner` (toast), pull in genuinely new npm packages (`sonner`,
`next-themes`) that are not in the project's approved dependency table.

**Why:** the project constitution treats "shadcn add" as exempt from the
"never add a major dependency without asking" rule, on the theory that it
only copies source into `components/ui/`. That's true for most components but
not all — `sonner` is the counterexample found in this repo
(`docs/plans/m0-m1-implementation.md`).

**How to apply:** after any `shadcn add`, run `git diff package.json` (and
check `pnpm-lock.yaml`) before treating the add as free. If it introduced a
real dependency not already in the approved list, revert the added
component file(s) and the package.json/lockfile changes with `pnpm install`,
and report the dependency as blocked/needs-approval rather than keeping it —
unless the component is actually needed in the current scope, in which case
stop and ask first. See [[frontend-parallel-track-workflow]] for the broader
workflow this fits into.
