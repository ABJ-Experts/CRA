import { defineConfig } from "vitest/config";
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    maxWorkers: 2,
    include: ["app/**/*.spec.{ts,tsx}"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      include: [
        "app/operator-{gateway,console,tables}.{ts,tsx}",
        "app/backups-{gateway,runs,workbench}.{ts,tsx}",
      ],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
});
