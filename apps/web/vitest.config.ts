import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  test: {
    include: [
      "app/**/*.spec.{ts,tsx}",
      "middleware.spec.ts",
      "mocks/**/*.spec.ts",
    ],
    environment: "node",
    coverage: {
      provider: "v8",
      include: [
        "app/_features/session/**/*.{ts,tsx}",
        "app/_providers/session-provider.tsx",
      ],
      exclude: ["**/*.spec.{ts,tsx}"],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});
