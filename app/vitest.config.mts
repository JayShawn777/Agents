import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/unit/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["tests/e2e/**", "node_modules/**"],
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "."),
      // `server-only` throws when imported outside Next's RSC compilation
      // step (see tests/unit/mocks/server-only.ts for why this exists).
      "server-only": resolve(import.meta.dirname, "./tests/unit/mocks/server-only.ts"),
    },
  },
});
