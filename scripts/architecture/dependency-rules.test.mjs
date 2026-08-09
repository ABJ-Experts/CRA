import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const projectRoot = process.cwd();
const cli = join(
  projectRoot,
  "node_modules/dependency-cruiser/bin/dependency-cruise.mjs",
);
const config = join(projectRoot, "dependency-cruiser.cjs");

async function write(root, path, source) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, source);
}

test("every declared dependency boundary rejects a representative import", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "cra-dependencies-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await symlink(
    join(process.cwd(), "node_modules"),
    join(root, "node_modules"),
  );

  await Promise.all([
    write(root, "apps/api/provider.ts", "export const api = true;\n"),
    write(root, "apps/web/provider.ts", "export const web = true;\n"),
    write(
      root,
      "packages/contracts/from.ts",
      'export { api } from "../../apps/api/provider";\n',
    ),
    write(
      root,
      "apps/web/to-api.ts",
      'export { api } from "../api/provider";\n',
    ),
    write(
      root,
      "apps/api/to-web.ts",
      'export { web } from "../web/provider";\n',
    ),
    write(
      root,
      "apps/api/src/orders/application/provider.ts",
      "export const application = true;\n",
    ),
    write(
      root,
      "apps/api/src/orders/infrastructure/provider.ts",
      "export const infrastructure = true;\n",
    ),
    write(
      root,
      "apps/api/src/orders/domain/outward.ts",
      'export { application } from "../application/provider";\n',
    ),
    write(
      root,
      "apps/api/src/orders/application/outward.ts",
      'export { infrastructure } from "../infrastructure/provider";\n',
    ),
    write(
      root,
      "apps/api/src/orders/domain/framework.ts",
      'export { Injectable } from "@nestjs/common";\n',
    ),
    write(
      root,
      "packages/ui/src/app-state.ts",
      'export { QueryClient } from "@tanstack/react-query";\n',
    ),
    write(
      root,
      "packages/contracts/unresolved.ts",
      'export { missing } from "@repo/not-a-workspace";\n',
    ),
  ]);

  const result = spawnSync(
    process.execPath,
    [cli, "--config", config, "--output-type", "err-long", "apps", "packages"],
    { cwd: root, encoding: "utf8" },
  );
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0, output);
  for (const rule of [
    "no-packages-to-apps",
    "no-web-to-api-or-infrastructure",
    "no-api-to-web",
    "domain-does-not-depend-outward",
    "application-does-not-depend-on-adapters",
    "core-does-not-import-provider-frameworks",
    "shared-ui-does-not-own-app-state",
    "no-unresolved-workspace-imports",
  ]) {
    assert.match(
      output,
      new RegExp(rule),
      `Expected ${rule} to reject a fixture`,
    );
  }
});

test("workspace aliases resolve to their source modules", () => {
  const result = spawnSync(
    process.execPath,
    [
      cli,
      "--config",
      config,
      "--output-type",
      "json",
      "apps/api/src/auth/auth.service.ts",
      "packages/contracts/src",
    ],
    { cwd: projectRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const cruise = JSON.parse(result.stdout);
  const authService = cruise.modules.find(
    (module) => module.source === "apps/api/src/auth/auth.service.ts",
  );
  const contractDependency = authService?.dependencies.find(
    (dependency) => dependency.module === "@repo/contracts/auth",
  );

  assert.ok(contractDependency, "Expected the auth contract dependency");
  assert.equal(contractDependency.couldNotResolve, false);
  assert.equal(contractDependency.resolved, "packages/contracts/src/auth.ts");
  assert.ok(
    contractDependency.dependencyTypes.includes("aliased-tsconfig-paths"),
    JSON.stringify(contractDependency),
  );
});

test("cross-app workspace aliases cannot bypass dependency boundaries", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "cra-alias-dependencies-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await symlink(join(projectRoot, "node_modules"), join(root, "node_modules"));

  await Promise.all([
    write(
      root,
      "packages/contracts/to-api.ts",
      'export { secret } from "@repo/api/private";\n',
    ),
    write(
      root,
      "apps/web/to-api.ts",
      'export { secret } from "@repo/api/private";\n',
    ),
    write(
      root,
      "apps/api/to-web.ts",
      'export { secret } from "@repo/web/private";\n',
    ),
  ]);

  const result = spawnSync(
    process.execPath,
    [cli, "--config", config, "--output-type", "json", "apps", "packages"],
    { cwd: root, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const cruise = JSON.parse(result.stdout);
  const violations = cruise.summary.violations.map((violation) => ({
    from: violation.from,
    rule: violation.rule.name,
    to: violation.to,
  }));

  for (const expected of [
    {
      from: "apps/api/to-web.ts",
      rule: "no-api-to-web",
      to: "@repo/web/private",
    },
    {
      from: "apps/web/to-api.ts",
      rule: "no-web-to-api-or-infrastructure",
      to: "@repo/api/private",
    },
    {
      from: "packages/contracts/to-api.ts",
      rule: "no-packages-to-apps",
      to: "@repo/api/private",
    },
  ]) {
    assert.ok(
      violations.some(
        (violation) =>
          violation.from === expected.from &&
          violation.rule === expected.rule &&
          violation.to === expected.to,
      ),
      `Expected ${JSON.stringify(expected)} in ${JSON.stringify(violations)}`,
    );
  }

  assert.ok(
    violations.some(
      (violation) => violation.rule === "no-unresolved-workspace-imports",
    ),
    "Expected unresolved workspace aliases to fail closed",
  );
});

test("generated build directories do not enter the dependency graph", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "cra-generated-dependencies-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await symlink(join(projectRoot, "node_modules"), join(root, "node_modules"));

  await Promise.all([
    write(
      root,
      "apps/docs/.docusaurus/generated.ts",
      "export const generated = true;\n",
    ),
    write(
      root,
      "apps/web/.turbo/generated.ts",
      "export const generated = true;\n",
    ),
    write(root, "apps/web/source.ts", "export const source = true;\n"),
  ]);

  const result = spawnSync(
    process.execPath,
    [cli, "--config", config, "--output-type", "json", "apps"],
    { cwd: root, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const sources = JSON.parse(result.stdout).modules.map((module) =>
    module.source.replaceAll("\\", "/"),
  );
  assert.ok(sources.includes("apps/web/source.ts"), JSON.stringify(sources));
  assert.ok(
    sources.every(
      (source) =>
        !source.includes("/.docusaurus/") && !source.includes("/.turbo/"),
    ),
    JSON.stringify(sources),
  );
});
