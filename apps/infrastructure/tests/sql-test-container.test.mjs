import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  mkdir,
  readFile,
  rm,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
const script = resolve(import.meta.dirname, "run-sql-tests.sh");
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "cra-sql-selection-"));
  await mkdir(join(root, "tests"));
  await mkdir(join(root, "bin"));
  await writeFile(
    join(root, "tests/prepare-legacy-sql.test.mjs"),
    'import {test}from"node:test";test("fixture preparation",()=>{});',
  );
  await writeFile(join(root, "tests/m15-selection.test.sql"), "SELECT 1;\n");
  await writeFile(
    join(root, "bin/docker"),
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$CRA_TEST_DOCKER_ARGV"\ncat >/dev/null\nprintf "ok 1 - fixture\\n"\n',
    { mode: 0o700 },
  );
  return root;
}
for (const [name, value, expected] of [
  ["preserves the default", undefined, "supabase_db_cra"],
  [
    "selects a disposable database",
    "cra_m15_06_sql_20261015b",
    "cra_m15_06_sql_20261015b",
  ],
])
  test(name, async () => {
    const root = await fixture();
    try {
      const env = {
        ...process.env,
        PATH: join(root, "bin") + ":" + process.env.PATH,
        CRA_TEST_DOCKER_ARGV: join(root, "argv"),
      };
      delete env.CRA_SQL_TEST_CONTAINER;
      if (value) env.CRA_SQL_TEST_CONTAINER = value;
      const result = spawnSync("bash", [script], {
        cwd: root,
        env,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(
        (await readFile(join(root, "argv"), "utf8")).split("\n")[2],
        expected,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
test("rejects flags, shell syntax and whitespace before invoking Docker", async () => {
  const root = await fixture();
  try {
    for (const value of [
      "--privileged",
      "db other",
      "db;touch marker",
      "$(touch marker)",
      "../database",
      "db\nother",
    ]) {
      const result = spawnSync("bash", [script], {
        cwd: root,
        env: {
          ...process.env,
          PATH: join(root, "bin") + ":" + process.env.PATH,
          CRA_TEST_DOCKER_ARGV: join(root, "argv"),
          CRA_SQL_TEST_CONTAINER: value,
        },
        encoding: "utf8",
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /CRA_SQL_TEST_CONTAINER/);
      await assert.rejects(access(join(root, "argv")));
      await assert.rejects(access(join(root, "marker")));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("Turbo forwards the container selector and never caches live SQL tests", async () => {
  const config = JSON.parse(
    await readFile(new URL("../../../turbo.json", import.meta.url), "utf8"),
  );
  const task = config.tasks["infrastructure#test"];
  assert(task.env.includes("CRA_SQL_TEST_CONTAINER"));
  assert.equal(task.cache, false);
  assert.deepEqual(task.dependsOn, config.tasks.test.dependsOn);
});
