import assert from "node:assert/strict";
import { mkdir, chmod, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createCertificates } from "./m15-03-tls-fixture.mjs";

// Persistent task-only fixture. Parent-owned configuration contains file paths,
// not credential values. Originals and isolated clone use separate grant files.
assert.ok(process.env.M15_03_OPERATOR_SERVER_CONFIG_FILE);
const config = JSON.parse(
  await readFile(process.env.M15_03_OPERATOR_SERVER_CONFIG_FILE, "utf8"),
);
assert.equal(config.host, "127.0.0.1");
assert.ok([3445, 3446].includes(config.port));
assert.ok(
  ["localhost", "127.0.0.1"].includes(new URL(config.databaseOrigin).hostname),
);
assert.ok(config.certificateDirectory.includes("m15-03"));
await mkdir(config.certificateDirectory, { recursive: true, mode: 0o700 });
await chmod(config.certificateDirectory, 0o700);
const existing = await access(
  join(config.certificateDirectory, "server.crt"),
).then(
  () => true,
  () => false,
);
if (!existing) await createCertificates(config.certificateDirectory);
const load = (file) => readFile(join(config.certificateDirectory, file));
const [ca, cert, key, credential, projectApiKey] = await Promise.all([
  load("ca.crt"),
  load("server.crt"),
  load("server.key"),
  readFile(config.readerJwtFile, "utf8"),
  readFile(config.projectApiKeyFile, "utf8"),
]);
const loadBuilt = createRequire(import.meta.url);
const { createOperatorApplication } = loadBuilt(
  "../dist/operator/operator-listener.js",
);
const { NarrowRegistryClient } = loadBuilt(
  "../dist/operator/operator-registry.client.js",
);
const app = await createOperatorApplication(
  {
    instanceId: config.instanceId,
    host: config.host,
    port: config.port,
    ca,
    cert,
    key,
    grantsPath: config.grantsPath,
    staticRoot: config.staticRoot,
  },
  new NarrowRegistryClient(
    config.databaseOrigin,
    credential.trim(),
    projectApiKey.trim(),
  ),
);
await app.listen(config.port, config.host);
process.on("SIGTERM", () => {
  void app.close().then(() => process.exit(0));
});
process.on("SIGINT", () => {
  void app.close().then(() => process.exit(0));
});
console.log(
  JSON.stringify({ taskPid: process.pid, origin: await app.getUrl() }),
);
