// Vitest alias target for the bare `server-only` import (see
// vitest.config.mts). `server-only` throws unconditionally when imported
// outside of Next's own RSC compilation step, which is what makes it a
// useful compile-time guard in the real app — but it also means any module
// that starts with `import "server-only"` (per CLAUDE.md/ADR-0006 convention,
// e.g. `lib/auth/dal.ts`) cannot be unit tested under plain Node without a
// shim. This file is that shim: an intentional no-op, never imported by
// application code directly.
export {};
