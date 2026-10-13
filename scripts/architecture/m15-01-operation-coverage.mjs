import { readFile, readdir, access } from "node:fs/promises";
import { join, relative } from "node:path";
import ts from "typescript";
import { collectSemanticWorkers } from "./audit-operation-coverage.mjs";

async function* files(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (entry.name.endsWith(".controller.ts")) yield path;
  }
}
function decorators(node) {
  return (ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [])
    .flatMap((d) => ts.isCallExpression(d.expression) && ts.isIdentifier(d.expression.expression)
      ? [{ name: d.expression.expression.text, args: d.expression.arguments }] : []);
}
function paths(node) {
  if (!node) return [""];
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(paths);
  if (ts.isStringLiteralLike(node)) return [node.text];
  throw new Error("Licence operation coverage requires literal route paths");
}
export async function collectLicenceRoutes(root) {
  const result = [];
  for await (const path of files(join(root, "apps/api/src"))) {
    const source = ts.createSourceFile(path, await readFile(path, "utf8"), ts.ScriptTarget.Latest, true);
    for (const declaration of source.statements) {
      if (!ts.isClassDeclaration(declaration) || !declaration.name) continue;
      const controller = decorators(declaration).find((d) => d.name === "Controller");
      if (!controller) continue;
      for (const method of declaration.members) {
        if (!ts.isMethodDeclaration(method) || !method.name) continue;
        const all = decorators(method);
        for (const route of all.filter((d) => ["Get", "Post", "Put", "Patch", "Delete", "Head", "Options", "All"].includes(d.name))) {
          for (const base of paths(controller.args[0])) for (const suffix of paths(route.args[0])) {
            const file = relative(root, path).replaceAll("\\", "/");
            const controllerName = declaration.name.text;
            const handler = method.name.getText(source);
            result.push({ id: `${file}#${controllerName}.${handler}:${route.name.toUpperCase()}:${[base, suffix].filter(Boolean).join("/")}`,
              controller: controllerName, handler, mutation: !["Get", "Head", "Options"].includes(route.name),
              public: all.some((d) => d.name === "Public"), evidence: file, symbol: handler });
          }
        }
      }
    }
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}
export async function verifyLicenceOperationCoverage(root) {
  let register;
  try { register = JSON.parse(await readFile(join(root, "docs/architecture/m15-01-operation-register.json"), "utf8")); }
  catch { return ["[licence-coverage] missing or invalid operation register"]; }
  const errors = [];
  const routes = await collectLicenceRoutes(root);
  const workers = await collectSemanticWorkers(root);
  const kinds = new Set(["customer", "evidence", "security", "protective", "renewal", "regulatory", "mixed", "source", "admission-finalization"]);
  for (const [section, expected] of [["routes", routes.map((r) => r.id)], ["workers", workers]]) {
    const seen = new Set();
    for (const entry of register[section] ?? []) {
      if (seen.has(entry.id)) errors.push(`[licence-coverage] duplicate ${entry.id}`);
      seen.add(entry.id);
      if (!kinds.has(entry.kind)) errors.push(`[licence-coverage] unknown kind ${entry.id}`);
      if (["customer", "mixed", "source", "regulatory", "admission-finalization"].includes(entry.kind) && !entry.capability)
        errors.push(`[licence-coverage] capability missing ${entry.id}`);
      if (!entry.reason || !entry.authority || !entry.evidence || !entry.symbol) errors.push(`[licence-coverage] evidence missing ${entry.id}`);
      try {
        await access(join(root, entry.evidence));
        const content = await readFile(join(root, entry.evidence), "utf8");
        if (!content.includes(entry.symbol)) errors.push(`[licence-coverage] source symbol missing ${entry.id}`);
      } catch { errors.push(`[licence-coverage] evidence unavailable ${entry.id}`); }
      if (!expected.includes(entry.id)) errors.push(`[licence-coverage] stale ${entry.id}`);
    }
    for (const id of expected) if (!seen.has(id)) errors.push(`[licence-coverage] unregistered ${id}`);
  }
  return errors;
}
