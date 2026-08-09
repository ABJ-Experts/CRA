import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

import { findDesignRuleViolations } from "./design-rules";

const IGNORED_DIRECTORIES = new Set([
  ".next",
  ".turbo",
  "coverage",
  "node_modules",
]);

async function findTypeScriptSources(root: string): Promise<readonly string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const sources = await Promise.all(
    entries.map(async (entry): Promise<readonly string[]> => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) {
        return IGNORED_DIRECTORIES.has(entry.name)
          ? []
          : findTypeScriptSources(path);
      }
      return /\.tsx?$/.test(entry.name) &&
        !/\.(?:spec|test)\.tsx?$/.test(entry.name)
        ? [path]
        : [];
    }),
  );

  return Object.freeze(sources.flat().sort());
}

describe("design-system architecture rules", () => {
  it("rejects the UI barrel and raw visual tokens", () => {
    expect(
      findDesignRuleViolations(
        'import { Button } from "@repo/ui";\n<div className="text-sm bg-red-500" />',
      ),
    ).toEqual([
      "Import @repo/ui through a component subpath",
      "Use semantic typography instead of text-sm",
      "Use semantic color tokens instead of bg-red-500",
    ]);
  });

  it("rejects single-quoted barrel imports and deduplicates tokens", () => {
    expect(
      findDesignRuleViolations(
        "import type { ButtonProps } from '@repo/ui';\nconst classes = 'text-xs text-xs border-blue-700';",
      ),
    ).toEqual([
      "Import @repo/ui through a component subpath",
      "Use semantic typography instead of text-xs",
      "Use semantic color tokens instead of border-blue-700",
    ]);
  });

  it("rejects side-effect, dynamic, and CommonJS barrel imports", () => {
    for (const source of [
      'import "@repo/ui";',
      'import {\n  Button,\n  Input,\n} from "@repo/ui";',
      'const ui = await import("@repo/ui");',
      "const ui = await import(`@repo/ui`);",
      'const ui = require("@repo/ui");',
      'export * from "@repo/ui";',
    ]) {
      expect(findDesignRuleViolations(source)).toContain(
        "Import @repo/ui through a component subpath",
      );
    }
  });

  it("does not treat a policy message as an import", () => {
    expect(
      findDesignRuleViolations(
        "const message = 'Import from \"@repo/ui\" through a subpath';",
      ),
    ).toEqual([]);
  });

  it("enforces the UI subpath rule through the web ESLint config", async () => {
    const eslint = new ESLint({ cwd: process.cwd() });
    for (const [source, expectedRule] of [
      [
        'import { Button } from "@repo/ui";\nexport { Button };',
        "no-restricted-imports",
      ],
      [
        'export async function loadUi() { return import("@repo/ui"); }',
        "no-restricted-syntax",
      ],
      [
        "export async function loadUi() { return import(`@repo/ui`); }",
        "no-restricted-syntax",
      ],
      [
        'export function loadUi() { return require("@repo/ui"); }',
        "no-restricted-syntax",
      ],
    ] as const) {
      const [result] = await eslint.lintText(source, {
        filePath: join(process.cwd(), "app/architecture/lint-fixture.ts"),
      });

      expect(
        result?.messages.some(
          (message) =>
            message.ruleId === expectedRule &&
            message.message.includes("@repo/ui/<component>"),
        ),
        JSON.stringify(result?.messages),
      ).toBe(true);
    }
  });

  it("accepts subpath imports and semantic classes", () => {
    expect(
      findDesignRuleViolations(
        'import { Button } from "@repo/ui/button";\n<div className="text-body-regular bg-canvas" />',
      ),
    ).toEqual([]);
  });

  it("keeps web and shared UI sources on semantic tokens and subpaths", async () => {
    const roots = [process.cwd(), join(process.cwd(), "../../packages/ui/src")];
    const sources = (
      await Promise.all(roots.map(findTypeScriptSources))
    ).flat();

    expect(sources).toEqual(
      expect.arrayContaining([
        join(process.cwd(), "app/page.tsx"),
        join(process.cwd(), "middleware.ts"),
        join(process.cwd(), "mocks/handlers.ts"),
        join(process.cwd(), "vitest.config.ts"),
        join(process.cwd(), "../../packages/ui/src/index.ts"),
      ]),
    );

    const violations = (
      await Promise.all(
        sources.map(async (path) => {
          const source = await readFile(path, "utf8");
          return findDesignRuleViolations(source).map(
            (violation) => `${path}: ${violation}`,
          );
        }),
      )
    ).flat();

    expect(violations).toEqual([]);
  });
});
