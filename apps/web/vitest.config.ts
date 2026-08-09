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
      reporter: ["text", "json-summary", "lcov"],
      include: ["app/**/*.{ts,tsx}", "middleware.ts", "mocks/**/*.ts"],
      exclude: [
        "**/*.d.ts",
        "**/*.{spec,test}.{ts,tsx}",
        ".next/**",
        "app/**/test/**",
      ],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});
