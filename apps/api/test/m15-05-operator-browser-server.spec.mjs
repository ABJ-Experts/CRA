import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";
import { validateFixtureConfig } from "./m15-05-operator-browser-server.mjs";
const config = {
  host: "127.0.0.1",
  port: 3447,
  databaseOrigin: "http://127.0.0.1:54321",
  instanceId: "11111111-1111-4111-8111-111111111111",
  certificateDirectory: "/tmp/m15-05/operator",
  readerJwtFile: "/tmp/m15-05/reader.jwt",
  backupControlJwtFile: "/tmp/m15-05/control.jwt",
  projectApiKeyFile: "/tmp/m15-05/anon.key",
  grantsPath: "/tmp/m15-05/grants.json",
  staticRoot: "/workspace/apps/operator/out",
};
nodeTest("accepts only the task-owned private listener fixture", () => {
  assert.deepEqual(validateFixtureConfig(config), config);
});
for (const change of [
  { host: "0.0.0.0" },
  { port: 3444 },
  { databaseOrigin: "https://example.com" },
  { databaseOrigin: "http://user:secret@127.0.0.1:54321" },
  { databaseOrigin: "http://127.0.0.1:54321/?secret=value" },
  { certificateDirectory: "/tmp/original" },
  { readerJwtFile: "relative" },
  { backupControlJwtFile: config.readerJwtFile },
  { instanceId: "../scope" },
  { secret: "forbidden" },
]) {
  nodeTest(`rejects unsafe fixture setting ${Object.keys(change)[0]}`, () => {
    assert.throws(() => validateFixtureConfig({ ...config, ...change }));
  });
}
