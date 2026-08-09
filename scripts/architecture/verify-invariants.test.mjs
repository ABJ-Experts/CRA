import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PATTERNS } from "./verify-docs.mjs";
import { verifyInvariants } from "./verify-invariants.mjs";

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
});

async function temporaryRoot(t) {
  const root = await mkdtemp(join(tmpdir(), "cra-invariants-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function write(root, relativePath, source) {
  const target = join(root, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, source);
}

function patternMatrix() {
  return [
    "# Pattern catalogue",
    ...PATTERNS.flatMap((pattern) => [
      `### ${pattern}`,
      "- Decision: Accepted for the fixture.",
      "- Rationale: It solves a demonstrated fixture problem.",
      "- Trigger: Two real variants exist.",
      "- Counterexample: A direct function is clearer for one variant.",
      "",
    ]),
  ].join("\n");
}

async function writePassingFixture(root) {
  await Promise.all([
    write(
      root,
      "apps/api/src/orders/application/list-orders.ts",
      'import type { Order } from "../domain/order";\nexport type Result = readonly Order[];\n',
    ),
    write(
      root,
      "apps/api/src/orders/domain/order.ts",
      "export interface Order { readonly id: string }\n",
    ),
    write(
      root,
      "apps/api/src/orders/infrastructure/order.repository.ts",
      [
        "export class OrderRepository {",
        "  constructor(private readonly supabase: any) {}",
        "  async list(orgId: string) {",
        '    return this.supabase.admin().from("orders").select("*").eq("organization_id", orgId);',
        "  }",
        "}",
      ].join("\n"),
    ),
    write(
      root,
      "apps/api/src/orders/orders.controller.ts",
      [
        '@Controller("orders")',
        "export class OrdersController {",
        '  @RequirePermissions("can_view_orders")',
        "  @Get()",
        "  list() { return []; }",
        "}",
      ].join("\n"),
    ),
    write(
      root,
      "apps/api/src/auth/cookies.util.ts",
      [
        'export const API_PREFIX = "api/v1";',
        "export const REFRESH_COOKIE_PATH = `/${API_PREFIX}/auth/refresh`;",
      ].join("\n"),
    ),
    write(
      root,
      "apps/api/src/auth/token-verification/token-strategy-selector.ts",
      [
        'const ALLOWED_ALGORITHMS = new Set(["HS256", "ES256", "RS256"]);',
        "export class TokenStrategySelector {",
        "  constructor(private readonly strategies: any[]) {}",
        "  select(algorithm: string) {",
        "    if (!ALLOWED_ALGORITHMS.has(algorithm)) return null;",
        "    return this.strategies.find((strategy) => strategy.supports(algorithm)) ?? null;",
        "  }",
        "}",
      ].join("\n"),
    ),
    write(
      root,
      "apps/api/src/auth/token-verification/hs256.strategy.ts",
      [
        "export class Hs256TokenVerifierStrategy {",
        '  supports(algorithm: string) { return algorithm === "HS256"; }',
        "  verify(token: string) {",
        '    return jwtVerify(token, this.secret, { algorithms: ["HS256"] });',
        "  }",
        "}",
      ].join("\n"),
    ),
    write(
      root,
      "apps/api/src/auth/token-verification/jwks.strategy.ts",
      [
        "export class JwksTokenVerifierStrategy {",
        "  constructor(private readonly getKey: unknown) {}",
        '  supports(algorithm: string) { return algorithm === "ES256" || algorithm === "RS256"; }',
        "  verify(token: string) {",
        '    return jwtVerify(token, this.getKey, { algorithms: ["ES256", "RS256"] });',
        "  }",
        "}",
      ].join("\n"),
    ),
    write(
      root,
      "apps/api/src/auth/token-verifier.service.ts",
      [
        'const jwks = createRemoteJWKSet(new URL("https://example.test/jwks"));',
        "export class TokenVerifierService {",
        "  private readonly selector = new TokenStrategySelector([",
        "    new Hs256TokenVerifierStrategy(this.secret, this.issuer),",
        "    new JwksTokenVerifierStrategy(jwks, this.issuer),",
        "  ]);",
        "  verify(token: string, algorithm: string) {",
        "    return this.selector.select(algorithm)?.verify(token);",
        "  }",
        "}",
      ].join("\n"),
    ),
    write(
      root,
      "apps/api/src/config/env.validation.ts",
      [
        "const envSchema = z.object({",
        "  SESSION_EPOCH_SKEW_SECONDS: intZeroOk(0),",
        "});",
      ].join("\n"),
    ),
    write(
      root,
      "apps/web/middleware.ts",
      [
        'const jwks = createRemoteJWKSet(new URL("https://example.test/jwks"));',
        "const secret = new Uint8Array();",
        "export async function inspectToken(token: string, algorithm: string) {",
        '  if (algorithm !== "HS256" && algorithm !== "ES256" && algorithm !== "RS256") return "invalid";',
        '  if (algorithm === "HS256") return jwtVerify(token, secret);',
        "  return jwtVerify(token, jwks);",
        "}",
      ].join("\n"),
    ),
    write(
      root,
      "apps/web/app/_lib/http/api-client.ts",
      "export const request = (path: string) => fetch(path);\n",
    ),
    write(
      root,
      "apps/web/app/dashboard/page.tsx",
      'export function Page() { return <main data-example="fetch(ignored)">ok</main>; }\n',
    ),
    write(
      root,
      "apps/web/mocks/handlers.ts",
      [
        "export const handlers = [",
        '  http.all("/api/v1/*", () => passthrough()),',
        '  http.get("/api/products", () => HttpResponse.json([])),',
        "];",
      ].join("\n"),
    ),
    write(
      root,
      "packages/contracts/src/menu.ts",
      [
        'export const MENU_KEYS = ["home", "admin", "admin.users"] as const;',
        "export const MENU_PERMISSION_MAP = {",
        "  home: null,",
        "  admin: null,",
        '  "admin.users": "can_view_users",',
        "};",
        'export const MENU_GROUPS = { admin: ["admin.users"] };',
      ].join("\n"),
    ),
    write(
      root,
      "apps/web/app/_components/sidebar/nav-config.tsx",
      [
        "export const NAV = [{ items: [",
        '  { label: "Home", href: "/", menuKey: "home" },',
        '  { label: "Admin", menuKey: "admin", children: [',
        '    { label: "Users", href: "/users", menuKey: "admin.users" },',
        "  ] },",
        "] }];",
      ].join("\n"),
    ),
    write(
      root,
      "docs/architecture/pattern-selection-matrix.md",
      patternMatrix(),
    ),
  ]);
}

function hasRule(errors, rule) {
  return errors.some((error) => error.startsWith(rule));
}

test("accepts a complete reusable fixture", async (t) => {
  const root = await temporaryRoot(t);
  await writePassingFixture(root);

  assert.deepEqual(await verifyInvariants(root), []);
});

test("rejects provider imports from application and domain code", async (t) => {
  const cases = [
    ["@nestjs/common", "NestJS"],
    ["express", "Express"],
    ["@supabase/supabase-js", "Supabase"],
    ["jose", "jose"],
    ["nodemailer", "Nodemailer"],
  ];

  for (const [specifier, label] of cases) {
    await t.test(label, async (t) => {
      const root = await temporaryRoot(t);
      await writePassingFixture(root);
      await write(
        root,
        "apps/api/src/orders/application/list-orders.ts",
        `import provider from "${specifier}";\nexport const value = provider;\n`,
      );

      const errors = await verifyInvariants(root);

      assert.ok(hasRule(errors, RULE.coreImports), errors.join("\n"));
    });
  }
});

test("rejects direct web fetch outside the central transport", async (t) => {
  const root = await temporaryRoot(t);
  await writePassingFixture(root);
  await write(
    root,
    "apps/web/app/dashboard/page.tsx",
    'export const load = () => globalThis.fetch("/api/v1/orders");\n',
  );

  const errors = await verifyInvariants(root);

  assert.ok(hasRule(errors, RULE.webFetch), errors.join("\n"));
});

test("requires orgId first only for clearly tenant-scoped service-role methods", async (t) => {
  const root = await temporaryRoot(t);
  await writePassingFixture(root);
  await write(
    root,
    "apps/api/src/orders/infrastructure/order.repository.ts",
    [
      "export class OrderRepository {",
      "  constructor(private readonly supabase: any) {}",
      "  async list(userId: string, orgId: string) {",
      '    return this.supabase.admin().from("orders").select("*").eq("organization_id", orgId).eq("user_id", userId);',
      "  }",
      "}",
    ].join("\n"),
  );

  const errors = await verifyInvariants(root);

  assert.ok(hasRule(errors, RULE.tenantServiceRole), errors.join("\n"));
});

test("does not guess tenant scope for global or private service-role methods", async (t) => {
  const root = await temporaryRoot(t);
  await writePassingFixture(root);
  await write(
    root,
    "apps/api/src/orders/infrastructure/order.repository.ts",
    [
      "export class OrderRepository {",
      "  constructor(private readonly supabase: any) {}",
      '  ping() { return this.supabase.admin().from("health").select("id"); }',
      "  private tenantWrite(userId: string, orgId: string) {",
      '    return this.supabase.admin().from("orders").update({}).eq("organization_id", orgId);',
      "  }",
      "}",
    ].join("\n"),
  );

  const errors = await verifyInvariants(root);

  assert.equal(
    hasRule(errors, RULE.tenantServiceRole),
    false,
    errors.join("\n"),
  );
});

test("rejects controller routes without public or authorization metadata", async (t) => {
  const root = await temporaryRoot(t);
  await writePassingFixture(root);
  await write(
    root,
    "apps/api/src/orders/orders.controller.ts",
    [
      '@Controller("orders")',
      "export class OrdersController {",
      "  @Get()",
      "  list() { return []; }",
      "}",
    ].join("\n"),
  );

  const errors = await verifyInvariants(root);

  assert.ok(hasRule(errors, RULE.routeAuthorization), errors.join("\n"));
});

test("accepts controller-level authorization metadata", async (t) => {
  const root = await temporaryRoot(t);
  await writePassingFixture(root);
  await write(
    root,
    "apps/api/src/orders/orders.controller.ts",
    [
      '@RequireRole("member")',
      '@Controller("orders")',
      "export class OrdersController {",
      "  @Get()",
      "  list() { return []; }",
      "}",
    ].join("\n"),
  );

  const errors = await verifyInvariants(root);

  assert.equal(
    hasRule(errors, RULE.routeAuthorization),
    false,
    errors.join("\n"),
  );
});

test("rejects refresh cookie path drift", async (t) => {
  const root = await temporaryRoot(t);
  await writePassingFixture(root);
  await write(
    root,
    "apps/api/src/auth/cookies.util.ts",
    'export const REFRESH_COOKIE_PATH = "/api/v1/auth";\n',
  );

  const errors = await verifyInvariants(root);

  assert.ok(hasRule(errors, RULE.refreshCookiePath), errors.join("\n"));
});

test("rejects loss of each token algorithm route", async (t) => {
  const cases = [
    [
      "HS256",
      "apps/api/src/auth/token-verification/token-strategy-selector.ts",
      (source) => source.replace('"HS256", ', ""),
    ],
    [
      "ES256",
      "apps/api/src/auth/token-verification/jwks.strategy.ts",
      (source) =>
        source
          .replaceAll('algorithm === "ES256" || ', "")
          .replaceAll('"ES256", ', ""),
    ],
    [
      "RS256",
      "apps/api/src/auth/token-verification/jwks.strategy.ts",
      (source) =>
        source
          .replaceAll(' || algorithm === "RS256"', "")
          .replaceAll(', "RS256"', ""),
    ],
  ];

  for (const [algorithm, relativePath, mutate] of cases) {
    await t.test(algorithm, async (t) => {
      const root = await temporaryRoot(t);
      await writePassingFixture(root);
      const baseline = relativePath.endsWith("token-strategy-selector.ts")
        ? [
            'const ALLOWED_ALGORITHMS = new Set(["HS256", "ES256", "RS256"]);',
            "export class TokenStrategySelector {",
            "  constructor(private readonly strategies: any[]) {}",
            "  select(algorithm: string) {",
            "    if (!ALLOWED_ALGORITHMS.has(algorithm)) return null;",
            "    return this.strategies.find((strategy) => strategy.supports(algorithm)) ?? null;",
            "  }",
            "}",
          ].join("\n")
        : [
            "export class JwksTokenVerifierStrategy {",
            "  constructor(private readonly getKey: unknown) {}",
            '  supports(algorithm: string) { return algorithm === "ES256" || algorithm === "RS256"; }',
            "  verify(token: string) {",
            '    return jwtVerify(token, this.getKey, { algorithms: ["ES256", "RS256"] });',
            "  }",
            "}",
          ].join("\n");
      await write(root, relativePath, mutate(baseline));

      const errors = await verifyInvariants(root);

      assert.ok(hasRule(errors, RULE.tokenStrategy), errors.join("\n"));
      assert.ok(
        errors.some((error) => error.includes(algorithm)),
        errors.join("\n"),
      );
    });
  }
});

test("rejects asymmetric verification that no longer uses a JWKS key source", async (t) => {
  const root = await temporaryRoot(t);
  await writePassingFixture(root);
  await write(
    root,
    "apps/api/src/auth/token-verification/jwks.strategy.ts",
    [
      "export class JwksTokenVerifierStrategy {",
      "  constructor(private readonly secret: unknown) {}",
      '  supports(algorithm: string) { return algorithm === "ES256" || algorithm === "RS256"; }',
      "  verify(token: string) {",
      '    return jwtVerify(token, this.secret, { algorithms: ["ES256", "RS256"] });',
      "  }",
      "}",
    ].join("\n"),
  );

  const errors = await verifyInvariants(root);

  assert.ok(hasRule(errors, RULE.tokenStrategy), errors.join("\n"));
  assert.ok(
    errors.some((error) => error.includes("JWKS key source")),
    errors.join("\n"),
  );
});

test("rejects loss of JWKS routing in web middleware", async (t) => {
  const root = await temporaryRoot(t);
  await writePassingFixture(root);
  await write(
    root,
    "apps/web/middleware.ts",
    [
      "const secret = new Uint8Array();",
      "export async function inspectToken(token: string, algorithm: string) {",
      '  if (algorithm !== "HS256") return "invalid";',
      "  return jwtVerify(token, secret);",
      "}",
    ].join("\n"),
  );

  const errors = await verifyInvariants(root);

  assert.ok(hasRule(errors, RULE.tokenStrategy), errors.join("\n"));
});

test("rejects nonzero session epoch skew", async (t) => {
  const root = await temporaryRoot(t);
  await writePassingFixture(root);
  await write(
    root,
    "apps/api/src/config/env.validation.ts",
    "const envSchema = z.object({ SESSION_EPOCH_SKEW_SECONDS: intZeroOk(30) });\n",
  );

  const errors = await verifyInvariants(root);

  assert.ok(hasRule(errors, RULE.sessionEpochSkew), errors.join("\n"));
});

test("rejects an MSW API passthrough that is not first", async (t) => {
  const root = await temporaryRoot(t);
  await writePassingFixture(root);
  await write(
    root,
    "apps/web/mocks/handlers.ts",
    [
      "export const handlers = [",
      '  http.get("/api/products", () => HttpResponse.json([])),',
      '  http.all("/api/v1/*", () => passthrough()),',
      "];",
    ].join("\n"),
  );

  const errors = await verifyInvariants(root);

  assert.ok(hasRule(errors, RULE.mswPassthrough), errors.join("\n"));
});

test("rejects nav and menu key drift", async (t) => {
  const root = await temporaryRoot(t);
  await writePassingFixture(root);
  await write(
    root,
    "apps/web/app/_components/sidebar/nav-config.tsx",
    'export const NAV = [{ items: [{ menuKey: "home" }, { menuKey: "reports" }] }];\n',
  );

  const errors = await verifyInvariants(root);

  assert.ok(hasRule(errors, RULE.menuNavParity), errors.join("\n"));
});

test("rejects duplicate nav keys and missing permission mappings", async (t) => {
  const root = await temporaryRoot(t);
  await writePassingFixture(root);
  await write(
    root,
    "packages/contracts/src/menu.ts",
    [
      'export const MENU_KEYS = ["home", "home"] as const;',
      "export const MENU_PERMISSION_MAP = {};",
      "export const MENU_GROUPS = {};",
    ].join("\n"),
  );

  const errors = await verifyInvariants(root);

  assert.ok(hasRule(errors, RULE.menuNavParity), errors.join("\n"));
});

test("rejects duplicate or missing GoF catalogue decisions", async (t) => {
  const root = await temporaryRoot(t);
  await writePassingFixture(root);
  await write(
    root,
    "docs/architecture/pattern-selection-matrix.md",
    `${patternMatrix()}\n### Prototype\n- Decision: Deferred.\n`,
  );

  const errors = await verifyInvariants(root);

  assert.ok(hasRule(errors, RULE.patternCatalog), errors.join("\n"));
  assert.ok(
    errors.some((error) => error.includes("Prototype")),
    errors.join("\n"),
  );
});

test("requires rationale, trigger, and counterexample for every pattern", async (t) => {
  const root = await temporaryRoot(t);
  await writePassingFixture(root);
  await write(
    root,
    "docs/architecture/pattern-selection-matrix.md",
    patternMatrix().replace(
      "### Strategy\n- Decision: Accepted for the fixture.\n- Rationale: It solves a demonstrated fixture problem.\n- Trigger: Two real variants exist.\n- Counterexample: A direct function is clearer for one variant.",
      "### Strategy\n- Decision: Accepted for the fixture.\n- Trigger: Two real variants exist.",
    ),
  );

  const errors = await verifyInvariants(root);

  assert.ok(hasRule(errors, RULE.patternCatalog), errors.join("\n"));
  assert.ok(
    errors.some(
      (error) => error.includes("Strategy") && error.includes("rationale"),
    ),
    errors.join("\n"),
  );
  assert.ok(
    errors.some(
      (error) => error.includes("Strategy") && error.includes("counterexample"),
    ),
    errors.join("\n"),
  );
});

test("accepts the repository invariants", async () => {
  assert.deepEqual(await verifyInvariants(process.cwd()), []);
});

test("CLI exits nonzero and identifies invariant failures", async (t) => {
  const root = await temporaryRoot(t);
  await writePassingFixture(root);
  await write(
    root,
    "apps/api/src/auth/cookies.util.ts",
    'export const REFRESH_COOKIE_PATH = "/";\n',
  );
  const verifier = fileURLToPath(
    new URL("./verify-invariants.mjs", import.meta.url),
  );

  const result = spawnSync(process.execPath, [verifier, root], {
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[refresh-cookie-path\]/);
});
