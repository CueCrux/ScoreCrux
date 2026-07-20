import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "benchmarks/**/tests/**/*.test.ts"],
    // Coding fixture tests (benchmarks/coding/fixtures/**) import a
    // sandbox-runtime-only `solution.js`; they run inside the sandbox, never as
    // repo unit tests. Keep the vitest defaults we still rely on alongside.
    exclude: ["**/node_modules/**", "**/dist/**", "**/fixtures/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
});
