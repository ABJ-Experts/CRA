import test from "node:test";
import assert from "node:assert/strict";
import { verifyLicenceOperationCoverage } from "./m15-01-operation-coverage.mjs";

test("all routes and semantic workers have explicit source-evidenced licence operations", async () => {
  assert.deepEqual(await verifyLicenceOperationCoverage(process.cwd()), []);
});
