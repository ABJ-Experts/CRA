import { defineConfig } from "vitest/config";

// §23: "Unit | Vitest | 80 percent on domain logic". This package IS domain
// logic — the version comparators, the matching engine and the golden dataset —
// so the whole of src counts, minus the fixtures that exist to test it.
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.spec.ts", "src/golden/corpus.ts", "src/index.ts"],
      thresholds: { lines: 80, functions: 80, statements: 80 },
    },
  },
});
