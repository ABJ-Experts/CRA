import { readFile, readdir, access } from "node:fs/promises";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const METHODS = new Set(["Post", "Patch", "Put", "Delete"]);
const AUTHORITIES = new Set([
  "transactional-audit",
  "external-intent",
  "job-history",
  "best-effort",
  "read-only-command",
  "legacy-unverified",
]);
// These routes have an explicit availability compatibility exception. Their
// database-owned state transitions still have transactional writers; the
// response-level security event can degrade and readiness reports that gap.
const BEST_EFFORT_COMPAT_ROUTES = new Set([
  "apps/api/src/auth/auth.controller.ts#AuthController.refreshJson:POST:auth/refresh",
  "apps/api/src/auth/auth.controller.ts#AuthController.signIn:POST:auth/sign-in",
  "apps/api/src/auth/auth.controller.ts#AuthController.unlock:POST:auth/unlock",
  "apps/api/src/auth/mfa/mfa.controller.ts#MfaController.verifyTwoFactor:POST:auth/two-factor/verify",
]);

async function* filesUnder(directory, suffix) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* filesUnder(path, suffix);
    else if (entry.isFile() && entry.name.endsWith(suffix)) yield path;
  }
}

function decoratorCall(node) {
  if (!ts.isCallExpression(node.expression)) return null;
  const expression = node.expression.expression;
  if (!ts.isIdentifier(expression)) return null;
  return { name: expression.text, args: node.expression.arguments };
}

function routePath(argument, source) {
  if (!argument) return "";
  if (ts.isStringLiteralLike(argument)) return argument.text;
  return argument.getText(source);
}

export async function collectMutationRoutes(rootDir) {
  const ids = [];
  for await (const path of filesUnder(
    join(rootDir, "apps/api/src"),
    ".controller.ts",
  )) {
    const content = await readFile(path, "utf8");
    const source = ts.createSourceFile(
      path,
      content,
      ts.ScriptTarget.Latest,
      true,
    );
    const file = relative(rootDir, path).replaceAll("\\", "/");
    for (const statement of source.statements) {
      if (!ts.isClassDeclaration(statement)) continue;
      const className = statement.name?.text;
      if (!className) continue;
      const classDecorators = ts.canHaveDecorators(statement)
        ? (ts.getDecorators(statement) ?? [])
        : [];
      const controller = classDecorators
        .map(decoratorCall)
        .find((call) => call?.name === "Controller");
      const basePath = routePath(controller?.args[0], source);
      for (const member of statement.members) {
        if (!ts.isMethodDeclaration(member) || !member.name) continue;
        const name = member.name.getText(source);
        const decorators = ts.canHaveDecorators(member)
          ? (ts.getDecorators(member) ?? [])
          : [];
        for (const decorator of decorators) {
          const call = decoratorCall(decorator);
          if (!call || !METHODS.has(call.name)) continue;
          const methodPath = routePath(call.args[0], source);
          const fullPath = [basePath, methodPath].filter(Boolean).join("/");
          ids.push(
            `${file}#${className}.${name}:${call.name.toUpperCase()}:${fullPath}`,
          );
        }
      }
    }
  }
  return Object.freeze(ids.sort());
}

export async function collectSemanticWorkers(rootDir) {
  const paths = [];
  for await (const path of filesUnder(
    join(rootDir, "apps/api/src"),
    "worker.ts",
  )) {
    const relativePath = relative(rootDir, path).replaceAll("\\", "/");
    if (
      relativePath.includes("/worker/") ||
      relativePath.includes("/ai/") ||
      relativePath.includes("/frameworks/application/")
    ) {
      paths.push(relativePath);
    }
  }
  return Object.freeze(paths.sort());
}

async function evidenceExists(rootDir, evidence) {
  if (
    typeof evidence !== "string" ||
    !evidence ||
    evidence.startsWith("/") ||
    evidence.includes("..")
  )
    return false;
  try {
    await access(join(rootDir, evidence));
    return true;
  } catch {
    return false;
  }
}

async function sourceSymbolExists(rootDir, authority) {
  if (
    typeof authority.symbol !== "string" ||
    !/^[A-Za-z_][A-Za-z0-9_.:-]{2,149}$/.test(authority.symbol) ||
    !(await evidenceExists(rootDir, authority.evidence))
  ) return false;
  try {
    const source = await readFile(join(rootDir, authority.evidence), "utf8");
    return source.includes(authority.symbol);
  } catch {
    return false;
  }
}

export async function verifyAuditOperationCoverage(rootDir) {
  const registryPath = join(
    rootDir,
    "docs/architecture/m13-01-operation-register.json",
  );
  let registry;
  try {
    registry = JSON.parse(await readFile(registryPath, "utf8"));
  } catch {
    return ["[audit-coverage] missing or invalid operation register"];
  }
  const errors = [];
  const routeIds = await collectMutationRoutes(rootDir);
  const discovered = new Set(routeIds);
  const registered = new Map();
  for (const route of registry.routes ?? []) {
    const count = registered.get(route.id) ?? 0;
    registered.set(route.id, count + 1);
    if (count)
      errors.push(`[audit-coverage] duplicate registration: ${route.id}`);
    if (!Array.isArray(route.authority) || route.authority.length !== 1) {
      errors.push(
        `[audit-coverage] exactly one authority required: ${route.id}`,
      );
      continue;
    }
    const authority = route.authority[0];
    if (!AUTHORITIES.has(authority.kind)) {
      errors.push(`[audit-coverage] unknown authority kind: ${route.id}`);
    }
    if (authority.kind === "legacy-unverified") {
      errors.push(`[audit-coverage] unresolved audit authority: ${route.id}`);
    }
    if (
      authority.kind === "best-effort" &&
      !BEST_EFFORT_COMPAT_ROUTES.has(route.id)
    ) {
      errors.push(
        `[audit-coverage] unapproved best-effort authority: ${route.id}`,
      );
    }
    if (!(await evidenceExists(rootDir, authority.evidence))) {
      errors.push(`[audit-coverage] missing evidence: ${route.id}`);
    }
    if (!(await sourceSymbolExists(rootDir, authority))) {
      errors.push(`[audit-coverage] missing source symbol: ${route.id}`);
    }
  }
  for (const id of routeIds) {
    if (!registered.has(id))
      errors.push(`[audit-coverage] unregistered mutation: ${id}`);
  }
  for (const id of registered.keys()) {
    if (!discovered.has(id))
      errors.push(`[audit-coverage] stale registration: ${id}`);
  }
  const workerPaths = new Set(await collectSemanticWorkers(rootDir));
  const workerIds = new Set(
    (registry.workers ?? []).map((worker) => worker.id),
  );
  for (const path of workerPaths) {
    if (!workerIds.has(path))
      errors.push(`[audit-coverage] unregistered worker: ${path}`);
  }
  for (const id of workerIds) {
    if (!workerPaths.has(id))
      errors.push(`[audit-coverage] stale worker registration: ${id}`);
  }
  for (const section of ["workers", "rpcs"]) {
    const seen = new Set();
    for (const entry of registry[section] ?? []) {
      if (seen.has(entry.id))
        errors.push(`[audit-coverage] duplicate registration: ${entry.id}`);
      seen.add(entry.id);
      if (!Array.isArray(entry.authority) || entry.authority.length !== 1) {
        errors.push(
          `[audit-coverage] exactly one authority required: ${entry.id}`,
        );
        continue;
      }
      if (!AUTHORITIES.has(entry.authority[0].kind))
        errors.push(`[audit-coverage] unknown authority kind: ${entry.id}`);
      if (entry.authority[0].kind === "legacy-unverified")
        errors.push(`[audit-coverage] unresolved audit authority: ${entry.id}`);
      if (entry.authority[0].kind === "best-effort")
        errors.push(
          `[audit-coverage] unapproved best-effort authority: ${entry.id}`,
        );
      if (!(await evidenceExists(rootDir, entry.authority[0].evidence)))
        errors.push(`[audit-coverage] missing evidence: ${entry.id}`);
      if (!(await sourceSymbolExists(rootDir, entry.authority[0])))
        errors.push(`[audit-coverage] missing source symbol: ${entry.id}`);
    }
  }
  return Object.freeze(errors);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const errors = await verifyAuditOperationCoverage(process.cwd());
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  }
}
