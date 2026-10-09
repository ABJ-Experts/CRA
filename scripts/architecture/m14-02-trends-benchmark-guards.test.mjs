import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const runner = join(
  root,
  "apps/infrastructure/tests/run-m14-02-trends-benchmark.sh",
);

async function probe(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), "cra-m14-trends-guard-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const docker = join(directory, "docker");
  const marker = join(directory, "called");
  await writeFile(docker, '#!/bin/sh\ntouch "$DOCKER_MARKER"\nexit 91\n');
  await chmod(docker, 0o755);
  const result = spawnSync("bash", [runner], {
    encoding: "utf8",
    timeout: 5000,
    env: {
      ...process.env,
      M14_TRENDS_DATABASE: "cra_m14_benchmark",
      M14_TRENDS_SAMPLES: "2",
      M14_TRENDS_FACTS: "10000",
      M14_TRENDS_COHORTS: "1000",
      M14_TRENDS_MODE: "rollback",
      M14_TRENDS_HOLD_SECONDS: "0",
      M14_TRENDS_VACUUM_BEFORE_TIMING: "false",
      M14_TRENDS_SKIP_SQL_TIMING: "false",
      ...overrides,
      PATH: `${directory}:${process.env.PATH}`,
      DOCKER_MARKER: marker,
    },
  });
  assert.equal(result.error, undefined);
  return { result, reachedDocker: existsSync(marker) };
}

for (const [key, value] of [
  ["M14_TRENDS_DATABASE", "postgres"],
  ["M14_TRENDS_MODE", "unsafe"],
  ["M14_TRENDS_SKIP_SQL_TIMING", "true"],
  ["M14_TRENDS_SKIP_SQL_TIMING", "unsafe"],
  ["M14_TRENDS_COHORTS", "100001"],
  ["M14_TRENDS_COHORTS", "01000"],
  ["M14_TRENDS_COHORTS", "10000; select 1"],
  ["M14_TRENDS_SAMPLES", "1"],
  ["M14_TRENDS_SAMPLES", "501"],
  ["M14_TRENDS_FACTS", "10001"],
  ["M14_TRENDS_HOLD_SECONDS", "601"],
  ["M14_TRENDS_VACUUM_BEFORE_TIMING", "true"],
  ["M14_TRENDS_VACUUM_BEFORE_TIMING", "unknown"],
]) {
  test(`trends rejects ${key}=${value} before Docker`, async (t) => {
    const { result, reachedDocker } = await probe(t, { [key]: value });
    assert.notEqual(result.status, 0);
    assert.equal(reachedDocker, false, result.stderr);
  });
}

test("bounded rollback reaches only the Docker stub", async (t) => {
  const { result, reachedDocker } = await probe(t);
  assert.equal(result.status, 91);
  assert.equal(reachedDocker, true);
});

test("clone committed visibility maintenance reaches the Docker stub", async (t) => {
  const { result, reachedDocker } = await probe(t, {
    M14_TRENDS_MODE: "committed",
    M14_TRENDS_VACUUM_BEFORE_TIMING: "true",
  });
  assert.equal(result.status, 91);
  assert.equal(reachedDocker, true);
});

test("HTTP duration-cohort guard rejects negative bounds before any request", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cra-m14-trends-http-guard-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cookie = join(directory, "private-cookie");
  await writeFile(cookie, "synthetic_cookie=guard_only", { mode: 0o600 });
  const result = spawnSync(
    process.execPath,
    [join(root, "apps/infrastructure/tests/m14-02-trends-http-benchmark.mjs")],
    {
      encoding: "utf8",
      timeout: 5000,
      env: {
        ...process.env,
        M14_TRENDS_HTTP_ORIGIN: "http://127.0.0.1:1",
        M14_TRENDS_HTTP_DATABASE: "cra_m14_benchmark",
        M14_TRENDS_HTTP_COOKIE_FILE: cookie,
        M14_TRENDS_HTTP_MIN_DURATION_COHORTS: "-1",
        M14_TRENDS_HTTP_SAMPLES: "2",
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Samples\/pace exceed benchmark bounds/);
  assert.doesNotMatch(result.stderr, /fetch failed/);
});
