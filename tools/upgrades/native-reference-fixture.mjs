import { run, materialize, tlsRequest } from "./native-reference-io.mjs";
import {
  readFile,
  writeFile,
  mkdir,
  lstat,
  chmod,
  copyFile,
} from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { join, resolve, relative, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function within(root, path) {
  return (
    typeof path === "string" &&
    path.startsWith(root + "/") &&
    !relative(root, path).startsWith("..")
  );
}
function fail(message) {
  throw new Error(`reference_fixture_prerequisite: ${message}`);
}
/** Real native supervisor protocol. A fixture cannot report a pass boolean. */
export function createScenarioDriver(io) {
  let current;
  const execute = (action, input = {}, signal) =>
    io.execute(action, input, signal);
  const mutation = async (action, extra = {}, signal) => {
    const head = await execute("capabilities/read", {}, signal);
    return execute(
      action,
      {
        expectedVersion: head.version,
        idempotencyKey: randomUUID(),
        ...(current ? { runId: current.id } : {}),
        ...extra,
      },
      signal,
    );
  };
  const wait = async (states, signal) => {
    for (;;) {
      signal?.throwIfAborted();
      current = await execute("run/read", { runId: current.id }, signal);
      if (states.includes(current.state)) return current;
      if (
        ["failed", "rollback-required", "rolled-back"].includes(current.state)
      )
        throw new Error(`unexpected native run outcome ${current.state}`);
      await io.sleep(100);
    }
  };
  async function stage(signal) {
    const media = await execute("media/list", {}, signal);
    const candidate = media.items.find((item) => item.label === "candidate");
    if (!candidate) throw new Error("verified candidate media absent");
    current = await mutation("media/stage", { mediaId: candidate.id }, signal);
    await wait(["awaiting-initiation", "preflight"], signal);
    const review = await mutation("run/preflight", {}, signal);
    if (review.allowed !== true || !/^[a-f0-9]{64}$/.test(review.fingerprint))
      throw new Error("native preflight blocked");
    return review;
  }
  async function apply(signal) {
    const review = await stage(signal);
    await mutation(
      "run/apply",
      { fingerprint: review.fingerprint, acknowledgedEffects: true },
      signal,
    );
  }
  return {
    async exercise(name, { signal }) {
      const observations = [];
      if (name === "fresh-install") {
        observations.push(await io.observe());
        await io.readMetadata({ signal });
        return observations;
      }
      if (name === "owner-auth-navigation") {
        observations.push(await io.ownerFlow(signal));
        return observations;
      }
      if (name === "egress-denied") {
        observations.push(await io.assertEgressDenied(signal));
        return observations;
      }
      if (name === "drain-refusal") {
        await io.refuseDrain(true);
        try {
          await apply(signal);
          for (;;) {
            signal.throwIfAborted();
            current = await execute("run/read", { runId: current.id }, signal);
            const observation = await io.observe(current.id);
            if (["rollback-required", "failed"].includes(current.state)) {
              observations.push({ run: current, ...observation });
              break;
            }
            if (current.state === "success" || observation.exposed)
              throw new Error("drain refusal exposed candidate");
            await io.sleep(100);
          }
        } finally {
          await io.refuseDrain(false);
        }
        return observations;
      }
      if (name === "image-rollback") {
        // Fixture's closed candidate readiness endpoint forces a pre-exposure failure.
        await apply(signal);
        for (;;) {
          signal.throwIfAborted();
          current = await execute("run/read", { runId: current.id }, signal);
          if (["rolled-back", "rollback-required"].includes(current.state))
            break;
          if (current.state === "success")
            throw new Error("rollback fault did not prevent exposure");
          await io.sleep(100);
        }
        if (current.state === "rollback-required")
          await mutation("run/rollback", {}, signal);
        current = await wait(["rolled-back"], signal);
        observations.push({ run: current, ...(await io.observe(current.id)) });
        return observations;
      }
      if (name === "lost-acknowledgement") {
        const review = await stage(signal);
        const input = {
          expectedVersion: (await execute("capabilities/read")).version,
          idempotencyKey: randomUUID(),
          runId: current.id,
          fingerprint: review.fingerprint,
          acknowledgedEffects: true,
        };
        // Drop only the reply after the real authenticated command was sent. Require
        // durable admission to distinguish a lost response from an unsent request.
        await io.loseApplyReply(input, signal);
        current = await execute("run/read", { runId: current.id }, signal);
        if (
          ["preflight", "awaiting-initiation", "verifying"].includes(
            current.state,
          )
        )
          throw new Error(
            "lost acknowledgement command was not durably admitted",
          );
        await io.restartSupervisor();
        await mutation("run/reconcile", {}, signal);
      } else if (name === "restart-reconcile") {
        await apply(signal);
        await io.restartSupervisor();
        await mutation("run/reconcile", {}, signal);
      } else if (name === "forward-upgrade") await apply(signal);
      else throw new Error("unknown fixed reference scenario");
      current = await wait(["success"], signal);
      observations.push({ run: current, ...(await io.observe(current.id)) });
      return observations;
    },
    async assertNativeOutcome(name, observations) {
      if (!Array.isArray(observations) || observations.length !== 1)
        throw new Error("native observation missing");
      const value = observations[0];
      if (
        name === "fresh-install" &&
        (!value.sourceRunning || !value.databaseReady)
      )
        throw new Error("fresh source stack not ready");
      if (
        name === "owner-auth-navigation" &&
        (value.loginStatus !== 200 ||
          value.navigationStatus !== 200 ||
          !value.sessionCookie)
      )
        throw new Error("owner session/navigation failed");
      if (name === "egress-denied" && value.egressDenied !== true)
        throw new Error("fixture egress reachable");
      if (
        name === "drain-refusal" &&
        (!["failed", "rollback-required"].includes(value.run?.state) ||
          value.exposed)
      )
        throw new Error("drain refusal not enforced");
      if (
        name === "image-rollback" &&
        (value.run?.state !== "rolled-back" ||
          !value.sourceRunning ||
          value.exposed)
      )
        throw new Error("image rollback not proven");
      if (
        [
          "forward-upgrade",
          "restart-reconcile",
          "lost-acknowledgement",
        ].includes(name) &&
        (value.run?.state !== "success" ||
          !value.targetRunning ||
          !value.databaseReady)
      )
        throw new Error("native target activation not proven");
    },
  };
}
export function validateAuthorityIsolation(value, root, project, key = "") {
  if (Array.isArray(value)) {
    for (const item of value)
      validateAuthorityIsolation(item, root, project, key);
    return;
  }
  if (value && typeof value === "object") {
    if (
      ["infrastructureContainers", "applicationContainers"].includes(key) &&
      (key === "infrastructureContainers"
        ? Object.values(value)
        : Object.keys(value)
      ).some(
        (name) => typeof name !== "string" || !name.startsWith(project + "-"),
      )
    )
      fail("source container inventory forbidden");
    if (
      value.PGHOST === "127.0.0.1" &&
      (Number(value.PGPORT) < 20000 ||
        (Number(value.PGPORT) >= 54320 && Number(value.PGPORT) <= 54329))
    )
      fail("database port overlaps original stack");
    if (value.PGDATABASE && !value.PGHOST)
      fail("explicit fixture database host required");
    for (const [name, item] of Object.entries(value))
      validateAuthorityIsolation(item, root, project, name);
    return;
  }
  if (typeof value !== "string") return;
  if (
    key === "PATH" &&
    !["/usr/bin", "/usr/local/bin:/usr/bin:/bin"].includes(value)
  )
    fail("reviewed system PATH required");
  if (
    [
      "DOCKER_HOST",
      "DOCKER_CONTEXT",
      "SUPABASE_ACCESS_TOKEN",
      "PGSERVICE",
      "PGSERVICEFILE",
      "DOCKER_CONFIG",
      "DOCKER_CLI_PLUGIN_EXTRA_DIRS",
    ].includes(key)
  )
    fail("remote control credentials forbidden");
  if (
    /executable$/i.test(key) &&
    ![
      "/usr/bin/docker",
      "/usr/bin/psql",
      "/usr/bin/pg_dump",
      "/usr/bin/flock",
      "/usr/local/bin/supabase",
    ].includes(value)
  )
    fail("unreviewed executable forbidden");
  if (
    key !== "PATH" &&
    /(?:path|root|directory|cwd)$/i.test(key) &&
    value.startsWith("/") &&
    !within(root, value) &&
    !(
      key.toLowerCase().includes("executable") &&
      /^\/(?:usr\/(?:local\/)?bin|bin)\/[a-z0-9_-]+$/i.test(value)
    )
  )
    fail("authority filesystem escaped fixture");
  if (/(?:database_?url|supabase_url|direct_url)$/i.test(key)) {
    const url = new URL(value);
    if (
      !url.hostname.startsWith(project + "-") &&
      !(
        url.hostname === "127.0.0.1" &&
        Number(url.port) >= 20000 &&
        !(Number(url.port) >= 54320 && Number(url.port) <= 54329)
      )
    )
      fail("database/API authority escaped fixture");
  }
  if (
    /^PGHOST$/i.test(key) &&
    value !== "127.0.0.1" &&
    !value.startsWith(project + "-")
  )
    fail("database host escaped fixture");
}
export async function createNativeReferenceFixture(input, dependencies = {}) {
  const { project, root, release, scenario } = input;
  const command = dependencies.command ?? run,
    requestTls = dependencies.tlsRequest ?? tlsRequest,
    sleep =
      dependencies.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  if (
    !/^cra-qualification-[a-f0-9-]+/.test(project) ||
    !root.startsWith(
      dependencies.fixtureRootPrefix ?? "/var/lib/cra-qualification/",
    ) ||
    !release.fixtureTemplateDirectory?.startsWith("/")
  )
    fail(
      "local provisioned template directory and isolated task identity required",
    );
  const directory = join(root, `${release.generation}-${scenario}`);
  await materialize(release.fixtureTemplateDirectory, directory, {
    __CRA_PROJECT__: project,
    __CRA_ROOT__: directory,
  });
  const configuration = JSON.parse(
    await readFile(join(directory, "fixture.json"), "utf8"),
  );
  const {
    version,
    instanceId,
    composePath,
    supervisorConfigPath,
    actor,
    metadata,
    customer,
    ownerCredentialsPath,
    environment,
  } = configuration;
  validateAuthorityIsolation(environment, directory, project);
  if (
    version !== 1 ||
    !/^\w{8}-\w{4}-\w{4}-\w{4}-\w{12}$/.test(instanceId) ||
    !within(directory, composePath) ||
    !within(directory, supervisorConfigPath) ||
    configuration.project !== project
  )
    fail("fixture identity/path binding invalid");
  for (const channel of [metadata, customer]) {
    const url = new URL(channel.origin);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "127.0.0.1" ||
      Number(url.port) < 20000 ||
      !within(directory, channel.caPath)
    )
      fail("local TLS fixture channels required");
    if (
      channel.certPath &&
      (!within(directory, channel.certPath) ||
        !within(directory, channel.keyPath))
    )
      fail("private local mTLS files required");
  }
  if (!metadata.certPath || !within(directory, ownerCredentialsPath))
    fail("actual mTLS and owner credentials required");
  const load =
    dependencies.loadNative ??
    ((path) =>
      import(pathToFileURL(join(repository, "apps/api/dist", path)).href));
  const [runtime, composition, control, media, inspection] = await Promise.all([
    load("upgrades/infrastructure/control/upgrade-supervisor-runtime.js"),
    load(
      "upgrades/infrastructure/control/upgrade-supervisor-runtime-compose.js",
    ),
    load("upgrades/infrastructure/control/local-upgrade-control.js"),
    load("upgrades/infrastructure/media/mounted-upgrade-media.js"),
    load("upgrades/infrastructure/control/native-upgrade-inspection.js"),
  ]);
  const mounted = runtime.upgradeSupervisorMountSchema.parse(
    JSON.parse(await readFile(supervisorConfigPath, "utf8")),
  );
  const native = composition.upgradeSupervisorCompositionSchema.parse(
    mounted.runtime,
  );
  validateAuthorityIsolation(mounted, directory, project);
  if (
    mounted.instanceId !== instanceId ||
    native.inspection.instanceId !== instanceId ||
    native.host.deployment.project !== project ||
    native.host.deployment.composeFile !== composePath ||
    !within(directory, mounted.socketPath) ||
    !within(directory, mounted.journalRoot) ||
    !within(directory, native.host.acknowledgementDirectory) ||
    !within(directory, native.host.maintenanceDirectory) ||
    native.inspection.sourceNetwork !== `${project}-backend`
  )
    fail("strict native supervisor config escaped fixture");
  for (const path of [
    mounted.controlKeyPath,
    mounted.journalKeyPath,
    mounted.trustPath,
    mounted.grantsPath,
    mounted.inboxRoot,
    mounted.stagingRoot,
    native.inspection.installedReceiptPath,
    native.inspection.qualificationReceiptPath,
  ])
    if (!within(directory, path))
      fail("native authority outside disposable fixture");
  const trust = JSON.parse(await readFile(mounted.trustPath, "utf8"));
  for (const direction of ["source", "target"]) {
    const alias = direction === "target" ? "candidate" : "source";
    const inbox = join(mounted.inboxRoot, alias);
    await mkdir(inbox, { recursive: true, mode: 0o700 });
    await copyFile(release[direction].payload.path, join(inbox, "payload.tar"));
    await copyFile(
      release[direction].signature.path,
      join(inbox, "release.jws"),
    );
  }
  const verifier = new media.MountedUpgradeMediaVerifier({
    inboxRoot: mounted.inboxRoot,
    stagingRoot: mounted.stagingRoot,
    trust,
  });
  const source = await verifier.verify("source"),
    target = await verifier.verify("candidate");
  const checkpoint = inspection.installedUpgradeReceiptSchema.parse(
    inspection.verifyInspectionReceipt(
      await readFile(native.inspection.installedReceiptPath, "utf8"),
      native.inspection.receiptPublicKey,
      "installed",
    ),
  );
  const qualification = inspection.upgradeQualificationReceiptSchema.parse(
    inspection.verifyInspectionReceipt(
      await readFile(native.inspection.qualificationReceiptPath, "utf8"),
      native.inspection.receiptPublicKey,
      "qualification",
    ),
  );
  if (
    checkpoint.instanceId !== instanceId ||
    checkpoint.manifestDigest !== source.manifestDigest ||
    checkpoint.sourcePlatform !==
      `${source.manifest.platform.os}/${source.manifest.platform.architecture}` ||
    qualification.instanceId !== instanceId ||
    qualification.sourceManifestDigest !== source.manifestDigest ||
    qualification.candidateManifestDigest !== target.manifestDigest ||
    qualification.sourcePlatform !== checkpoint.sourcePlatform ||
    ["api", "web"].some(
      (role) =>
        checkpoint.sourceImageIds[role] !==
          source.manifest.images.find((image) => image.service === role)
            ?.digest ||
        qualification.sourceImageIds[role] !==
          checkpoint.sourceImageIds[role] ||
        qualification.candidateImageIds[role] !==
          target.manifest.images.find((image) => image.service === role)
            ?.digest,
    ) ||
    !/^[a-f0-9]{64}$/.test(qualification.targetLedgerDigest) ||
    qualification.targetSchemaDigest !==
      target.manifest.compatibility.targetSchemaDigest ||
    qualification.sourceSchemaDigest !== checkpoint.schemaDigest ||
    Date.parse(qualification.expiresAt) <= Date.now() ||
    !target.manifest.compatibility.sourceManifestDigests.includes(
      source.manifestDigest,
    )
  )
    fail("signed source checkpoint/target compatibility mismatch");
  if (scenario === "image-rollback") {
    // Dedicated unreachable loopback readiness target; only this disposable
    // supervisor configuration receives the fault. No source image/data changes.
    mounted.runtime.host.candidateReadinessUrl =
      "https://127.0.0.1:65534/api/v1/health/ready";
    await writeFile(supervisorConfigPath, JSON.stringify(mounted), {
      mode: 0o600,
    });
  }
  const expectedSourceIds = new Set(
    source.manifest.images.map((image) => image.digest),
  );
  const expectedTargetIds = new Set(
    target.manifest.images.map((image) => image.digest),
  );
  if (
    Object.values(configuration.sourceImageIds ?? {}).some(
      (id) => !expectedSourceIds.has(id),
    ) ||
    Object.values(configuration.targetImageIds ?? {}).some(
      (id) => !expectedTargetIds.has(id),
    )
  )
    fail("configured image IDs not signed by release");
  const prepareImages = async () => {
    const { loadVerifiedUpgradeImages } = await load(
      "upgrades/infrastructure/deployment/load-verified-upgrade-images.js",
    );
    const { ShellFreeCommandRunner } = await load(
      "upgrades/infrastructure/deployment/linux-deployment.adapter.js",
    );
    const runner = new ShellFreeCommandRunner();
    await loadVerifiedUpgradeImages(source, runner, native.host.deployment);
    await loadVerifiedUpgradeImages(target, runner, native.host.deployment);
  };
  const client = new control.LocalUpgradeControlClient({
    socketPath: mounted.socketPath,
    key: await control.readUpgradeControlKey(mounted.controlKeyPath),
    instanceId,
  });
  const compose = (args) =>
    command(
      ["compose", "--project-name", project, "--file", composePath, ...args],
      environment,
    );
  const execute = (action, value, signal) =>
    client.execute(instanceId, actor, action, value, signal);
  const readMetadata = async ({ signal } = {}) => {
    const response = await requestTls(
      metadata,
      `/api/v1/operator/instances/${instanceId}/upgrades/capabilities`,
      { signal },
    );
    if (response.status !== 200)
      throw new Error("actual mTLS metadata probe failed");
    const body = JSON.parse(response.body);
    if (body.instanceId !== instanceId)
      throw new Error("metadata instance mismatch");
    return body;
  };
  const observe = async (runId) => {
    const containers = JSON.parse(
      await compose(["ps", "--all", "--format", "json"]),
    );
    const rows = Array.isArray(containers) ? containers : [containers];
    const ids = rows.map((row) => row.ID).filter(Boolean);
    if (!ids.length) throw new Error("native containers missing");
    const inspected = JSON.parse(
      await command(["inspect", ...ids], environment),
    );
    const apps = inspected.filter((c) =>
      Object.hasOwn(
        native.inspection.applicationContainers,
        c.Name.replace(/^\//, ""),
      ),
    );
    const expectedSource = new Set(
        Object.values(configuration.sourceImageIds ?? {}),
      ),
      expectedTarget = new Set(
        Object.values(configuration.targetImageIds ?? {}),
      );
    if (!expectedSource.size || !expectedTarget.size)
      fail("qualified source/target image IDs required");
    const request = JSON.parse(
      await readFile(
        join(native.host.maintenanceDirectory, "request.json"),
        "utf8",
      ),
    );
    const readiness = await requestTls(customer, "/api/v1/health/ready").catch(
      () => ({ status: 503, body: "{}" }),
    );
    let exposed = false;
    if (runId) {
      const { UpgradeHostJournal } = await load(
        "upgrades/infrastructure/journal/upgrade-host-journal.js",
      );
      const journal = new UpgradeHostJournal({
        root: mounted.journalRoot,
        key: await control.readUpgradeControlKey(mounted.journalKeyPath),
        instanceId,
        minimumSequence: mounted.minimumJournalSequence,
      });
      const records = await journal.read();
      exposed = records.some(
        (record) =>
          record.runId === runId &&
          record.kind === "execution" &&
          record.data.exposurePossible === true,
      );
    }
    return {
      containerDigest: hash(
        inspected.map((c) => ({
          name: c.Name,
          image: c.Image,
          running: c.State.Running,
        })),
      ),
      sourceRunning:
        apps.length ===
          Object.keys(native.inspection.applicationContainers).length &&
        apps.every((c) => c.State.Running && expectedSource.has(c.Image)),
      targetRunning:
        apps.length ===
          Object.keys(native.inspection.applicationContainers).length &&
        apps.every((c) => c.State.Running && expectedTarget.has(c.Image)),
      databaseReady:
        readiness.status === 200 && JSON.parse(readiness.body).status === "ok",
      exposed,
      maintenance: request.closed,
    };
  };
  const acknowledgement = join(
    native.host.acknowledgementDirectory,
    native.host.drainServices.find((id) => id !== "api") ?? "api",
  );
  let oldMode;
  const driver = createScenarioDriver({
    execute,
    sleep,
    readMetadata,
    observe,
    refuseDrain: async (enabled) => {
      if (!within(directory, acknowledgement))
        fail("ACK fault escaped fixture");
      if (enabled) {
        oldMode = (await lstat(acknowledgement)).mode & 0o777;
        await chmod(acknowledgement, 0o500);
      } else if (oldMode !== undefined) await chmod(acknowledgement, oldMode);
    },
    restartSupervisor: async () => {
      await compose(["restart", "supervisor"]);
      for (let count = 0; count < 100; count++) {
        try {
          await execute("capabilities/read");
          return;
        } catch {
          await sleep(100);
        }
      }
      throw new Error("native supervisor restart unavailable");
    },
    loseApplyReply: async (value, signal) => {
      const drop = new AbortController();
      const pending = execute(
        "run/apply",
        value,
        AbortSignal.any([drop.signal, signal]),
      ).catch(() => undefined);
      await sleep(10);
      drop.abort();
      await pending.catch(() => undefined);
    },
    ownerFlow: async (signal) => {
      const credentials = JSON.parse(
        await readFile(ownerCredentialsPath, "utf8"),
      );
      const login = await requestTls(customer, "/api/v1/auth/sign-in", {
        method: "POST",
        body: credentials,
        signal,
      });
      const cookie = login.cookies
        .map((value) => value.split(";")[0])
        .join("; ");
      const navigation = await requestTls(customer, "/dashboard", {
        cookie,
        signal,
      });
      if (/<title[^>]*>.*sign.?in/i.test(navigation.body))
        throw new Error("navigation returned sign-in");
      return {
        loginStatus: login.status,
        navigationStatus: navigation.status,
        sessionCookie: /cra_at=/.test(cookie),
      };
    },
    assertEgressDenied: async () => {
      const api = native.host.deployment.candidateServices.find(
        (id) => id === "api",
      );
      if (!api) fail("fixed API service required");
      const output = await compose([
        "exec",
        "-T",
        api,
        "node",
        "-e",
        "const net=require('node:net');const s=net.connect(443,'1.1.1.1');s.setTimeout(1500);s.on('connect',()=>process.exit(1));s.on('error',()=>{console.log('denied');process.exit(0)});s.on('timeout',()=>{console.log('denied');s.destroy();process.exit(0)})",
      ]);
      if (output.trim() !== "denied")
        throw new Error("external egress not denied");
      return { egressDenied: true };
    },
  });
  return {
    kind: "native-linux-compose",
    project,
    root: directory,
    composePath,
    networkName: `${project}-backend`,
    journalRoot: mounted.journalRoot,
    environment,
    readMetadata,
    prepareImages,
    waitReady: async ({ signal }) => {
      for (let attempt = 0; attempt < 300; attempt++) {
        signal.throwIfAborted();
        try {
          await execute("capabilities/read", {}, signal);
          await readMetadata({ signal });
          const observed = await observe();
          if (observed.sourceRunning && observed.databaseReady) return;
        } catch {}
        await sleep(1000);
      }
      throw new Error("provisioned source fixture did not become ready");
    },
    ...driver,
  };
}
