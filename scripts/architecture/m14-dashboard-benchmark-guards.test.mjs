import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const testsDirectory = join(root, "apps/infrastructure/tests");
const runner = join(testsDirectory, "run-m14-dashboard-benchmark.sh");
const validEnvironment = Object.freeze({
  M14_BENCHMARK_PRODUCTS: "100",
  M14_BENCHMARK_SOURCE_GROUPS: "1",
  M14_BENCHMARK_SAMPLES: "2",
  M14_BENCHMARK_HOLD_SECONDS: "0",
  M14_BENCHMARK_INSERT_WINDOW: "50000",
  M14_BENCHMARK_DATABASE: "cra_m14_benchmark",
  M14_BENCHMARK_MODE: "rollback",
  M14_BENCHMARK_HTTP_ACTOR_ID: "",
  M14_BENCHMARK_ASSESSMENTS: "0",
  M14_BENCHMARK_SUPPRESSIONS: "0",
});

async function probe(t, overrides, args = []) {
  const directory = await mkdtemp(join(tmpdir(), "cra-m14-runner-guard-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const docker = join(directory, "docker");
  const marker = join(directory, "called");
  await writeFile(docker, '#!/bin/sh\ntouch "$DOCKER_MARKER"\nexit 91\n');
  await chmod(docker, 0o755);
  const result = spawnSync("bash", [runner, ...args], {
    encoding: "utf8",
    timeout: 5000,
    env: {
      ...process.env,
      ...validEnvironment,
      ...overrides,
      PATH: `${directory}:${process.env.PATH}`,
      DOCKER_MARKER: marker,
    },
  });
  assert.equal(result.error, undefined);
  return { result, reachedDocker: existsSync(marker) };
}

for (const [key, value] of [
  ["M14_BENCHMARK_SOURCE_GROUPS", "08"],
  ["M14_BENCHMARK_SOURCE_GROUPS", "999999999999999999999999"],
  ["M14_BENCHMARK_SAMPLES", "08"],
  ["M14_BENCHMARK_HOLD_SECONDS", "0008"],
  ["M14_BENCHMARK_INSERT_WINDOW", "0"],
  ["M14_BENCHMARK_INSERT_WINDOW", "100001"],
  ["M14_BENCHMARK_INSERT_WINDOW", "50000; SELECT 1"],
  ["M14_BENCHMARK_DATABASE", "postgres"],
  ["M14_BENCHMARK_ASSESSMENTS", "01"],
  ["M14_BENCHMARK_ASSESSMENTS", "10001"],
  ["M14_BENCHMARK_ASSESSMENTS", "-1"],
  ["M14_BENCHMARK_SUPPRESSIONS", "10001"],
  ["M14_BENCHMARK_SUPPRESSIONS", "1; SELECT 1"],
]) {
  test(`rejects ${key}=${value} before Docker`, async (t) => {
    const { result, reachedDocker } = await probe(t, { [key]: value });
    assert.notEqual(result.status, 0);
    assert.equal(reachedDocker, false, result.stderr);
  });
}

test("valid bounds reach the Docker stub without a live database", async (t) => {
  const { result, reachedDocker } = await probe(t, {});
  assert.equal(result.status, 91);
  assert.equal(reachedDocker, true);
});

// Supplemental source guards do not replace the isolated database smoke,
// severity/policy parity or committed cancellation tests recorded in the runbook.
test("fixture retains literal windows, statistics and completeness assertions", async () => {
  const sql = await readFile(
    join(testsDirectory, "m14-dashboard-benchmark.fixture.sql"),
    "utf8",
  );
  for (const fragment of [
    "analyze m14_benchmark_config;",
    "format(' from generate_series(%s,%s)",
    "window_start",
    "window_end",
    "create temporary table m14_benchmark_finding_template",
    "cross join m14_benchmark_finding_template f",
    "rich severity counts incomplete",
    "bounded product open policy parity",
    "^m14-bench-component-([0-9]+)$",
  ]) {
    assert.ok(sql.includes(fragment), `Missing fixture guard: ${fragment}`);
  }
  assert.equal(sql.includes("generate_series(1,(select findings"), false);
});

// Dependency deletes must precede parent deletion because replica mode bypasses FK cascades.
test("exact-run policy dependencies are deleted before findings in both cleanup paths", async () => {
  for (const filename of [
    "run-m14-dashboard-benchmark.sh",
    "m14-dashboard-benchmark.fixture.sql",
  ]) {
    const source = await readFile(join(testsDirectory, filename), "utf8");
    const assessment = source.indexOf(
      "delete from public.vulnerability_finding_assessments",
    );
    const suppression = source.indexOf(
      "delete from public.vulnerability_finding_suppressions",
    );
    const finding = source.indexOf("delete from public.vulnerability_findings");
    assert.ok(assessment >= 0 && assessment < finding, filename);
    assert.ok(suppression >= 0 && suppression < finding, filename);
    assert.ok(
      source
        .slice(assessment, finding)
        .includes("organization_id='00000000-0000-4000-8000-0000000000ca'"),
      filename,
    );
    assert.ok(
      source.includes(
        filename.endsWith(".sh") ? "owned_products" : "m14_benchmark_ids",
      ),
      filename,
    );
  }
});

test("manual recovery rejects malformed run identity before Docker", async (t) => {
  const { result, reachedDocker } = await probe(t, {}, [
    "--cleanup-run",
    "not-a-run-id",
  ]);
  assert.notEqual(result.status, 0);
  assert.equal(reachedDocker, false);
});

test("manual recovery uses the same scoped dependency cleanup and cancellation", async () => {
  const source = await readFile(runner, "utf8");
  assert.ok(
    source.includes(
      'cancel_run "$recovery_run_id"\n  cleanup_run "$recovery_run_id"',
    ),
  );
  assert.ok(source.includes("application_name='m14-bench-'||:'run_id'"));
  assert.ok(source.includes("internal_code='m14-bench-'||:'run_id'||'-'||id"));
});

test("manual recovery ignores unrelated polluted load settings", async (t) => {
  const { result, reachedDocker } = await probe(
    t,
    {
      M14_BENCHMARK_SOURCE_GROUPS: "garbage",
      M14_BENCHMARK_ASSESSMENTS: "999999999999999",
      M14_BENCHMARK_PRODUCTS: "unsafe",
    },
    ["--cleanup-run", "00000000-0000-4000-8000-000000000001"],
  );
  assert.equal(result.status, 91);
  assert.equal(reachedDocker, true);
});

test("manual recovery still rejects a foreign database", async (t) => {
  const { result, reachedDocker } = await probe(
    t,
    { M14_BENCHMARK_DATABASE: "postgres" },
    ["--cleanup-run", "00000000-0000-4000-8000-000000000001"],
  );
  assert.notEqual(result.status, 0);
  assert.equal(reachedDocker, false);
});

test("committed timing releases public source locks before holding", async () => {
  const sql = await readFile(
    join(testsDirectory, "m14-dashboard-benchmark.fixture.sql"),
    "utf8",
  );
  const marker = sql.indexOf("'heldDatasetReady'");
  const hold = sql.indexOf("select pg_sleep(hold_seconds)", marker);
  const results = sql.lastIndexOf("from m14_benchmark_results", marker);
  const commit = sql.indexOf("commit;", results);
  assert.ok(results >= 0 && commit > results && commit < marker);
  assert.ok(hold > marker);
  assert.ok(!sql.slice(commit + "commit;".length, hold).includes("begin;"));
  assert.ok(
    sql
      .slice(hold)
      .includes(
        "begin;\ndo $$begin if current_database()<>'cra_m14_benchmark'",
      ),
  );
});
