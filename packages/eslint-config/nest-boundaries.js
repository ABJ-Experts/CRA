import { createConfig, recommended } from "eslint-plugin-boundaries/config";

/**
 * Public-barrel guardrail for Nest apps (eslint-plugin-boundaries 7.1).
 *
 * - Every folder under src/ is a "module" element (folder semantics: all nested
 *   files belong to it). Files directly in src/ (main.ts, app.module.ts) do NOT
 *   match `src/*`, so they stay unclassified and are never checked.
 * - Cross-module imports are allowed ONLY through the target module's index.ts.
 * - Intra-module deep imports stay allowed automatically: boundaries/dependencies
 *   `checkInternals` defaults to false, so same-element deps are skipped.
 * - External npm (@nestjs/*, drizzle-orm, ...) and node core are skipped by
 *   default (checkAllOrigins defaults false), so `default: "disallow"` does not
 *   block package imports.
 *
 * Uses the current `boundaries/dependencies` rule — `element-types` and
 * `entry-point` are deprecated in v7.
 *
 * IMPORTANT: this config is deliberately NOT composed with
 * `@repo/eslint-config/base`. That config loads `eslint-plugin-only-warn`,
 * which downgrades every rule to a warning — including the "error" severity
 * below. The guardrail would still appear in the output and stop failing the
 * build. Run it as its own pass:
 *
 *   eslint --config eslint.boundaries.mjs "src/**\/*.ts"
 */
export function nestBoundaries() {
  const boundaries = createConfig({
    settings: {
      ...recommended.settings,
      "boundaries/elements": [{ type: "module", pattern: "src/*", capture: ["moduleName"] }],
      // Let tests reach into internals; don't classify specs as modules.
      "boundaries/ignore": ["**/*.spec.ts", "**/*.e2e-spec.ts"],
    },
    rules: {
      ...recommended.rules,
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          policies: [
            {
              // module -> module only via the public barrel
              from: { element: { type: "module" } },
              allow: {
                to: { element: { type: "module", fileInternalPath: "index.ts" } },
              },
              message:
                "Cross-module imports must go through the target module's public index.ts barrel; deep-importing another module's internals is not allowed.",
            },
          ],
        },
      ],
    },
  });

  // `import/resolver` is NOT a boundaries/* key; createConfig throws if settings
  // has any non-boundaries key, so the resolver lives in its own flat-config object.
  const resolver = {
    files: ["**/*.ts"],
    settings: {
      "import/resolver": {
        typescript: { alwaysTryTypes: true, project: "./tsconfig.json" },
      },
    },
  };

  return [resolver, boundaries];
}

export default nestBoundaries;
