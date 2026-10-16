import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { exportSources } from "@repo/contracts/exports";
import { describe, expect, it } from "vitest";
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? files(path)
      : entry.name.endsWith(".tsx") && !entry.name.includes(".spec.")
        ? [path]
        : [];
  });
}
function bindings() {
  const result: { path: string; source: string; columns: string[] }[] = [];
  for (const path of files(join(process.cwd(), "app"))) {
    const file = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    function visit(node: ts.Node) {
      if (
        (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
        [
          "ExportControls",
          "MemberExportControls",
          "PortalExportControls",
        ].includes(node.tagName.getText(file))
      ) {
        const source = node.attributes.properties.find(
          (attribute) =>
            ts.isJsxAttribute(attribute) &&
            attribute.name.getText(file) === "source",
        );
        const columns = node.attributes.properties.find(
          (attribute) =>
            ts.isJsxAttribute(attribute) &&
            attribute.name.getText(file) === "columns",
        );
        if (
          source &&
          ts.isJsxAttribute(source) &&
          source.initializer &&
          ts.isStringLiteral(source.initializer)
        ) {
          const keys =
            columns &&
            ts.isJsxAttribute(columns) &&
            columns.initializer &&
            ts.isJsxExpression(columns.initializer) &&
            columns.initializer.expression &&
            ts.isArrayLiteralExpression(columns.initializer.expression)
              ? columns.initializer.expression.elements
                  .filter(ts.isStringLiteral)
                  .map((value) => value.text)
              : [];
          result.push({ path, source: source.initializer.text, columns: keys });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
  }
  return result;
}
describe("Production export bindings", () => {
  it("covers every registered production source, including scoped portal views", () => {
    const bound = new Set(bindings().map((binding) => binding.source));
    expect(Object.keys(exportSources).filter((source) => !bound.has(source))).toEqual([]);
  });
  it("includes CI release bindings and the selected binding build history", () => {
    const actual = new Set(bindings().map((binding) => binding.source));
    expect(actual.has("sboms.ci_bindings")).toBe(true);
    expect(actual.has("sboms.ci_binding_runs")).toBe(true);
  });
  it("covers rendered connector lists and framework lists", () => {
    const bound = new Set(bindings().map((binding) => binding.source));
    const rendered = [
      "connectors.overview",
      "connectors.catalogue",
      "connectors.sync_runs",
      "connectors.sync_history",
      "connectors.sync_records",
      "connectors.sync_plan_items",
      "connectors.dead_letter_records",
      "connectors.run_conflicts",
      "connectors.sync_run_attempts",
      "connectors.agent_batches",
      "connectors.webhook_endpoints",
      "connectors.webhook_deliveries",
      "connectors.webhook_attempts",
      "connectors.siem_destinations",
      "connectors.siem_deliveries",
      "sboms.ci_bindings",
      "sboms.ci_binding_runs",
      ...Object.keys(exportSources).filter((source) =>
        source.startsWith("frameworks."),
      ),
    ];
    expect(rendered.filter((source) => !bound.has(source))).toEqual([]);
  });
  it("binds only registered sources and explicitly approved columns", () => {
    const failures: string[] = [];
    for (const binding of bindings()) {
      const specification =
        exportSources[binding.source as keyof typeof exportSources];
      if (!specification)
        failures.push(`${binding.path}: unregistered ${binding.source}`);
      else
        for (const key of binding.columns)
          if (!specification.columns.some((column) => column.key === key))
            failures.push(
              `${binding.path}: ${binding.source} unapproved column ${key}`,
            );
    }
    expect(failures).toEqual([]);
  });
});
