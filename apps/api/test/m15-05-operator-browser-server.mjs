import assert from "node:assert/strict";
import { chmod, readFile, mkdir, access, lstat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { X509Certificate } from "node:crypto";
import { createCertificates } from "./m15-03-tls-fixture.mjs";

/** Task-only fixture: mounted file names are configuration, credential values stay private. */
export function validateFixtureConfig(config) {
  const keys = [
    "host",
    "port",
    "databaseOrigin",
    "instanceId",
    "certificateDirectory",
    "readerJwtFile",
    "backupControlJwtFile",
    "projectApiKeyFile",
    "grantsPath",
    "staticRoot",
  ];
  assert.deepEqual(Object.keys(config).sort(), [...keys].sort());
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 3447);
  assert.match(
    config.instanceId,
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,
  );
  const database = new URL(config.databaseOrigin);
  assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
  assert.equal(database.protocol, "http:");
  assert.equal(
    database.username + database.password + database.search + database.hash,
    "",
  );
  assert.equal(database.pathname, "/");
  for (const key of keys.filter(
    (key) => !["host", "port", "instanceId", "databaseOrigin"].includes(key),
  )) {
    assert.equal(typeof config[key], "string");
    assert.ok(isAbsolute(config[key]));
    assert.ok(!config[key].includes("\0"));
  }
  assert.ok(
    config.certificateDirectory
      .split("/")
      .some((part) => part.includes("m15-05")),
  );
  assert.notEqual(config.readerJwtFile, config.backupControlJwtFile);
  return config;
}

async function mountedSecret(path) {
  const file = await lstat(path);
  assert.ok(file.isFile() && !file.isSymbolicLink());
  assert.equal(file.mode & 0o077, 0);
  const value = (await readFile(path, "utf8")).trim();
  assert.ok(value.length > 0 && value.length <= 32_768);
  return value;
}

export async function startFixture(
  env = process.env,
  argv = process.argv.slice(2),
) {
  assert.ok(
    argv.length === 0 ||
      (argv.length === 1 && argv[0] === "--prepare-certificates"),
  );
  assert.ok(env.M15_05_OPERATOR_SERVER_CONFIG_FILE);
  const config = validateFixtureConfig(
    JSON.parse(await readFile(env.M15_05_OPERATOR_SERVER_CONFIG_FILE, "utf8")),
  );
  await mkdir(config.certificateDirectory, { recursive: true, mode: 0o700 });
  const directory = await lstat(config.certificateDirectory);
  assert.ok(directory.isDirectory() && !directory.isSymbolicLink());
  await chmod(config.certificateDirectory, 0o700);
  const existing = await access(
    join(config.certificateDirectory, "server.crt"),
  ).then(
    () => true,
    () => false,
  );
  if (!existing) await createCertificates(config.certificateDirectory);
  const load = (name) => readFile(join(config.certificateDirectory, name));
  const [ca, cert, key, client] = await Promise.all([
    load("ca.crt"),
    load("server.crt"),
    load("server.key"),
    load("client.crt"),
  ]);
  if (argv[0] === "--prepare-certificates") {
    console.log(
      JSON.stringify({
        origin: `https://${config.host}:${config.port}`,
        fingerprint256: new X509Certificate(client).fingerprint256,
      }),
    );
    return null;
  }
  const [reader, control, projectApiKey] = await Promise.all([
    mountedSecret(config.readerJwtFile),
    mountedSecret(config.backupControlJwtFile),
    mountedSecret(config.projectApiKeyFile),
  ]);
  const built = createRequire(import.meta.url);
  const { createOperatorApplication } = built(
    "../dist/operator/operator-listener.js",
  );
  const { NarrowRegistryClient } = built(
    "../dist/operator/operator-registry.client.js",
  );
  const { NarrowBackupControlClient } = built(
    "../dist/backups/infrastructure/backup-control.client.js",
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
    new NarrowRegistryClient(config.databaseOrigin, reader, projectApiKey),
    new NarrowBackupControlClient(
      config.databaseOrigin,
      control,
      projectApiKey,
    ),
  );
  await app.listen(config.port, config.host);
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      void app.close().then(() => process.exit(0));
    });
  console.log(
    JSON.stringify({ taskPid: process.pid, origin: await app.getUrl() }),
  );
  return app;
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  void startFixture().catch(() => {
    process.stderr.write(
      "M15-05 private browser fixture failed to start safely\n",
    );
    process.exitCode = 1;
  });
