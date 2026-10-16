import assert from "node:assert/strict";
import nodeTest from "node:test";
import { resolve } from "node:path";
import {
  validateFixtureConfig,
  simulatedLifecycle,
} from "./m15-06-operator-browser-server.mjs";
const valid = {
  host: "127.0.0.1",
  port: 3448,
  taskRoot: "/tmp/cra-m15-06-browser-test",
  staticRoot: resolve("apps/operator/out"),
  instanceId: "11111111-1111-4111-8111-111111111111",
};
nodeTest(
  "browser fixture accepts only loopback task roots and exact static app",
  () => {
    assert.equal(validateFixtureConfig(valid), valid);
    for (const changes of [
      { host: "0.0.0.0" },
      { port: 3333 },
      { taskRoot: "/tmp/original" },
      { taskRoot: "/tmp/cra-m15-06-browser-test/../original" },
      { taskRoot: "/Users/source" },
      { staticRoot: "/tmp/secrets" },
      { instanceId: "forged" },
      { databaseOrigin: "http://localhost:54321" },
    ])
      assert.throws(() => validateFixtureConfig({ ...valid, ...changes }));
  },
);
const plan = {
  previousImages: [{ imageId: "old" }],
  candidateImages: [{ imageId: "new" }],
  expectedLedgerDigest: "ledger",
  targetSchemaDigest: "schema",
  migrations: [{ name: "forward-only" }],
};
nodeTest(
  "simulated lifecycle exposes exactly acknowledged effects and never reverses migrations",
  async () => {
    const port = simulatedLifecycle(plan);
    assert.equal((await port.observe()).maintenance, false);
    await port.closeIngress();
    await port.stopClaims();
    await port.drain();
    await port.holdVerifiedBackup();
    await port.migrate(plan);
    await port.startCandidate(plan.candidateImages);
    await port.verifyCandidate();
    await port.startWorkers();
    await port.openIngress();
    await port.verifyActivated();
    assert.deepEqual((await port.observe()).images, plan.candidateImages);
    await port.restorePreviousImages(plan.previousImages);
    assert.deepEqual((await port.observe()).ledger, ["forward-only"]);
    assert.deepEqual((await port.observe()).images, plan.previousImages);
  },
);
nodeTest(
  "forced rollback scenario fails candidate validation before exposure",
  async () => {
    const port = simulatedLifecycle(plan, "rollback");
    await port.closeIngress();
    await port.startCandidate(plan.candidateImages);
    await assert.rejects(() => port.verifyCandidate(), /simulated candidate/);
    assert.equal((await port.observe()).maintenance, true);
    assert.equal((await port.observe()).workersReady, false);
  },
);
