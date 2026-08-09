import js from "@eslint/js";
import { globalIgnores } from "eslint/config";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginReact from "eslint-plugin-react";
import globals from "globals";
import pluginNext from "@next/eslint-plugin-next";
import { config as baseConfig } from "./base.js";

/**
 * A custom ESLint configuration for libraries that use Next.js.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const nextJsConfig = [
  ...baseConfig,
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      ...pluginReact.configs.flat.recommended.languageOptions,
      globals: {
        ...globals.serviceworker,
      },
    },
  },
  {
    plugins: {
      "@next/next": pluginNext,
    },
    rules: {
      ...pluginNext.configs.recommended.rules,
      ...pluginNext.configs["core-web-vitals"].rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@repo/ui",
              message:
                "Import shared UI through @repo/ui/<component> subpaths.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression[source.value='@repo/ui']",
          message: "Import shared UI through @repo/ui/<component> subpaths.",
        },
        {
          selector:
            "ImportExpression > TemplateLiteral[expressions.length=0] > TemplateElement[value.raw='@repo/ui']",
          message: "Import shared UI through @repo/ui/<component> subpaths.",
        },
        {
          selector:
            "CallExpression[callee.name='require'][arguments.0.value='@repo/ui']",
          message: "Import shared UI through @repo/ui/<component> subpaths.",
        },
      ],
    },
  },
  {
    plugins: {
      "react-hooks": pluginReactHooks,
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...pluginReactHooks.configs.recommended.rules,
      // React scope no longer necessary with new JSX transform.
      "react/react-in-jsx-scope": "off",
    },
  },
];
