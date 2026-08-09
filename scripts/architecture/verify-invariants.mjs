import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

import { PATTERNS } from "./verify-docs.mjs";

const RULE = Object.freeze({
  coreImports: "[core-imports]",
  webFetch: "[web-fetch]",
  tenantServiceRole: "[tenant-service-role]",
  routeAuthorization: "[route-authorization]",
  refreshCookiePath: "[refresh-cookie-path]",
  tokenStrategy: "[token-strategy]",
  sessionEpochSkew: "[session-epoch-skew]",
  mswPassthrough: "[msw-passthrough]",
  menuNavParity: "[menu-nav-parity]",
  patternCatalog: "[pattern-catalog]",
  zodBoundaries: "[zod-boundaries]",
  frontendRendering: "[frontend-rendering]",
});

const GENERATED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);

const ROUTE_DECORATORS = new Map([
  ["Get", "GET"],
  ["Post", "POST"],
  ["Put", "PUT"],
  ["Delete", "DELETE"],
  ["Patch", "PATCH"],
  ["All", "ALL"],
  ["Options", "OPTIONS"],
  ["Head", "HEAD"],
]);

const AUTHORIZATION_DECORATORS = new Set([
  "Public",
  "RequirePermissions",
  "RequireRole",
  "SelfScoped",
]);

function parseTypeScript(fileName, source) {
  return ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function visit(node, inspect) {
  inspect(node);
  ts.forEachChild(node, (child) => visit(child, inspect));
}

function nodesWithin(node, predicate) {
  const nodes = [];
  visit(node, (candidate) => {
    if (predicate(candidate)) nodes.push(candidate);
  });
  return nodes;
}

function unwrapExpression(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function identifierText(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node) || ts.isPropertyAccessChain?.(node)) {
    return node.name.text;
  }
  return null;
}

function propertyNameText(name) {
  if (!name) return null;
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }
  return null;
}

function callName(node) {
  return ts.isCallExpression(node) ? identifierText(node.expression) : null;
}

function stringLiteralValue(node) {
  if (!node) return null;
  const expression = unwrapExpression(node);
  return ts.isStringLiteralLike(expression) ? expression.text : null;
}

function stringLiteralsWithin(node) {
  return new Set(
    nodesWithin(node, (candidate) => ts.isStringLiteralLike(candidate)).map(
      (candidate) => candidate.text,
    ),
  );
}

function findVariableInitializer(sourceFile, variableName) {
  let initializer = null;
  visit(sourceFile, (node) => {
    if (
      initializer === null &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === variableName &&
      node.initializer
    ) {
      initializer = node.initializer;
    }
  });
  return initializer;
}

function findClass(sourceFile, className) {
  return nodesWithin(
    sourceFile,
    (node) => ts.isClassDeclaration(node) && node.name?.text === className,
  )[0];
}

function findMethod(classNode, methodName) {
  return classNode?.members.find(
    (member) =>
      ts.isMethodDeclaration(member) &&
      propertyNameText(member.name) === methodName,
  );
}

function hasCall(sourceFile, name) {
  return (
    nodesWithin(
      sourceFile,
      (node) => ts.isCallExpression(node) && callName(node) === name,
    ).length > 0
  );
}

function hasNewExpression(sourceFile, name) {
  return (
    nodesWithin(
      sourceFile,
      (node) =>
        ts.isNewExpression(node) && identifierText(node.expression) === name,
    ).length > 0
  );
}

function isTestFile(relativePath) {
  return /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(relativePath);
}

function displayPath(rootDir, absolutePath) {
  return relative(rootDir, absolutePath).replaceAll("\\", "/");
}

async function listSourceFiles(rootDir, relativeDirectory) {
  const directory = join(rootDir, relativeDirectory);
  const output = [];

  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!GENERATED_DIRECTORIES.has(entry.name)) {
          await walk(join(current, entry.name));
        }
        continue;
      }
      if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name)) {
        output.push(join(current, entry.name));
      }
    }
  }

  await walk(directory);
  return output.sort();
}

async function readRequiredAst(rootDir, relativePath, errors, rule) {
  try {
    const source = await readFile(join(rootDir, relativePath), "utf8");
    return parseTypeScript(relativePath, source);
  } catch (error) {
    if (error?.code === "ENOENT") {
      errors.push(`${rule} Missing required invariant source: ${relativePath}`);
      return null;
    }
    throw error;
  }
}

async function readOptionalAst(rootDir, relativePath) {
  try {
    const source = await readFile(join(rootDir, relativePath), "utf8");
    return parseTypeScript(relativePath, source);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function importedModuleSpecifiers(sourceFile) {
  const specifiers = [];
  visit(sourceFile, (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
      return;
    }

    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      specifiers.push(node.moduleReference.expression.text);
      return;
    }

    if (
      ts.isCallExpression(node) &&
      (callName(node) === "require" ||
        node.expression.kind === ts.SyntaxKind.ImportKeyword) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
  });
  return specifiers;
}

function importedBindingModules(sourceFile) {
  const modules = new Map();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !statement.importClause ||
      !ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    if (statement.importClause.name) {
      modules.set(statement.importClause.name.text, specifier);
    }
    const bindings = statement.importClause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      modules.set(bindings.name.text, specifier);
    } else if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        modules.set(element.name.text, specifier);
      }
    }
  }
  return modules;
}

function rootIdentifier(expression) {
  let current = unwrapExpression(expression);
  while (ts.isPropertyAccessExpression(current)) {
    current = unwrapExpression(current.expression);
  }
  return ts.isIdentifier(current) ? current.text : null;
}

function variableInitializers(sourceFile) {
  const initializers = new Map();
  for (const declaration of nodesWithin(sourceFile, ts.isVariableDeclaration)) {
    if (ts.isIdentifier(declaration.name) && declaration.initializer) {
      const declarations = initializers.get(declaration.name.text) ?? [];
      initializers.set(declaration.name.text, [
        ...declarations,
        Object.freeze({
          initializer: declaration.initializer,
          scope: variableScope(declaration),
        }),
      ]);
    }
  }
  return initializers;
}

function isLexicalScope(node) {
  return (
    ts.isSourceFile(node) ||
    ts.isBlock(node) ||
    ts.isModuleBlock(node) ||
    ts.isCaseBlock(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isCatchClause(node)
  );
}

function enclosingLexicalScope(node) {
  let current = node.parent;
  while (current && !isLexicalScope(current)) current = current.parent;
  return current ?? node.getSourceFile();
}

function enclosingFunctionScope(node) {
  let current = node.parent;
  while (current && !ts.isSourceFile(current)) {
    if (ts.isFunctionLike(current)) return current;
    current = current.parent;
  }
  return current ?? node.getSourceFile();
}

function variableScope(declaration) {
  const declarationList = declaration.parent;
  const isBlockScoped =
    ts.isVariableDeclarationList(declarationList) &&
    (declarationList.flags & ts.NodeFlags.BlockScoped) !== 0;
  return isBlockScoped
    ? enclosingLexicalScope(declaration)
    : enclosingFunctionScope(declaration);
}

function scopeContains(scope, node) {
  let current = node;
  while (current) {
    if (current === scope) return true;
    current = current.parent;
  }
  return false;
}

function scopeDepth(scope) {
  let depth = 0;
  let current = scope;
  while (current.parent) {
    depth += 1;
    current = current.parent;
  }
  return depth;
}

function visibleVariable(identifier, variables) {
  const candidates = (variables.get(identifier.text) ?? []).filter(
    ({ scope }) => scopeContains(scope, identifier),
  );
  if (candidates.length === 0) return null;
  const deepest = Math.max(...candidates.map(({ scope }) => scopeDepth(scope)));
  const matches = candidates.filter(
    ({ scope }) => scopeDepth(scope) === deepest,
  );
  return matches.length === 1 ? matches[0] : null;
}

function inspectableObjectProperties(expression, variables, seen = new Set()) {
  if (!expression) return null;
  const node = unwrapExpression(expression);
  if (ts.isIdentifier(node)) {
    const variable = visibleVariable(node, variables);
    if (!variable || seen.has(variable)) return null;
    return variable.initializer
      ? inspectableObjectProperties(
          variable.initializer,
          variables,
          new Set([...seen, variable]),
        )
      : null;
  }
  if (!ts.isObjectLiteralExpression(node)) return null;

  const properties = new Map();
  for (const property of node.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spread = inspectableObjectProperties(
        property.expression,
        variables,
        seen,
      );
      if (!spread) return null;
      for (const [key, value] of spread) properties.set(key, value);
      continue;
    }
    if (ts.isPropertyAssignment(property)) {
      const key = propertyNameText(property.name);
      if (!key) return null;
      properties.set(key, property.initializer);
      continue;
    }
    if (ts.isShorthandPropertyAssignment(property)) {
      properties.set(property.name.text, property.name);
      continue;
    }
    return null;
  }
  return properties;
}

function isSharedContractReference(
  expression,
  imports,
  variables = new Map(),
  seen = new Set(),
) {
  if (!expression) return false;
  const node = unwrapExpression(expression);
  const identifier = rootIdentifier(node);
  const specifier = identifier ? imports.get(identifier) : undefined;
  if (
    specifier === "@repo/contracts" ||
    specifier?.startsWith("@repo/contracts/")
  ) {
    return true;
  }
  if (ts.isIdentifier(node)) {
    const variable = visibleVariable(node, variables);
    if (!variable || seen.has(variable)) return false;
    return variable.initializer
      ? isSharedContractReference(
          variable.initializer,
          imports,
          variables,
          new Set([...seen, variable]),
        )
      : false;
  }
  if (ts.isCallExpression(node)) {
    if (isSharedContractReference(node.expression, imports, variables, seen)) {
      return true;
    }
    return (
      callName(node) === "useMemo" &&
      isSharedContractReference(node.arguments[0], imports, variables, seen)
    );
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    if (!ts.isBlock(node.body)) {
      return isSharedContractReference(node.body, imports, variables, seen);
    }
    return nodesWithin(node.body, ts.isReturnStatement).some((statement) =>
      isSharedContractReference(statement.expression, imports, variables, seen),
    );
  }
  return false;
}

function reportNonSharedSchema(sourceFile, relativePath, expression, errors) {
  const line = sourceFile.getLineAndCharacterOfPosition(
    expression.getStart(sourceFile),
  ).line;
  errors.push(
    `${RULE.zodBoundaries} ${relativePath}:${line + 1} must import its schema from @repo/contracts`,
  );
}

function forbiddenProvider(specifier) {
  const lower = specifier.toLowerCase();
  if (lower === "express" || lower.startsWith("express/")) return "Express";
  if (lower === "jose" || lower.startsWith("jose/")) return "jose";
  if (lower === "nodemailer" || lower.startsWith("nodemailer/")) {
    return "Nodemailer";
  }
  if (lower === "@nestjs" || lower.startsWith("@nestjs/")) return "NestJS";
  if (lower === "@supabase" || lower.startsWith("@supabase/")) {
    return "Supabase";
  }
  if (/(^|[/.-])supabase([/.-]|$)/.test(lower)) return "Supabase";
  return null;
}

async function verifyCoreImports(rootDir, errors) {
  const files = await listSourceFiles(rootDir, "apps/api/src");
  for (const absolutePath of files) {
    const relativePath = displayPath(rootDir, absolutePath);
    if (
      isTestFile(relativePath) ||
      (!relativePath.includes("/application/") &&
        !relativePath.includes("/domain/"))
    ) {
      continue;
    }
    const source = await readFile(absolutePath, "utf8");
    const sourceFile = parseTypeScript(relativePath, source);
    for (const specifier of importedModuleSpecifiers(sourceFile)) {
      const provider = forbiddenProvider(specifier);
      if (provider) {
        errors.push(
          `${RULE.coreImports} ${relativePath} imports ${provider} provider ${JSON.stringify(specifier)}`,
        );
      }
    }
  }
}

function isDirectFetchExpression(expression) {
  const target = unwrapExpression(expression);
  if (ts.isIdentifier(target)) return target.text === "fetch";
  return (
    ts.isPropertyAccessExpression(target) &&
    target.name.text === "fetch" &&
    ts.isIdentifier(target.expression) &&
    ["globalThis", "self", "window"].includes(target.expression.text)
  );
}

async function verifyWebFetch(rootDir, errors) {
  const allowed = new Set(["apps/web/app/_lib/http/api-client.ts"]);
  const files = await listSourceFiles(rootDir, "apps/web/app");
  for (const absolutePath of files) {
    const relativePath = displayPath(rootDir, absolutePath);
    if (isTestFile(relativePath) || allowed.has(relativePath)) continue;
    const source = await readFile(absolutePath, "utf8");
    const sourceFile = parseTypeScript(relativePath, source);
    const directFetch = nodesWithin(
      sourceFile,
      (node) =>
        ts.isCallExpression(node) && isDirectFetchExpression(node.expression),
    )[0];
    if (directFetch) {
      const line = sourceFile.getLineAndCharacterOfPosition(
        directFetch.getStart(sourceFile),
      ).line;
      errors.push(
        `${RULE.webFetch} ${relativePath}:${line + 1} calls fetch outside the central transport`,
      );
    }
  }
}

function zodConstructorName(node) {
  if (!ts.isCallExpression(node)) return null;
  const expression = unwrapExpression(node.expression);
  if (
    !ts.isPropertyAccessExpression(expression) ||
    !ts.isIdentifier(expression.expression) ||
    expression.expression.text !== "z"
  ) {
    return null;
  }
  return expression.name.text;
}

async function verifyLocalWireSchemas(rootDir, errors) {
  const roots = ["apps/api/src", "apps/web/app"];
  for (const sourceRoot of roots) {
    const files = await listSourceFiles(rootDir, sourceRoot);
    for (const absolutePath of files) {
      const relativePath = displayPath(rootDir, absolutePath);
      if (
        isTestFile(relativePath) ||
        (!relativePath.endsWith(".controller.ts") &&
          !relativePath.endsWith(".api.ts") &&
          !relativePath.endsWith("auth-actions.ts"))
      ) {
        continue;
      }
      const source = await readFile(absolutePath, "utf8");
      const sourceFile = parseTypeScript(relativePath, source);
      const constructor = nodesWithin(
        sourceFile,
        (node) => zodConstructorName(node) !== null,
      )[0];
      if (!constructor) continue;
      const line = sourceFile.getLineAndCharacterOfPosition(
        constructor.getStart(sourceFile),
      ).line;
      errors.push(
        `${RULE.zodBoundaries} ${relativePath}:${line + 1} declares a wire schema outside @repo/contracts`,
      );
    }
  }
}

async function verifyContractSchemaTypeFolders(rootDir, errors) {
  const contractsRoot = join(rootDir, "packages/contracts/src");
  let entries;
  try {
    entries = await readdir(contractsRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const featureRoot = join(contractsRoot, entry.name);
    const featureEntries = await readdir(featureRoot, { withFileTypes: true });
    const hasSchemas = featureEntries.some(
      (candidate) => candidate.isDirectory() && candidate.name === "schemas",
    );
    const hasTypes = featureEntries.some(
      (candidate) => candidate.isDirectory() && candidate.name === "types",
    );
    if (hasSchemas !== hasTypes) {
      errors.push(
        `${RULE.zodBoundaries} packages/contracts/src/${entry.name} must keep schemas/ and types/ as a pair`,
      );
    }
  }

  const files = await listSourceFiles(rootDir, "packages/contracts/src");
  for (const absolutePath of files) {
    const relativePath = displayPath(rootDir, absolutePath);
    if (isTestFile(relativePath) || !relativePath.includes("/types/")) continue;
    const source = await readFile(absolutePath, "utf8");
    const sourceFile = parseTypeScript(relativePath, source);
    for (const declaration of nodesWithin(
      sourceFile,
      (node) =>
        ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node),
    )) {
      const name = declaration.name?.text ?? "";
      if (!/(?:Input|Output|Response|Params?|Body)$/.test(name)) continue;
      const declaredText = declaration.getText(sourceFile);
      if (
        ts.isInterfaceDeclaration(declaration) ||
        (!declaredText.includes("z.output<") &&
          !declaredText.includes("z.input<"))
      ) {
        errors.push(
          `${RULE.zodBoundaries} ${relativePath}#${name} must derive from z.input or z.output`,
        );
      }
    }
  }
}

function hasDecorator(node, names) {
  return decoratorsOf(node).some((decorator) => {
    const expression = unwrapExpression(decorator.expression);
    return names.has(
      ts.isCallExpression(expression)
        ? identifierText(expression.expression)
        : identifierText(expression),
    );
  });
}

async function verifyControllerZodBoundaries(rootDir, errors) {
  const files = await listSourceFiles(rootDir, "apps/api/src");
  const responseDecorators = new Set(["ZodResponse", "NonJsonResponse"]);
  const parameterParsers = new Map([
    ["Body", "zodBody"],
    ["Query", "zodQuery"],
    ["Param", "zodParams"],
  ]);

  for (const absolutePath of files) {
    const relativePath = displayPath(rootDir, absolutePath);
    if (isTestFile(relativePath) || !relativePath.endsWith(".controller.ts"))
      continue;
    const source = await readFile(absolutePath, "utf8");
    const sourceFile = parseTypeScript(relativePath, source);
    const imports = importedBindingModules(sourceFile);
    const variables = variableInitializers(sourceFile);
    for (const method of nodesWithin(sourceFile, ts.isMethodDeclaration)) {
      const route = decoratorsByName(method).find((decorator) =>
        ROUTE_DECORATORS.has(decorator.name),
      );
      if (!route) continue;
      const methodName = propertyNameText(method.name) ?? "<computed>";
      if (!hasDecorator(method, responseDecorators)) {
        errors.push(
          `${RULE.zodBoundaries} ${relativePath}#${methodName} lacks ZodResponse or NonJsonResponse`,
        );
      }
      const responseDecorator = decoratorsByName(method).find(
        (decorator) => decorator.name === "ZodResponse",
      );
      const responseSchema = responseDecorator?.arguments[0];
      if (
        responseSchema &&
        !isSharedContractReference(responseSchema, imports, variables)
      ) {
        reportNonSharedSchema(sourceFile, relativePath, responseSchema, errors);
      }

      for (const parameter of method.parameters) {
        for (const decorator of decoratorsOf(parameter)) {
          const expression = unwrapExpression(decorator.expression);
          if (!ts.isCallExpression(expression)) continue;
          const boundary = identifierText(expression.expression);
          const expectedParser = parameterParsers.get(boundary);
          if (!expectedParser) continue;
          const parserCall = nodesWithin(
            expression,
            (node) =>
              ts.isCallExpression(node) && callName(node) === expectedParser,
          )[0];
          if (!parserCall) {
            errors.push(
              `${RULE.zodBoundaries} ${relativePath}#${methodName} ${boundary} lacks ${expectedParser}`,
            );
          } else {
            const requestSchema = parserCall.arguments[0];
            if (
              requestSchema &&
              !isSharedContractReference(requestSchema, imports, variables)
            ) {
              reportNonSharedSchema(
                sourceFile,
                relativePath,
                requestSchema,
                errors,
              );
            }
          }
        }
      }
    }
  }
}

async function verifyWebRequestSchemas(rootDir, errors) {
  const files = await listSourceFiles(rootDir, "apps/web/app");
  for (const absolutePath of files) {
    const relativePath = displayPath(rootDir, absolutePath);
    if (isTestFile(relativePath)) continue;
    const source = await readFile(absolutePath, "utf8");
    const sourceFile = parseTypeScript(relativePath, source);
    const imports = importedBindingModules(sourceFile);
    const variables = variableInitializers(sourceFile);
    const isAuthActions = relativePath.endsWith("auth-actions.ts");
    for (const call of nodesWithin(sourceFile, ts.isCallExpression)) {
      const name = callName(call);
      const isTransportCall = [
        "requestJson",
        "authenticatedRequestJson",
      ].includes(name);
      const isAuthActionCall = isAuthActions && name === "post";
      if (!isTransportCall && !isAuthActionCall) continue;
      const options = isAuthActionCall ? call.arguments[2] : call.arguments[0];
      if (!options) continue;
      const properties = inspectableObjectProperties(options, variables);
      if (!properties) {
        const line = sourceFile.getLineAndCharacterOfPosition(
          call.getStart(sourceFile),
        ).line;
        errors.push(
          `${RULE.zodBoundaries} ${relativePath}:${line + 1} must use statically inspectable options`,
        );
        continue;
      }
      const keys = new Set(properties.keys());
      if (isTransportCall && keys.has("body") && !keys.has("inputSchema")) {
        const line = sourceFile.getLineAndCharacterOfPosition(
          call.getStart(sourceFile),
        ).line;
        errors.push(
          `${RULE.zodBoundaries} ${relativePath}:${line + 1} sends a body without inputSchema`,
        );
      }
      if ((isTransportCall && !isAuthActions) || isAuthActionCall) {
        for (const [key, initializer] of properties) {
          if (
            !["schema", "inputSchema"].includes(key) ||
            isSharedContractReference(initializer, imports, variables)
          ) {
            continue;
          }
          reportNonSharedSchema(sourceFile, relativePath, initializer, errors);
        }
      }
    }
  }
}

async function verifyFrontendRendering(rootDir, errors) {
  const files = await listSourceFiles(rootDir, "apps/web/app");
  for (const absolutePath of files) {
    const relativePath = displayPath(rootDir, absolutePath);
    if (
      isTestFile(relativePath) ||
      !relativePath.endsWith(".tsx") ||
      relativePath.endsWith("error-boundary.tsx")
    ) {
      continue;
    }
    const source = await readFile(absolutePath, "utf8");
    const sourceFile = parseTypeScript(relativePath, source);
    const classDeclaration = nodesWithin(sourceFile, ts.isClassDeclaration)[0];
    if (!classDeclaration) continue;
    const line = sourceFile.getLineAndCharacterOfPosition(
      classDeclaration.getStart(sourceFile),
    ).line;
    errors.push(
      `${RULE.frontendRendering} ${relativePath}:${line + 1} keeps logic/rendering in a class; use a plain .ts logic class and functional JSX`,
    );
  }
}

function isPrivateOrProtected(member) {
  return Boolean(
    member.modifiers?.some(
      (modifier) =>
        modifier.kind === ts.SyntaxKind.PrivateKeyword ||
        modifier.kind === ts.SyntaxKind.ProtectedKeyword,
    ),
  );
}

function methodUsesServiceRole(body) {
  return (
    nodesWithin(
      body,
      (node) => ts.isCallExpression(node) && callName(node) === "admin",
    ).length > 0
  );
}

function methodHasExplicitTenantScope(body) {
  return (
    nodesWithin(body, (node) => {
      if (
        ts.isCallExpression(node) &&
        callName(node) === "eq" &&
        stringLiteralValue(node.arguments[0]) === "organization_id"
      ) {
        return true;
      }
      if (ts.isPropertyAssignment(node)) {
        const name = propertyNameText(node.name);
        return name === "organization_id" || name === "p_organization_id";
      }
      return false;
    }).length > 0
  );
}

function firstParameterName(method) {
  const parameter = method.parameters[0];
  return parameter && ts.isIdentifier(parameter.name)
    ? parameter.name.text
    : null;
}

async function verifyTenantServiceRoleMethods(rootDir, errors) {
  const files = await listSourceFiles(rootDir, "apps/api/src");
  for (const absolutePath of files) {
    const relativePath = displayPath(rootDir, absolutePath);
    if (isTestFile(relativePath)) continue;
    const source = await readFile(absolutePath, "utf8");
    const sourceFile = parseTypeScript(relativePath, source);
    for (const method of nodesWithin(sourceFile, ts.isMethodDeclaration)) {
      if (
        !method.body ||
        isPrivateOrProtected(method) ||
        !methodUsesServiceRole(method.body) ||
        !methodHasExplicitTenantScope(method.body)
      ) {
        continue;
      }
      if (firstParameterName(method) !== "orgId") {
        errors.push(
          `${RULE.tenantServiceRole} ${relativePath}#${propertyNameText(method.name) ?? "<computed>"} must take orgId as its first parameter`,
        );
      }
    }
  }
}

function decoratorsOf(node) {
  if (ts.canHaveDecorators(node)) return ts.getDecorators(node) ?? [];
  return [];
}

function decoratorInfo(decorator) {
  const expression = unwrapExpression(decorator.expression);
  if (ts.isCallExpression(expression)) {
    return {
      name: identifierText(expression.expression),
      arguments: [...expression.arguments],
    };
  }
  return { name: identifierText(expression), arguments: [] };
}

function decoratorsByName(node) {
  return decoratorsOf(node)
    .map(decoratorInfo)
    .filter((entry) => entry.name !== null);
}

function hasAuthorizationDecorator(node) {
  return decoratorsByName(node).some((decorator) =>
    AUTHORIZATION_DECORATORS.has(decorator.name),
  );
}

function routePath(decorator) {
  return stringLiteralValue(decorator.arguments[0]) ?? "";
}

function joinRoutePath(...parts) {
  return parts
    .map((part) => part.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

async function declaredRouteExemptions(rootDir) {
  const policy = await readOptionalAst(
    rootDir,
    "apps/api/src/permissions/permission-coverage.spec.ts",
  );
  if (!policy) return new Set();
  const initializer = findVariableInitializer(policy, "AUTH_SELF");
  if (!initializer) return new Set();
  return stringLiteralsWithin(initializer);
}

async function verifyControllerRoutes(rootDir, errors) {
  const exemptions = await declaredRouteExemptions(rootDir);
  const files = (await listSourceFiles(rootDir, "apps/api/src")).filter(
    (file) => file.endsWith(".controller.ts") && !isTestFile(file),
  );
  for (const absolutePath of files) {
    const relativePath = displayPath(rootDir, absolutePath);
    const source = await readFile(absolutePath, "utf8");
    const sourceFile = parseTypeScript(relativePath, source);
    for (const controller of nodesWithin(sourceFile, ts.isClassDeclaration)) {
      const controllerDecorator = decoratorsByName(controller).find(
        (decorator) => decorator.name === "Controller",
      );
      if (!controllerDecorator) continue;
      const classAuthorized = hasAuthorizationDecorator(controller);
      const controllerPath = routePath(controllerDecorator);
      for (const member of controller.members) {
        if (!ts.isMethodDeclaration(member)) continue;
        const route = decoratorsByName(member).find((decorator) =>
          ROUTE_DECORATORS.has(decorator.name),
        );
        if (!route || classAuthorized || hasAuthorizationDecorator(member)) {
          continue;
        }
        const routeKey = `${ROUTE_DECORATORS.get(route.name)} ${joinRoutePath(
          controllerPath,
          routePath(route),
        )}`;
        if (exemptions.has(routeKey)) continue;
        errors.push(
          `${RULE.routeAuthorization} ${relativePath}#${propertyNameText(member.name) ?? "<computed>"} (${routeKey}) lacks Public, RequirePermissions, RequireRole, or SelfScoped`,
        );
      }
    }
  }
}

function constantString(expression, variables, seen = new Set()) {
  const node = unwrapExpression(expression);
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isIdentifier(node)) {
    if (seen.has(node.text)) return null;
    const initializer = variables.get(node.text);
    if (!initializer) return null;
    return constantString(
      initializer,
      variables,
      new Set([...seen, node.text]),
    );
  }
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const span of node.templateSpans) {
      const substitution = constantString(span.expression, variables, seen);
      if (substitution === null) return null;
      value += substitution + span.literal.text;
    }
    return value;
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = constantString(node.left, variables, seen);
    const right = constantString(node.right, variables, seen);
    return left === null || right === null ? null : left + right;
  }
  return null;
}

function topLevelVariables(sourceFile) {
  const variables = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) {
        variables.set(declaration.name.text, declaration.initializer);
      }
    }
  }
  return variables;
}

async function verifyRefreshCookiePath(rootDir, errors) {
  const sourceFile = await readRequiredAst(
    rootDir,
    "apps/api/src/auth/cookies.util.ts",
    errors,
    RULE.refreshCookiePath,
  );
  if (!sourceFile) return;
  const variables = topLevelVariables(sourceFile);
  const initializer = variables.get("REFRESH_COOKIE_PATH");
  const value = initializer ? constantString(initializer, variables) : null;
  if (value !== "/api/v1/auth/refresh") {
    errors.push(
      `${RULE.refreshCookiePath} REFRESH_COOKIE_PATH must resolve to /api/v1/auth/refresh; received ${JSON.stringify(value)}`,
    );
  }
}

function methodStringLiterals(sourceFile, className, methodName) {
  const method = findMethod(findClass(sourceFile, className), methodName);
  return method?.body ? stringLiteralsWithin(method.body) : new Set();
}

function jwtVerifyCalls(sourceFile) {
  return nodesWithin(
    sourceFile,
    (node) => ts.isCallExpression(node) && callName(node) === "jwtVerify",
  );
}

function isKeySource(expression) {
  const node = unwrapExpression(expression);
  if (ts.isIdentifier(node)) return /(?:jwks|key)/i.test(node.text);
  return (
    ts.isPropertyAccessExpression(node) && /(?:jwks|key)/i.test(node.name.text)
  );
}

function remoteJwksVariables(sourceFile) {
  const names = new Set();
  visit(sourceFile, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(unwrapExpression(node.initializer)) &&
      callName(unwrapExpression(node.initializer)) === "createRemoteJWKSet"
    ) {
      names.add(node.name.text);
    }
  });
  return names;
}

function hasJwksVerifierConstruction(sourceFile, jwksVariables) {
  return (
    nodesWithin(
      sourceFile,
      (node) =>
        ts.isNewExpression(node) &&
        identifierText(node.expression) === "JwksTokenVerifierStrategy" &&
        node.arguments?.[0] &&
        ts.isIdentifier(unwrapExpression(node.arguments[0])) &&
        jwksVariables.has(unwrapExpression(node.arguments[0]).text),
    ).length > 0
  );
}

function requireAlgorithm(errors, actual, algorithm, context) {
  if (!actual.has(algorithm)) {
    errors.push(
      `${RULE.tokenStrategy} ${context} no longer routes ${algorithm}`,
    );
  }
}

async function verifyTokenStrategies(rootDir, errors) {
  const selector = await readRequiredAst(
    rootDir,
    "apps/api/src/auth/token-verification/token-strategy-selector.ts",
    errors,
    RULE.tokenStrategy,
  );
  const hs256 = await readRequiredAst(
    rootDir,
    "apps/api/src/auth/token-verification/hs256.strategy.ts",
    errors,
    RULE.tokenStrategy,
  );
  const jwks = await readRequiredAst(
    rootDir,
    "apps/api/src/auth/token-verification/jwks.strategy.ts",
    errors,
    RULE.tokenStrategy,
  );
  const service = await readRequiredAst(
    rootDir,
    "apps/api/src/auth/token-verifier.service.ts",
    errors,
    RULE.tokenStrategy,
  );
  const middleware = await readRequiredAst(
    rootDir,
    "apps/web/middleware.ts",
    errors,
    RULE.tokenStrategy,
  );

  if (selector) {
    const allowed = findVariableInitializer(selector, "ALLOWED_ALGORITHMS");
    const algorithms = allowed ? stringLiteralsWithin(allowed) : new Set();
    for (const algorithm of ["HS256", "ES256", "RS256"]) {
      requireAlgorithm(errors, algorithms, algorithm, "API selector");
    }
    if (
      !hasCall(selector, "select") &&
      !findMethod(findClass(selector, "TokenStrategySelector"), "select")
    ) {
      errors.push(
        `${RULE.tokenStrategy} API strategy selector is missing select()`,
      );
    }
  }

  if (hs256) {
    const supported = methodStringLiterals(
      hs256,
      "Hs256TokenVerifierStrategy",
      "supports",
    );
    requireAlgorithm(errors, supported, "HS256", "HS256 strategy");
    const verified = new Set(
      jwtVerifyCalls(hs256).flatMap((call) => [...stringLiteralsWithin(call)]),
    );
    requireAlgorithm(errors, verified, "HS256", "HS256 verifier allowlist");
  }

  if (jwks) {
    const supported = methodStringLiterals(
      jwks,
      "JwksTokenVerifierStrategy",
      "supports",
    );
    const calls = jwtVerifyCalls(jwks);
    const verified = new Set(
      calls.flatMap((call) => [...stringLiteralsWithin(call)]),
    );
    for (const algorithm of ["ES256", "RS256"]) {
      requireAlgorithm(errors, supported, algorithm, "JWKS strategy");
      requireAlgorithm(errors, verified, algorithm, "JWKS verifier allowlist");
    }
    if (
      !calls.some((call) => call.arguments[1] && isKeySource(call.arguments[1]))
    ) {
      errors.push(
        `${RULE.tokenStrategy} asymmetric verifier must use a JWKS key source`,
      );
    }
  }

  if (service) {
    const remoteVariables = remoteJwksVariables(service);
    if (remoteVariables.size === 0 || !hasCall(service, "createRemoteJWKSet")) {
      errors.push(
        `${RULE.tokenStrategy} API verifier no longer creates a remote JWKS`,
      );
    }
    if (!hasNewExpression(service, "Hs256TokenVerifierStrategy")) {
      errors.push(
        `${RULE.tokenStrategy} API verifier no longer installs HS256 strategy`,
      );
    }
    if (!hasJwksVerifierConstruction(service, remoteVariables)) {
      errors.push(
        `${RULE.tokenStrategy} API verifier no longer installs the JWKS strategy with the remote key source`,
      );
    }
    const selectsStrategy =
      nodesWithin(
        service,
        (node) => ts.isCallExpression(node) && callName(node) === "select",
      ).length > 0;
    if (!selectsStrategy) {
      errors.push(
        `${RULE.tokenStrategy} API verifier no longer delegates through the strategy selector`,
      );
    }
  }

  if (middleware) {
    const inspect = nodesWithin(
      middleware,
      (node) =>
        (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
        propertyNameText(node.name) === "inspectToken",
    )[0];
    const algorithms = inspect ? stringLiteralsWithin(inspect) : new Set();
    for (const algorithm of ["HS256", "ES256", "RS256"]) {
      requireAlgorithm(errors, algorithms, algorithm, "web middleware");
    }
    const remoteVariables = remoteJwksVariables(middleware);
    const routesToRemoteKey = jwtVerifyCalls(middleware).some((call) => {
      const key = call.arguments[1] && unwrapExpression(call.arguments[1]);
      return key && ts.isIdentifier(key) && remoteVariables.has(key.text);
    });
    if (remoteVariables.size === 0 || !routesToRemoteKey) {
      errors.push(
        `${RULE.tokenStrategy} web middleware no longer routes asymmetric tokens through JWKS`,
      );
    }
  }
}

async function verifySessionEpochSkew(rootDir, errors) {
  const sourceFile = await readRequiredAst(
    rootDir,
    "apps/api/src/config/env.validation.ts",
    errors,
    RULE.sessionEpochSkew,
  );
  if (!sourceFile) return;
  const assignments = nodesWithin(
    sourceFile,
    (node) =>
      ts.isPropertyAssignment(node) &&
      propertyNameText(node.name) === "SESSION_EPOCH_SKEW_SECONDS",
  );

  const isZeroLiteral = (expression) => {
    const node = expression && unwrapExpression(expression);
    return Boolean(
      node && ts.isNumericLiteral(node) && Number(node.text) === 0,
    );
  };
  const isStrictZeroComparison = (node) =>
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
    ((ts.isIdentifier(unwrapExpression(node.left)) &&
      isZeroLiteral(node.right)) ||
      (isZeroLiteral(node.left) &&
        ts.isIdentifier(unwrapExpression(node.right))));
  const isFixedZeroSchema = (name) => {
    const initializer = findVariableInitializer(sourceFile, name);
    if (!initializer) return false;
    const calls = nodesWithin(initializer, (node) => ts.isCallExpression(node));
    const hasZeroDefault = calls.some(
      (call) =>
        callName(call) === "default" && isZeroLiteral(call.arguments[0]),
    );
    const hasStrictZeroRefinement = calls.some(
      (call) =>
        callName(call) === "refine" &&
        call.arguments[0] &&
        nodesWithin(call.arguments[0], isStrictZeroComparison).length > 0,
    );
    return hasZeroDefault && hasStrictZeroRefinement;
  };
  const valid = assignments.some((assignment) => {
    const initializer = unwrapExpression(assignment.initializer);
    if (ts.isIdentifier(initializer)) {
      return isFixedZeroSchema(initializer.text);
    }
    return (
      ts.isCallExpression(initializer) &&
      isZeroLiteral(initializer.arguments[0])
    );
  });
  if (assignments.length !== 1 || !valid) {
    errors.push(
      `${RULE.sessionEpochSkew} SESSION_EPOCH_SKEW_SECONDS must have exactly one zero default`,
    );
  }
}

function arrayInitializer(expression) {
  if (!expression) return null;
  const node = unwrapExpression(expression);
  return ts.isArrayLiteralExpression(node) ? node : null;
}

function isApiPassthroughHandler(expression) {
  const node = unwrapExpression(expression);
  if (!ts.isCallExpression(node)) return false;
  const route = stringLiteralValue(node.arguments[0]);
  if (
    !ts.isPropertyAccessExpression(node.expression) ||
    !ts.isIdentifier(node.expression.expression) ||
    node.expression.expression.text !== "http" ||
    node.expression.name.text !== "all" ||
    (route !== "/api/v1/*" && route !== "*/api/v1/*")
  ) {
    return false;
  }
  const callback = node.arguments[1];
  return Boolean(
    callback &&
    nodesWithin(
      callback,
      (candidate) =>
        ts.isCallExpression(candidate) && callName(candidate) === "passthrough",
    ).length > 0,
  );
}

async function verifyMswPassthrough(rootDir, errors) {
  const sourceFile = await readRequiredAst(
    rootDir,
    "apps/web/mocks/handlers.ts",
    errors,
    RULE.mswPassthrough,
  );
  if (!sourceFile) return;
  const handlers = arrayInitializer(
    findVariableInitializer(sourceFile, "handlers"),
  );
  if (
    !handlers ||
    !handlers.elements[0] ||
    !isApiPassthroughHandler(handlers.elements[0])
  ) {
    errors.push(
      `${RULE.mswPassthrough} the /api/v1 passthrough must be the first handlers element`,
    );
  }
}

function objectInitializer(expression) {
  if (!expression) return null;
  const node = unwrapExpression(expression);
  return ts.isObjectLiteralExpression(node) ? node : null;
}

function objectProperty(object, name) {
  return object?.properties.find(
    (property) =>
      ts.isPropertyAssignment(property) &&
      propertyNameText(property.name) === name,
  );
}

function stringArray(expression) {
  const array = arrayInitializer(expression);
  if (!array) return null;
  const values = array.elements.map(stringLiteralValue);
  return values.every((value) => value !== null) ? values : null;
}

function objectKeys(expression) {
  const object = objectInitializer(expression);
  if (!object) return null;
  return object.properties
    .filter(ts.isPropertyAssignment)
    .map((property) => propertyNameText(property.name))
    .filter((name) => name !== null);
}

function menuGroups(expression) {
  const object = objectInitializer(expression);
  if (!object) return null;
  const groups = new Map();
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = propertyNameText(property.name);
    const children = stringArray(property.initializer);
    if (name === null || children === null) return null;
    groups.set(name, children);
  }
  return groups;
}

function navTree(expression) {
  const sections = arrayInitializer(expression);
  if (!sections) return null;
  const keys = [];
  const groups = new Map();
  for (const sectionExpression of sections.elements) {
    const section = objectInitializer(sectionExpression);
    const itemsProperty = objectProperty(section, "items");
    const items = arrayInitializer(itemsProperty?.initializer);
    if (!section || !items) return null;
    for (const itemExpression of items.elements) {
      const item = objectInitializer(itemExpression);
      const keyProperty = objectProperty(item, "menuKey");
      const key = keyProperty && stringLiteralValue(keyProperty.initializer);
      if (!item || key === null) return null;
      keys.push(key);
      const childrenProperty = objectProperty(item, "children");
      if (!childrenProperty) continue;
      const children = arrayInitializer(childrenProperty.initializer);
      if (!children) return null;
      const childKeys = [];
      for (const childExpression of children.elements) {
        const child = objectInitializer(childExpression);
        const childKeyProperty = objectProperty(child, "menuKey");
        const childKey =
          childKeyProperty && stringLiteralValue(childKeyProperty.initializer);
        if (!child || childKey === null) return null;
        childKeys.push(childKey);
        keys.push(childKey);
      }
      groups.set(key, childKeys);
    }
  }
  return { keys, groups };
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function sameStringSet(left, right) {
  return (
    left.length === right.length &&
    left.every((value) => new Set(right).has(value))
  );
}

function sameGroups(left, right) {
  if (left.size !== right.size) return false;
  for (const [key, values] of left) {
    const expected = right.get(key);
    if (
      !expected ||
      values.length !== expected.length ||
      values.some((value, index) => value !== expected[index])
    ) {
      return false;
    }
  }
  return true;
}

async function verifyMenuNavParity(rootDir, errors) {
  const contract = await readRequiredAst(
    rootDir,
    "packages/contracts/src/menu.ts",
    errors,
    RULE.menuNavParity,
  );
  const navigation = await readRequiredAst(
    rootDir,
    "apps/web/app/_components/sidebar/nav-config.tsx",
    errors,
    RULE.menuNavParity,
  );
  if (!contract || !navigation) return;
  const menuKeys = stringArray(findVariableInitializer(contract, "MENU_KEYS"));
  const permissionKeys = objectKeys(
    findVariableInitializer(contract, "MENU_PERMISSION_MAP"),
  );
  const contractGroups = menuGroups(
    findVariableInitializer(contract, "MENU_GROUPS"),
  );
  const nav = navTree(findVariableInitializer(navigation, "NAV"));
  if (!menuKeys || !permissionKeys || !contractGroups || !nav) {
    errors.push(
      `${RULE.menuNavParity} menu or navigation contract is not a statically readable literal`,
    );
    return;
  }

  const menuDuplicates = duplicateValues(menuKeys);
  const navDuplicates = duplicateValues(nav.keys);
  if (menuDuplicates.length > 0) {
    errors.push(
      `${RULE.menuNavParity} duplicate MENU_KEYS: ${menuDuplicates.join(", ")}`,
    );
  }
  if (navDuplicates.length > 0) {
    errors.push(
      `${RULE.menuNavParity} duplicate navigation keys: ${navDuplicates.join(", ")}`,
    );
  }
  if (!sameStringSet(menuKeys, nav.keys)) {
    errors.push(`${RULE.menuNavParity} NAV and MENU_KEYS differ`);
  }
  if (!sameStringSet(menuKeys, permissionKeys)) {
    errors.push(
      `${RULE.menuNavParity} MENU_PERMISSION_MAP and MENU_KEYS differ`,
    );
  }
  if (!sameGroups(contractGroups, nav.groups)) {
    errors.push(`${RULE.menuNavParity} MENU_GROUPS and NAV children differ`);
  }
}

function patternSections(markdown) {
  const lines = markdown.split(/\r?\n/);
  const sections = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith("### ")) {
      current = { name: line.slice(4).trim(), lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return sections;
}

function patternFields(section) {
  const fields = new Map();
  for (const line of section.lines) {
    const match = /^- ([^:]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const name = match[1].trim().toLowerCase();
    const values = fields.get(name) ?? [];
    values.push(match[2].trim());
    fields.set(name, values);
  }
  return fields;
}

function hasOneNonemptyField(fields, aliases) {
  const values = aliases.flatMap((alias) => fields.get(alias) ?? []);
  return values.length === 1 && values[0].length > 0;
}

async function verifyPatternCatalog(rootDir, errors) {
  const relativePath = "docs/architecture/pattern-selection-matrix.md";
  let markdown;
  try {
    markdown = await readFile(join(rootDir, relativePath), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      errors.push(
        `${RULE.patternCatalog} Missing pattern catalogue: ${relativePath}`,
      );
      return;
    }
    throw error;
  }
  const sections = patternSections(markdown);
  const names = sections.map((section) => section.name);
  const expected = new Set(PATTERNS);
  const unknown = [...new Set(names.filter((name) => !expected.has(name)))];
  const duplicates = duplicateValues(names);
  const missing = PATTERNS.filter((pattern) => !names.includes(pattern));
  if (
    sections.length !== PATTERNS.length ||
    new Set(names).size !== PATTERNS.length ||
    unknown.length > 0 ||
    missing.length > 0
  ) {
    errors.push(
      `${RULE.patternCatalog} expected exactly 22 unique GoF entries` +
        `${missing.length ? `; missing ${missing.join(", ")}` : ""}` +
        `${unknown.length ? `; unknown ${unknown.join(", ")}` : ""}` +
        `${duplicates.length ? `; duplicate ${duplicates.join(", ")}` : ""}`,
    );
  }

  for (const section of sections.filter((entry) => expected.has(entry.name))) {
    const fields = patternFields(section);
    if (!hasOneNonemptyField(fields, ["decision"])) {
      errors.push(
        `${RULE.patternCatalog} ${section.name} must have exactly one nonempty decision`,
      );
    }
    if (!hasOneNonemptyField(fields, ["rationale", "cra anchor"])) {
      errors.push(`${RULE.patternCatalog} ${section.name} lacks rationale`);
    }
    if (!hasOneNonemptyField(fields, ["trigger"])) {
      errors.push(`${RULE.patternCatalog} ${section.name} lacks trigger`);
    }
    if (!hasOneNonemptyField(fields, ["counterexample", "avoid"])) {
      errors.push(
        `${RULE.patternCatalog} ${section.name} lacks counterexample`,
      );
    }
  }
}

export async function verifyInvariants(rootDir) {
  const errors = [];
  await verifyCoreImports(rootDir, errors);
  await verifyWebFetch(rootDir, errors);
  await verifyLocalWireSchemas(rootDir, errors);
  await verifyContractSchemaTypeFolders(rootDir, errors);
  await verifyControllerZodBoundaries(rootDir, errors);
  await verifyWebRequestSchemas(rootDir, errors);
  await verifyFrontendRendering(rootDir, errors);
  await verifyTenantServiceRoleMethods(rootDir, errors);
  await verifyControllerRoutes(rootDir, errors);
  await verifyRefreshCookiePath(rootDir, errors);
  await verifyTokenStrategies(rootDir, errors);
  await verifySessionEpochSkew(rootDir, errors);
  await verifyMswPassthrough(rootDir, errors);
  await verifyMenuNavParity(rootDir, errors);
  await verifyPatternCatalog(rootDir, errors);
  return Object.freeze(errors);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const rootDir = process.argv[2] ?? process.cwd();
  const errors = await verifyInvariants(rootDir);
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  }
}
