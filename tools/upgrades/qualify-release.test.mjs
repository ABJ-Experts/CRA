import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const script = fileURLToPath(new URL("./qualify-release.mjs", import.meta.url));
test("qualification shim rejects malformed invocation and cannot bypass dedicated runner admission", () => {
  const options = {
    encoding: "utf8",
    env: { ...process.env, CRA_DEDICATED_QUALIFICATION_RUNNER: "false" },
    timeout: 10000,
  };
  const malformed = spawnSync(process.execPath, [script], options);
  assert.notEqual(malformed.status, 0);
  assert.match(malformed.stderr, /usage: qualify-release/);
  const unavailable = spawnSync(
    process.execPath,
    [script, "/missing-request.json", "/missing-result.json"],
    options,
  );
  assert.equal(unavailable.status, 1);
  assert.match(
    unavailable.stderr,
    /dedicated provisioned Linux reference runner required/,
  );
  assert.doesNotMatch(unavailable.stderr, /ENOENT/);
});
