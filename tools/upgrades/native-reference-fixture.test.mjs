import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createScenarioDriver,
  validateAuthorityIsolation,
  createNativeReferenceFixture,
} from "./native-reference-fixture.mjs";
function fixture({ finalState = "success", allowed = true } = {}) {
  let state = "awaiting-initiation",
    version = 0;
  const actions = [];
  const io = {
    execute: async (action, input) => {
      actions.push({ action, input });
      if (action === "capabilities/read") return { version: version++ };
      if (action === "media/list")
        return { items: [{ id: "media", label: "candidate" }] };
      if (action === "media/stage") return { id: "run", state };
      if (action === "run/read") return { id: "run", state };
      if (action === "run/preflight")
        return { allowed, fingerprint: "a".repeat(64) };
      if (action === "run/apply") {
        state = finalState;
        return { id: "run", state };
      }
      if (action === "run/reconcile") return { id: "run", state };
      if (action === "run/rollback") {
        state = "rolled-back";
        return { id: "run", state };
      }
      throw new Error("unexpected action");
    },
    sleep: async () => {},
    observe: async () => ({
      sourceRunning: state !== "success",
      targetRunning: state === "success",
      databaseReady: true,
      exposed: state === "success",
    }),
    readMetadata: async () => ({}),
    ownerFlow: async () => ({
      loginStatus: 200,
      navigationStatus: 200,
      sessionCookie: true,
    }),
    assertEgressDenied: async () => ({ egressDenied: true }),
    restartSupervisor: async () => {},
    loseApplyReply: async (input) => {
      await io.execute("run/apply", input);
    },
    refuseDrain: async () => {},
  };
  return { driver: createScenarioDriver(io), actions };
}
test("native driver sends stage/preflight/fingerprint-bound apply and observes success", async () => {
  const { driver, actions } = fixture();
  const observations = await driver.exercise("forward-upgrade", {
    signal: AbortSignal.timeout(1000),
  });
  await driver.assertNativeOutcome("forward-upgrade", observations);
  assert.deepEqual(
    actions
      .filter((x) =>
        ["media/stage", "run/preflight", "run/apply"].includes(x.action),
      )
      .map((x) => x.action),
    ["media/stage", "run/preflight", "run/apply"],
  );
  assert.equal(
    actions.find((x) => x.action === "run/apply").input.fingerprint,
    "a".repeat(64),
  );
});
test("native preflight refusal cannot produce qualification evidence", async () => {
  const { driver, actions } = fixture({ allowed: false });
  await assert.rejects(
    driver.exercise("forward-upgrade", { signal: AbortSignal.timeout(1000) }),
    /preflight blocked/,
  );
  assert(!actions.some((x) => x.action === "run/apply"));
  await assert.rejects(
    driver.assertNativeOutcome("forward-upgrade", [{ passed: true }]),
    /not proven/,
  );
});
test("lost acknowledgement actually sends apply and reconciles through real protocol", async () => {
  const { driver, actions } = fixture();
  const observations = await driver.exercise("lost-acknowledgement", {
    signal: AbortSignal.timeout(1000),
  });
  await driver.assertNativeOutcome("lost-acknowledgement", observations);
  assert(actions.some((x) => x.action === "run/reconcile"));
});
test("drain refusal and pre-exposure image rollback require their actual native outcomes", async () => {
  for (const [name, state] of [
    ["drain-refusal", "rollback-required"],
    ["image-rollback", "rolled-back"],
  ]) {
    const { driver } = fixture({ finalState: state });
    const observation = await driver.exercise(name, {
      signal: AbortSignal.timeout(1000),
    });
    await driver.assertNativeOutcome(name, observation);
  }
  const { driver } = fixture();
  await assert.rejects(
    driver.exercise("drain-refusal", { signal: AbortSignal.timeout(1000) }),
    /exposed/,
  );
});
test("fixed native fixture refuses source authority and arbitrary executables", async () => {
  const root = "/var/lib/cra-qualification/run/case",
    project = "cra-qualification-abc-case";
  assert.doesNotThrow(() =>
    validateAuthorityIsolation(
      {
        journalRoot: `${root}/journal`,
        databaseUrl: `postgres://u:p@${project}-postgres/db`,
        dockerExecutable: "/usr/bin/docker",
      },
      root,
      project,
    ),
  );
  for (const value of [
    { journalRoot: "/original/data" },
    { databaseUrl: "postgres://u:p@127.0.0.1:54322/db" },
    { PGHOST: "source-db" },
    { DOCKER_HOST: "tcp://remote:2375" },
    { dockerExecutable: "/private/runner.sh" },
  ])
    assert.throws(() => validateAuthorityIsolation(value, root, project));
  await assert.rejects(
    createNativeReferenceFixture({
      project: "original",
      root: "/original",
      release: {},
    }),
    /prerequisite/,
  );
});
test("factory materializes a bound disposable profile and uses native adapters rather than a missing hook", async () => {
  const fs = await import("node:fs/promises"),
    os = await import("node:os"),
    path = await import("node:path");
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "cra-native-fixture-test-"),
  );
  try {
    const template = path.join(temporary, "template"),
      root = path.join(temporary, "run");
    await fs.mkdir(template);
    await fs.mkdir(root);
    const project = "cra-qualification-abc-n-forward",
      instanceId = "12345678-1234-4234-8234-123456789abc",
      imageId = `sha256:${"a".repeat(64)}`;
    const fixtureConfig = {
      version: 1,
      project: "__CRA_PROJECT__",
      instanceId,
      composePath: "__CRA_ROOT__/compose.yml",
      supervisorConfigPath: "__CRA_ROOT__/supervisor.json",
      actor: { principalId: instanceId },
      metadata: {
        origin: "https://127.0.0.1:24000",
        caPath: "__CRA_ROOT__/ca.pem",
        certPath: "__CRA_ROOT__/cert.pem",
        keyPath: "__CRA_ROOT__/key.pem",
      },
      customer: {
        origin: "https://127.0.0.1:24001",
        caPath: "__CRA_ROOT__/ca.pem",
      },
      ownerCredentialsPath: "__CRA_ROOT__/owner.json",
      environment: { PATH: "/usr/bin" },
      sourceImageIds: { api: imageId },
      targetImageIds: { api: imageId },
    };
    const inspection = {
      instanceId,
      sourceNetwork: "__CRA_PROJECT__-backend",
      installedReceiptPath: "__CRA_ROOT__/installed.json",
      qualificationReceiptPath: "__CRA_ROOT__/qualified.json",
      receiptPublicKey: "test",
      applicationContainers: { "__CRA_PROJECT__-api": "api" },
    };
    const host = {
      deployment: {
        project: "__CRA_PROJECT__",
        composeFile: "__CRA_ROOT__/compose.yml",
        candidateServices: ["api"],
      },
      maintenanceDirectory: "__CRA_ROOT__/control",
      acknowledgementDirectory: "__CRA_ROOT__/acks",
      drainServices: ["api"],
    };
    const config = {
      instanceId,
      socketPath: "__CRA_ROOT__/control.sock",
      journalRoot: "__CRA_ROOT__/journal",
      controlKeyPath: "__CRA_ROOT__/control.key",
      journalKeyPath: "__CRA_ROOT__/journal.key",
      trustPath: "__CRA_ROOT__/trust.json",
      grantsPath: "__CRA_ROOT__/grants.json",
      inboxRoot: "__CRA_ROOT__/inbox",
      stagingRoot: "__CRA_ROOT__/stage",
      runtime: { inspection, host },
    };
    for (const [name, data] of Object.entries({
      "fixture.json": fixtureConfig,
      "supervisor.json": config,
      "trust.json": {},
      "installed.json": {},
      "qualified.json": {},
    }))
      await fs.writeFile(path.join(template, name), JSON.stringify(data));
    await fs.writeFile(
      path.join(template, "compose.yml"),
      "name: __CRA_PROJECT__\n",
    );
    await fs.writeFile(path.join(template, "control.key"), "test-key");
    const payload = path.join(temporary, "payload.tar"),
      signature = path.join(temporary, "release.jws");
    await fs.writeFile(payload, "test");
    await fs.writeFile(signature, "test");
    let verified = 0,
      state = "awaiting-initiation",
      mode = "success",
      tlsMode = "healthy",
      dockerMode = "healthy",
      capFailures = 0;
    const loaded = [];
    for (const directory of ["control", "acks", "acks/api"])
      await fs.mkdir(path.join(template, directory));
    await fs.writeFile(
      path.join(template, "control/request.json"),
      JSON.stringify({ version: 1, generation: instanceId, closed: false }),
    );
    await fs.writeFile(
      path.join(template, "owner.json"),
      JSON.stringify({ email: "owner@fixture.test", password: "test-only" }),
    );
    const bundle = {
      manifestDigest: "b".repeat(64),
      manifest: {
        platform: { os: "linux", architecture: "amd64" },
        images: [
          { service: "api", digest: imageId },
          { service: "web", digest: imageId },
        ],
        compatibility: {
          sourceManifestDigests: ["b".repeat(64)],
          targetSchemaDigest: "f".repeat(64),
        },
      },
    };
    const loadNative = async (name) => {
      if (name.endsWith("upgrade-supervisor-runtime.js"))
        return { upgradeSupervisorMountSchema: { parse: (v) => v } };
      if (name.endsWith("upgrade-supervisor-runtime-compose.js"))
        return { upgradeSupervisorCompositionSchema: { parse: (v) => v } };
      if (name.endsWith("local-upgrade-control.js"))
        return {
          LocalUpgradeControlClient: class {
            async execute(_instance, _actor, action, value) {
              if (action === "capabilities/read") {
                if (capFailures-- > 0) throw new Error("restarting");
                return { version: 0 };
              }
              if (action === "media/list")
                return { items: [{ id: "media", label: "candidate" }] };
              if (action === "media/stage") {
                state = "awaiting-initiation";
                return { id: "run", state };
              }
              if (action === "run/preflight")
                return { allowed: true, fingerprint: "a".repeat(64) };
              if (action === "run/apply") {
                state = mode;
                return { id: "run", state };
              }
              if (action === "run/read" || action === "run/reconcile")
                return { id: "run", state };
              if (action === "run/rollback") {
                state = "rolled-back";
                return { id: "run", state };
              }
              throw new Error("unexpected authenticated action " + action);
            }
          },
          readUpgradeControlKey: async () => Buffer.alloc(32),
        };
      if (name.endsWith("mounted-upgrade-media.js"))
        return {
          MountedUpgradeMediaVerifier: class {
            async verify() {
              verified++;
              return bundle;
            }
          },
        };
      if (name.endsWith("native-upgrade-inspection.js")) {
        const sourceImageIds = { api: imageId, web: imageId },
          sourcePlatform = "linux/amd64";
        return {
          installedUpgradeReceiptSchema: { parse: (value) => value },
          upgradeQualificationReceiptSchema: { parse: (value) => value },
          verifyInspectionReceipt: (_encoded, _key, purpose) =>
            purpose === "installed"
              ? {
                  instanceId,
                  manifestDigest: bundle.manifestDigest,
                  sourceImageIds,
                  sourcePlatform,
                  schemaDigest: "e".repeat(64),
                  version: "1.0.0",
                  ledgerDigest: "c".repeat(64),
                  schemaAlgorithm: "pg-dump-schema-v1",
                }
              : {
                  instanceId,
                  sourceManifestDigest: bundle.manifestDigest,
                  candidateManifestDigest: bundle.manifestDigest,
                  sourceImageIds,
                  sourcePlatform,
                  candidateImageIds: sourceImageIds,
                  targetLedgerDigest: "d".repeat(64),
                  sourceSchemaDigest: "e".repeat(64),
                  targetSchemaDigest: "f".repeat(64),
                  expiresAt: "2099-01-01T00:00:00Z",
                  previousCompatibleAfterCandidateWrites: true,
                  atomicLedger: true,
                  cliVersion: "2.111.0",
                },
        };
      }
      if (name.endsWith("load-verified-upgrade-images.js"))
        return {
          loadVerifiedUpgradeImages: async (bundle) => {
            loaded.push(bundle.manifestDigest);
          },
        };
      if (name.endsWith("linux-deployment.adapter.js"))
        return { ShellFreeCommandRunner: class {} };
      if (name.endsWith("upgrade-host-journal.js"))
        return {
          UpgradeHostJournal: class {
            async read() {
              return [
                {
                  runId: "run",
                  kind: "execution",
                  data: { exposurePossible: state === "success" },
                },
              ];
            }
          },
        };
      throw new Error("unexpected native adapter");
    };
    const input = {
      project,
      root,
      scenario: "forward-upgrade",
      release: {
        generation: "N",
        fixtureTemplateDirectory: template,
        source: {
          payload: { path: payload },
          signature: { path: signature },
        },
        target: {
          payload: { path: payload },
          signature: { path: signature },
        },
      },
    };
    const dependencies = {
      fixtureRootPrefix: temporary + "/",
      loadNative,
      sleep: async () => {},
      command: async (args) => {
        if (dockerMode === "error") throw new Error("unavailable Docker");
        if (args[0] === "inspect")
          return JSON.stringify([
            {
              Name: `/${project}-api`,
              Image: imageId,
              State: { Running: true },
            },
          ]);
        if (args.includes("ps"))
          return dockerMode === "empty"
            ? "[]"
            : JSON.stringify([{ ID: "container" }]);
        if (args.includes("exec"))
          return dockerMode === "egress" ? "connected" : "denied";
        if (args.includes("restart")) {
          capFailures = 1;
          return "";
        }
        throw new Error("unexpected Docker args");
      },
      tlsRequest: async (_config, path) => {
        if (tlsMode === "error") throw new Error("local TLS failed");
        if (path.includes("/operator/"))
          return {
            status: tlsMode === "bad-status" ? 403 : 200,
            body: JSON.stringify({
              instanceId: tlsMode === "bad-instance" ? "other" : instanceId,
            }),
          };
        if (path === "/api/v1/health/ready")
          return { status: 200, body: JSON.stringify({ status: "ok" }) };
        if (path === "/api/v1/auth/sign-in")
          return { status: 200, cookies: ["cra_at=fixture; HttpOnly"] };
        if (path === "/dashboard")
          return {
            status: 200,
            body:
              tlsMode === "login-page" ? "<title>Sign-in</title>" : "dashboard",
          };
        throw new Error("unexpected TLS request");
      },
    };
    const fixture = await createNativeReferenceFixture(input, dependencies);
    assert.equal(fixture.kind, "native-linux-compose");
    assert.equal(verified, 2);
    assert(fixture.composePath.startsWith(root + "/N-forward-upgrade/"));
    assert.equal(typeof fixture.exercise, "function");
    assert.equal(
      (await fs.readFile(fixture.composePath, "utf8")).trim(),
      `name: ${project}`,
    );
    const signal = () => AbortSignal.timeout(1000);
    await fixture.prepareImages();
    assert.equal(loaded.length, 2);
    await fixture.waitReady({ signal: signal() });
    for (const scenario of [
      "fresh-install",
      "owner-auth-navigation",
      "egress-denied",
      "forward-upgrade",
      "restart-reconcile",
      "lost-acknowledgement",
    ]) {
      mode = "success";
      const observations = await fixture.exercise(scenario, {
        signal: signal(),
      });
      await fixture.assertNativeOutcome(scenario, observations);
    }
    mode = "rollback-required";
    await fixture.assertNativeOutcome(
      "drain-refusal",
      await fixture.exercise("drain-refusal", { signal: signal() }),
    );
    mode = "rolled-back";
    await fixture.assertNativeOutcome(
      "image-rollback",
      await fixture.exercise("image-rollback", { signal: signal() }),
    );
    for (const bad of ["bad-status", "bad-instance"]) {
      tlsMode = bad;
      await assert.rejects(fixture.readMetadata({ signal: signal() }));
    }
    tlsMode = "login-page";
    await assert.rejects(
      fixture.exercise("owner-auth-navigation", { signal: signal() }),
      /sign-in/,
    );
    tlsMode = "healthy";
    dockerMode = "egress";
    await assert.rejects(
      fixture.exercise("egress-denied", { signal: signal() }),
      /egress/,
    );
    dockerMode = "empty";
    await assert.rejects(
      fixture.exercise("fresh-install", { signal: signal() }),
      /containers missing/,
    );
    dockerMode = "healthy";
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(fixture.waitReady({ signal: aborted.signal }));
    const rollback = await createNativeReferenceFixture(
      { ...input, scenario: "image-rollback" },
      dependencies,
    );
    const mounted = JSON.parse(
      await fs.readFile(path.join(rollback.root, "supervisor.json"), "utf8"),
    );
    assert.equal(
      mounted.runtime.host.candidateReadinessUrl,
      "https://127.0.0.1:65534/api/v1/health/ready",
    );
    const originalConfig = await fs.readFile(
      path.join(template, "fixture.json"),
      "utf8",
    );
    for (const change of [
      { version: 2 },
      {
        metadata: { ...fixtureConfig.metadata, origin: "http://remote:24000" },
      },
      { ownerCredentialsPath: "/original/owner.json" },
    ]) {
      await fs.writeFile(
        path.join(template, "fixture.json"),
        JSON.stringify({ ...fixtureConfig, ...change }),
      );
      await assert.rejects(
        createNativeReferenceFixture(
          { ...input, scenario: "bad-" + String(Math.random()) },
          dependencies,
        ),
        /prerequisite/,
      );
    }
    await fs.writeFile(path.join(template, "fixture.json"), originalConfig);
    bundle.manifest.compatibility.sourceManifestDigests = [];
    await assert.rejects(
      createNativeReferenceFixture(
        { ...input, scenario: "bad-receipt" },
        dependencies,
      ),
      /checkpoint/,
    );
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
