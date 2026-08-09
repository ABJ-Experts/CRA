import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import ts from "typescript";
import { expect, it } from "vitest";

const ALLOWED = new Set(["app/_lib/http/api-client.ts"]);

function isFetchExpression(node: ts.Expression): boolean {
  if (ts.isIdentifier(node)) return node.text === "fetch";
  return (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === "fetch" &&
    ts.isIdentifier(node.expression) &&
    ["globalThis", "self", "window"].includes(node.expression.text)
  );
}

function hasDirectFetch(fileName: string, source: string): boolean {
  const root = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let found = false;

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && isFetchExpression(node.expression)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(root);
  return found;
}

it("detects fetch calls without matching comments or strings", () => {
  expect(hasDirectFetch("page.ts", "fetch('/api/v1/test')")).toBe(true);
  expect(hasDirectFetch("page.ts", "globalThis.fetch('/api/v1/test')")).toBe(
    true,
  );
  expect(
    hasDirectFetch(
      "page.ts",
      "const example = `fetch('/api/v1/test')`; // fetch('/ignored')",
    ),
  ).toBe(false);
});

it("keeps direct fetch calls inside the central transport", async () => {
  const appRoot = join(process.cwd(), "app");
  const entries = (await readdir(appRoot, { recursive: true })).filter(
    (entry) => /\.tsx?$/.test(entry) && !/\.(?:spec|test)\.tsx?$/.test(entry),
  );
  const violations = (
    await Promise.all(
      entries.map(async (entry) => {
        const relative = `app/${entry.replaceAll("\\", "/")}`;
        const source = await readFile(join(appRoot, entry), "utf8");
        return hasDirectFetch(relative, source) && !ALLOWED.has(relative)
          ? [relative]
          : [];
      }),
    )
  ).flat();

  expect(violations).toEqual([]);
});
