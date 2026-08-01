import globals from "globals";
import { config as baseConfig } from "./base.js";

/**
 * A shared ESLint configuration for Node.js server applications.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const nodeConfig = [
  ...baseConfig,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["**/*.spec.ts", "**/*.e2e-spec.ts", "test/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
  },
  {
    // base.js ignores dist/**; Node apps also emit instrumented JS into
    // coverage/, which ESLint would otherwise lint and fail on.
    ignores: ["dist/**", "coverage/**"],
  },
];
