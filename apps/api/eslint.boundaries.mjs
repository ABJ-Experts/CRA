import tseslint from "typescript-eslint";
import { nestBoundaries } from "@repo/eslint-config/nest-boundaries";

/**
 * Standalone module-boundary guardrail for the Nest API. The Nest-generated
 * eslint.config.mjs is left untouched; the `lint` script runs this as a second
 * `eslint --config` pass. It enforces that cross-module imports go ONLY through
 * each module's public index.ts barrel (boundaries/dependencies, severity error),
 * so `turbo run lint` fails the build on a violation.
 *
 * It is a SECOND pass rather than extra rules on the first because
 * `@repo/eslint-config/base` loads eslint-plugin-only-warn, which would
 * downgrade the "error" below to a warning and stop it failing anything.
 */
export default tseslint.config(
  { ignores: ["dist/**", "coverage/**"] },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { sourceType: "module" },
    },
  },
  ...nestBoundaries(),
);
