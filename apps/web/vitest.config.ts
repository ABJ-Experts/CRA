import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["app/**/*.spec.{ts,tsx}", "middleware.spec.ts", "mocks/**/*.spec.ts"],
    environment: "node",
  },
});
