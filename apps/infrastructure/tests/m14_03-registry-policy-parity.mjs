import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { exportSources } from "../../../packages/contracts/dist/exports/index.js";
const expected = Object.fromEntries(
  Object.entries(exportSources).map(([name, source]) => [
    name,
    {
      columns: source.columns.map((column) => column.key),
      permissions: [...source.requiredPermissions],
      page: source.supportsPage,
      selected: source.supportsSelection,
      requiredRole: source.requiredRole ?? null,
      subjectKind: source.subjectKind,
    },
  ]),
);
const input = JSON.stringify(expected).replaceAll("'", "''");
const sql = `select jsonb_object_agg(key,public.m14_03_source_policy(key)) from jsonb_object_keys('${input}'::jsonb) key;`;
const result = spawnSync(
  "docker",
  [
    "exec",
    "-i",
    "supabase_db_cra",
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-At",
    "-v",
    "ON_ERROR_STOP=1",
  ],
  { input: sql, encoding: "utf8" },
);
assert.equal(result.status, 0, result.stderr);
assert.deepEqual(
  JSON.parse(result.stdout.trim()),
  expected,
  "Live source policies differ from shared contracts",
);
console.log(
  `M14 registry policy parity passed: ${Object.keys(expected).length} production sources.`,
);
