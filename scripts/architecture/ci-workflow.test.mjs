import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

  const [workflow, envLoader] = await Promise.all([
    readFile(join(root, ".github/workflows/ci.yml"), "utf8"),
    readFile(
      join(root, "apps/infrastructure/scripts/local-supabase-env.sh"),
      "utf8",
    ),
  ]);
  assert.ok(envLoader.includes("parse_local_supabase_env"));
  assert.ok(
    workflow.includes(
      "source apps/infrastructure/scripts/local-supabase-env.sh",
    ),
  );
  assert.doesNotMatch(workflow, /source\s+<\(/);
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

test("parses only allowlisted local Supabase environment values", () => {
  const loader = join(
    root,
    "apps/infrastructure/scripts/local-supabase-env.sh",
  );
  const fixture = [
    'API_URL="http://127.0.0.1:54321"',
    'DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"',
    'ANON_KEY="anon-value"',
    'SERVICE_ROLE_KEY="service-value"',
    'JWT_SECRET="jwt-value"',
    'UNTRUSTED_VALUE="must-not-be-exported"',
  ].join("\n");
  const result = spawnSync(
    "bash",
    [
      "-c",
      'source "$1"; parse_local_supabase_env "$2"; printf "%s|%s|%s" "$API_URL" "$DB_URL" "${UNTRUSTED_VALUE-unset}"',
      "bash",
      loader,
      fixture,
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout,
    "http://127.0.0.1:54321|postgresql://postgres:postgres@127.0.0.1:54322/postgres|unset",
  );
});

test("fails closed when Supabase status fails or omits a required value", (t) => {
  const loader = join(
    root,
    "apps/infrastructure/scripts/local-supabase-env.sh",
  );
  const fakeBin = mkdtempSync(join(tmpdir(), "cra-supabase-env-"));
  t.after(() => rmSync(fakeBin, { recursive: true, force: true }));
  const fakePnpm = join(fakeBin, "pnpm");
  writeFileSync(
    fakePnpm,
    `#!/usr/bin/env bash
if [[ \${FAKE_SUPABASE_MODE-} == "missing" ]]; then
  printf '%s\\n' 'API_URL="http://127.0.0.1:54321"' 'ANON_KEY="anon"' 'SERVICE_ROLE_KEY="service"' 'JWT_SECRET="jwt"'
  exit 0
fi
exit 17
`,
  );
  chmodSync(fakePnpm, 0o755);

  const command =
    'source "$1"; if load_local_supabase_env; then printf "%s" "${DB_URL-unset}"; exit 0; else printf "%s" "${DB_URL-unset}"; exit 1; fi';
  const inheritedValues = {
    ANON_KEY: "stale-anon",
    API_URL: "https://stale.invalid",
    DB_URL: "postgresql://stale.invalid/db",
    JWT_SECRET: "stale-jwt",
    SERVICE_ROLE_KEY: "stale-service",
  };

  for (const mode of ["failure", "missing"]) {
    const result = spawnSync("bash", ["-c", command, "bash", loader], {
      encoding: "utf8",
      env: {
        ...process.env,
        ...inheritedValues,
        FAKE_SUPABASE_MODE: mode,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      },
    });

    assert.notEqual(result.status, 0, `${mode}: ${result.stderr}`);
    assert.doesNotMatch(result.stdout, /stale/);
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
