import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  lstat,
  stat,
  chmod,
} from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  X509Certificate,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  createHash,
} from "node:crypto";
import { createCertificates } from "./m15-03-tls-fixture.mjs";
import { packageRelease } from "../../../tools/upgrades/package-release.mjs";
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const built = createRequire(import.meta.url);
const digest = "a".repeat(64);
export function validateFixtureConfig(config) {
  assert.deepEqual(
    Object.keys(config).sort(),
    ["host", "port", "taskRoot", "staticRoot", "instanceId"].sort(),
  );
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 3448);
  assert.match(
    config.instanceId,
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,
  );
  assert.equal(resolve(config.taskRoot), config.taskRoot);
  assert.match(config.taskRoot, /^\/tmp\/cra-m15-06-browser-[A-Za-z0-9_-]+$/);
  assert.equal(config.staticRoot, join(repository, "apps/operator/out"));
  return config;
}
/** Deliberately simulated native port. Signature verification, controller and journal are real. */
export function simulatedLifecycle(plan, mode = "success") {
  let observation = {
    maintenance: false,
    claimsStopped: false,
    drained: false,
    effectsCertain: true,
    images: plan.previousImages,
    ledger: [],
    ledgerDigest: plan.expectedLedgerDigest,
    schemaDigest: plan.targetSchemaDigest,
    candidateReady: false,
    workersReady: false,
  };
  const update = async (patch) => {
    observation = { ...observation, ...patch };
  };
  return {
    observe: async () => observation,
    assertFresh: async () => {},
    closeIngress: () => update({ maintenance: true }),
    stopClaims: () => update({ claimsStopped: true }),
    drain: () => update({ drained: true }),
    holdVerifiedBackup: async () => {},
    migrate: () => update({ ledger: plan.migrations.map((item) => item.name) }),
    startCandidate: (images) => update({ images, candidateReady: true }),
    verifyCandidate: async () => {
      if (mode === "rollback")
        throw new Error("simulated candidate health failure");
    },
    startWorkers: () => update({ workersReady: true }),
    openIngress: () => update({ maintenance: false }),
    verifyActivated: async () => {},
    restorePreviousImages: (images) => update({ images, candidateReady: true }),
  };
}
export async function startFixture(config) {
  const taskRoot =
    config?.taskRoot ?? (await mkdtemp("/tmp/cra-m15-06-browser-"));
  config = validateFixtureConfig(
    config ?? {
      host: "127.0.0.1",
      port: 3448,
      taskRoot,
      staticRoot: join(repository, "apps/operator/out"),
      instanceId: "11111111-1111-4111-8111-111111111111",
    },
  );
  const root = await lstat(taskRoot);
  assert.ok(root.isDirectory() && !root.isSymbolicLink());
  await chmod(taskRoot, 0o700);
  await stat(join(config.staticRoot, "index.html"));
  await writeFile(
    join(taskRoot, "task-fixture.json"),
    JSON.stringify({
      purpose: "M15-06 simulated-native browser fixture",
      instanceId: config.instanceId,
    }),
    { flag: "wx", mode: 0o600 },
  );
  const directories = ["certs", "inbox", "stage", "journal", "inputs"];
  for (const name of directories)
    await mkdir(join(taskRoot, name), { mode: 0o700 });
  const tls = await createCertificates(join(taskRoot, "certs"));
  const grantsPath = join(taskRoot, "grants.json");
  const principalId = randomUUID();
  const grant = {
    fingerprint256: new X509Certificate(tls.cert).fingerprint256,
    principalId,
    instanceIds: [config.instanceId],
    tenantScopes: [],
    backupScopes: [],
    upgradeScopes: [
      {
        instanceId: config.instanceId,
        actions: [
          "upgrades.view",
          "upgrades.stage",
          "upgrades.apply",
          "upgrades.rollback",
        ],
      },
    ],
  };
  await writeFile(
    grantsPath,
    JSON.stringify({ revision: "browser-simulation-1", grants: [grant] }),
    { mode: 0o600 },
  );
  const pair = generateKeyPairSync("ed25519");
  const keyPath = join(taskRoot, "release-signing.pem");
  await writeFile(
    keyPath,
    pair.privateKey.export({ type: "pkcs8", format: "pem" }),
    { mode: 0o600 },
  );
  await writeFile(
    join(taskRoot, "inputs", "api.tar"),
    "SIMULATED_IMAGE_BYTES_NOT_A_DEPLOYABLE_IMAGE",
    { mode: 0o600 },
  );
  await writeFile(
    join(taskRoot, "inputs", "sbom.json"),
    JSON.stringify({
      bomFormat: "CycloneDX",
      components: [
        {
          type: "application",
          name: "cra-browser-simulation",
          version: "1.1.0",
        },
      ],
    }),
    { mode: 0o600 },
  );
  const now = new Date();
  const expiry = new Date(now.getTime() + 86400000).toISOString();
  const media = [];
  for (const [index, mode] of ["success", "rollback", "blocked"].entries()) {
    const label = `simulation-${mode}`;
    const manifest = {
      manifestVersion: 1,
      purpose: "cra-offline-application-release",
      issuer: "browser-simulation",
      releaseId: randomUUID(),
      version: `1.1.${index}`,
      sequence: index + 1,
      issuedAt: new Date(now.getTime() - 60000).toISOString(),
      expiresAt: expiry,
      platform: { os: "linux", architecture: "amd64" },
      compatibility: {
        sourceVersions: ["1.0.0"],
        sourceManifestDigests: [digest],
        sourceSchemaDigests: [digest],
        targetSchemaDigest: digest,
        supervisorVersions: ["1.0.0"],
      },
      infrastructure: {
        postgres: digest,
        auth: digest,
        rest: digest,
        storage: digest,
        supervisor: digest,
      },
      requirements: {
        diskBytes: 1,
        memoryBytes: 1,
        backupRequired: true,
        keyRequired: true,
      },
      expectedOutageSeconds: 30,
      licenseEffects: ["unchanged"],
      rollback: { imageOnly: true, backwardCompatible: true },
    };
    const packageConfig = join(taskRoot, `package-${mode}.json`);
    await writeFile(
      packageConfig,
      JSON.stringify({
        manifest,
        kid: "browser-fixture",
        images: [
          {
            service: "api",
            digest: `sha256:${digest}`,
            path: join(taskRoot, "inputs", "api.tar"),
          },
        ],
        migrations: [],
        sbomPath: join(taskRoot, "inputs", "sbom.json"),
      }),
      { mode: 0o600 },
    );
    await packageRelease(
      packageConfig,
      keyPath,
      join(taskRoot, "inbox", label),
    );
    media.push({
      id: randomUUID(),
      label,
      mode,
      discoveredAt: now.toISOString(),
      bytes: (await stat(join(taskRoot, "inbox", label, "payload.tar"))).size,
    });
  }
  const { MountedUpgradeMediaVerifier } = built(
    "../dist/upgrades/infrastructure/media/mounted-upgrade-media.js",
  );
  const verifier = new MountedUpgradeMediaVerifier({
    inboxRoot: join(taskRoot, "inbox"),
    stagingRoot: join(taskRoot, "stage"),
    trust: {
      version: 1,
      minimumVersion: 1,
      keys: [
        {
          kid: "browser-fixture",
          issuer: "browser-simulation",
          publicKey: pair.publicKey
            .export({ type: "spki", format: "pem" })
            .toString(),
          notBefore: new Date(now.getTime() - 60000).toISOString(),
          notAfter: expiry,
          revoked: false,
        },
      ],
    },
  });
  const { UpgradeHostJournal } = built(
    "../dist/upgrades/infrastructure/journal/upgrade-host-journal.js",
  );
  const queues = new Map();
  const lock = {
    run: async (path, effect) => {
      const prior = queues.get(path) ?? Promise.resolve();
      let release;
      const pending = new Promise((resolve) => {
        release = resolve;
      });
      queues.set(
        path,
        prior.then(() => pending),
      );
      await prior;
      try {
        return await effect(new AbortController().signal);
      } finally {
        release();
      }
    },
  };
  const journal = new UpgradeHostJournal({
    root: join(taskRoot, "journal"),
    key: randomBytes(32),
    instanceId: config.instanceId,
    minimumSequence: 0,
    lock,
  });
  const { UpgradeSupervisor } = built(
    "../dist/upgrades/application/upgrade-supervisor.js",
  );
  const { preflightUpgrade } = built(
    "../dist/upgrades/domain/upgrade-preflight.js",
  );
  const lifecycles = new Map();
  const modes = new Map();
  const prepare = async (bundle, actor, runId, window) => {
    await verifier.revalidate(bundle);
    const mode = modes.get(bundle.manifest.releaseId);
    const checkedAt = window?.checkedAt ?? new Date().toISOString();
    const expiresAt =
      window?.expiresAt ?? new Date(Date.now() + 300000).toISOString();
    const facts = {
      instanceId: config.instanceId,
      manifestDigest: bundle.manifestDigest,
      stagedInventoryDigest: bundle.manifestDigest,
      currentVersion: "1.0.0",
      currentManifestDigest: digest,
      currentSchemaDigest: digest,
      sourceVersions: ["1.0.0"],
      sourceManifestDigests: [digest],
      sourceSchemaDigests: [digest],
      targetSchemaDigest: digest,
      supervisorVersion: "1.0.0",
      supervisorVersions: ["1.0.0"],
      runtimeDigests: bundle.manifest.infrastructure,
      requiredRuntimeDigests: bundle.manifest.infrastructure,
      freeBytes: mode === "blocked" ? 0 : 10000000,
      requiredBytes: 1,
      memoryBytes: 10000000,
      requiredMemoryBytes: 1,
      platform: "linux/amd64",
      targetPlatform: "linux/amd64",
      ledgerDigest: digest,
      expectedLedgerDigest: digest,
      pendingMigrations: [],
      signedMigrations: [],
      migrationsTransactional: true,
      previousCompatibleAfterCandidateWrites: true,
      backupCertificateDigest: digest,
      backupVerified: true,
      backupHeld: true,
      requiredKeysAvailable: true,
      licenceAllowsUpgrade: true,
      processInventoryComplete: true,
      unmanagedWriters: false,
      concurrentMaintenance: false,
      authorityDigest: createHash("sha256")
        .update(JSON.stringify(actor))
        .digest("hex"),
      trustDigest: digest,
      checkedAt,
      expiresAt,
    };
    const image = {
      service: "api",
      digest: `sha256:${digest}`,
      imageId: `sha256:${digest}`,
      platform: "linux/amd64",
    };
    const plan = {
      runId,
      fingerprint: preflightUpgrade(facts, new Date()).fingerprint,
      previousImages: [{ ...image, imageId: `sha256:${"b".repeat(64)}` }],
      candidateImages: [image],
      migrations: [],
      baselineLedger: [],
      expectedLedgerDigest: digest,
      targetSchemaDigest: digest,
      previousCompatibleAfterCandidateWrites: true,
    };
    const lifecycle = simulatedLifecycle(plan, mode);
    lifecycles.set(runId, lifecycle);
    return { facts, plan, lifecycle };
  };
  const control = new UpgradeSupervisor({
    instanceId: config.instanceId,
    readGrants: async () => JSON.parse(await readFile(grantsPath, "utf8")),
    journal,
    media: {
      list: async () => ({
        items: media.map(({ id, label, discoveredAt, bytes }) => ({
          id,
          label,
          discoveredAt,
          bytes,
        })),
      }),
      verify: async (id) => {
        const selected = media.find((item) => item.id === id);
        assert.ok(selected);
        const bundle = await verifier.verify(selected.label);
        modes.set(bundle.manifest.releaseId, selected.mode);
        return bundle;
      },
    },
    capabilities: async () => ({
      instanceId: config.instanceId,
      enabled: true,
      actions: grant.upgradeScopes[0].actions,
      platform: { os: "linux", architecture: "amd64" },
      currentVersion: "1.0.0",
      supervisorVersion: "1.0.0",
      maintenance: false,
      version: 0,
    }),
    prepare,
    resume: async (_bundle, _actor, plan) => lifecycles.get(plan.runId),
  });
  const stamp = now.toISOString();
  const instance = {
    instanceId: config.instanceId,
    label: "M15-06 simulated native deployment",
    version: "1.0.0",
    expectedVersion: "1.1.0",
    versionDrift: "different",
    versionSourceAt: stamp,
    status: "stale",
    lastObservedAt: stamp,
    sources: [],
  };
  const reader = {
    read: async (_identity, kind) =>
      kind === "instances"
        ? {
            schemaVersion: 1,
            observedAt: stamp,
            instances: [instance],
            nextCursor: null,
          }
        : kind === "detail"
          ? { schemaVersion: 1, observedAt: stamp, instance }
          : kind === "tenants"
            ? {
                schemaVersion: 1,
                observedAt: stamp,
                instanceId: config.instanceId,
                tenants: [],
                nextCursor: null,
              }
            : {
                schemaVersion: 1,
                observedAt: stamp,
                sourceAt: stamp,
                revision: 1,
                instanceId: config.instanceId,
                instance,
                tenants: [],
                nextCursor: null,
              },
  };
  const { createOperatorApplication } = built(
    "../dist/operator/operator-listener.js",
  );
  const app = await createOperatorApplication(
    {
      ...config,
      ca: tls.ca,
      cert: tls.serverCert,
      key: tls.serverKey,
      grantsPath,
    },
    reader,
    undefined,
    control,
  );
  await app.listen(config.port, config.host);
  const summary = {
    origin: await app.getUrl(),
    taskRoot,
    certificateDirectory: join(taskRoot, "certs"),
    instanceId: config.instanceId,
    media: media.map(({ id, label }) => ({ id, label })),
    simulation: true,
  };
  await writeFile(
    join(taskRoot, "browser-summary.json"),
    JSON.stringify(summary, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(summary));
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => void app.close().then(() => process.exit(0)));
  return { app, summary, control };
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  void startFixture().catch(() => {
    process.stderr.write("M15-06 simulated browser fixture failed safely\n");
    process.exitCode = 1;
  });
