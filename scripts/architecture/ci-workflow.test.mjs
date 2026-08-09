import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

test("defines fast and live verification lanes", async () => {
  const [packageJson, infrastructurePackageJson] = await Promise.all([
    readFile(join(root, "package.json"), "utf8").then(JSON.parse),
    readFile(join(root, "apps/infrastructure/package.json"), "utf8").then(
      JSON.parse,
    ),
  ]);
  assert.equal(
    packageJson.scripts["test:live"],
    "pnpm --filter infrastructure run test && pnpm --filter api run test:e2e && bash apps/api/test/auth-flow.e2e.sh",
  );
  assert.equal(
    infrastructurePackageJson.scripts["db:lint"],
    "supabase db lint --fail-on error",
  );

  const workflow = await readFile(
    join(root, ".github/workflows/ci.yml"),
    "utf8",
  );
  for (const required of [
    "permissions:\n  contents: read",
    "pnpm install --frozen-lockfile",
    "pnpm verify",
    "pnpm --filter infrastructure run db:start",
    "pnpm --filter infrastructure run db:reset",
    "pnpm --filter infrastructure run db:lint",
    "pnpm --filter infrastructure run test",
    "SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY",
    "pnpm --filter api run build",
    "http://127.0.0.1:3333/api/v1/health/ready",
    "pnpm --filter api run test:e2e",
    "bash apps/api/test/auth-flow.e2e.sh",
  ]) {
    assert.ok(workflow.includes(required), `CI is missing: ${required}`);
  }
});

test("documents the verification commands without package-manager drift", async () => {
  const [rootReadme, docsReadme] = await Promise.all([
    readFile(join(root, "README.md"), "utf8"),
    readFile(join(root, "apps/docs/README.md"), "utf8"),
  ]);

  assert.match(rootReadme, /pnpm verify/);
  assert.match(rootReadme, /pnpm test:live/);
  assert.match(rootReadme, /Docker/i);
  assert.match(rootReadme, /API.+running|running.+API/is);
  assert.match(rootReadme, /pnpm --filter infrastructure run db:reset/);
  assert.ok(
    rootReadme.indexOf("pnpm --filter infrastructure run db:reset") <
      rootReadme.indexOf("pnpm --filter api run build"),
    "The local database must be reset and seeded before the API starts",
  );
  assert.doesNotMatch(docsReadme, /\b(?:npm|yarn)\b/i);
  for (const command of [
    "pnpm install",
    "pnpm --filter docs run dev",
    "pnpm --filter docs run build",
    "pnpm --filter docs run check-types",
  ]) {
    assert.ok(
      docsReadme.includes(command),
      `Docs README is missing ${command}`,
    );
  }
});
