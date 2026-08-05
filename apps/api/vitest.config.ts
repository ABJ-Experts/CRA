import { defineConfig } from 'vitest/config';

// BRD §23: Vitest for unit + integration. Integration tests hit a REAL Postgres
// with RLS active (never mock the DB for an authorisation test).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts', 'test/**/*.{test,spec}.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    setupFiles: ['reflect-metadata'],
    // Integration specs each open a DB pool; run files sequentially so concurrent
    // pools can't exhaust Postgres connections (each file's pool closes first).
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      // §23: "80 percent on domain logic". Scoped to the domain deliberately —
      // controllers, modules and bootstrap are thin wiring, and including them
      // lets a high number hide thin coverage of the logic that matters.
      include: [
        'src/triage/triage.service.ts',
        'src/vuln/matching.service.ts',
        'src/vuln/reevaluate.service.ts',
        'src/vuln/feeds/normalise.ts',
        'src/workflow/obligation-clock.ts',
        'src/workflow/obligation-tick.ts',
        'src/workflow/obligation.service.ts',
        'src/product/product.service.ts',
        'src/sbom/sbom.service.ts',
        'src/audit/audit.service.ts',
      ],
      thresholds: { lines: 80, functions: 80, statements: 80 },
    },
  },
});
