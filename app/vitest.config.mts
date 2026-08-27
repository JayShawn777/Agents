import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/**
 * `environment: "node"` is the DEFAULT (previously `jsdom` globally), per
 * ADR-0006/plan §6: almost everything under test here is server code (route
 * handlers, the DAL, zod schemas, config) that never touches `window` or
 * `document`, and running it under `jsdom` silently changed behaviour for
 * any module that branches on `typeof window` — see
 * `lib/config.ts`'s `resolveConsentMethod()`, which returned an inert
 * client-side placeholder in every test instead of ever exercising the
 * real, server-side `CONSENT_METHOD` branch production actually runs.
 *
 * A test that needs a DOM (a future React component test under
 * `tests/unit/components/**`) opts in per-file with a Vitest environment
 * pragma as the FIRST line of the file, before any import:
 *
 *   // @vitest-environment jsdom
 *
 * No test currently needs this — there are no component tests yet — but
 * the `jsdom` dependency and the `react()` plugin stay configured for when
 * one is added.
 */
const shared = {
  environment: "node" as const,
  globals: true,
  setupFiles: ["./vitest.setup.ts"],
  exclude: ["tests/e2e/**", "node_modules/**"],
};

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        plugins: [react()],
        test: {
          ...shared,
          name: "unit",
          include: ["tests/unit/**/*.{test,spec}.{ts,tsx}"],
        },
        resolve: { alias: sharedAlias() },
      },
      {
        plugins: [react()],
        test: {
          ...shared,
          name: "integration",
          include: ["tests/integration/**/*.{test,spec}.{ts,tsx}"],
          // Integration tests share ONE local Postgres. Run in parallel they
          // corrupt each other's connection state — Postgres returns
          // `08P01: bind message supplies N parameters, but prepared statement
          // "" requires 0`, which reads like a client bug and is not one.
          //
          // This was dismissed twice as a transient timeout "under load"
          // before the Stop hook caught it as a hard failure. It was never
          // transient; it was two files reaching the same connection at once.
          fileParallelism: false,
          maxConcurrency: 1,
        },
        resolve: { alias: sharedAlias() },
      },
    ],
  },
  resolve: { alias: sharedAlias() },
});

function sharedAlias() {
  return {
    "@": resolve(import.meta.dirname, "."),
    // `server-only` throws when imported outside Next's RSC compilation
    // step (see tests/unit/mocks/server-only.ts for why this exists).
    "server-only": resolve(import.meta.dirname, "./tests/unit/mocks/server-only.ts"),
  };
}
