import * as audits from "../audit/upgrade-audit-runtime";
/* eslint-disable @typescript-eslint/unbound-method -- Jest assertions on injected native ports. */
import { randomUUID } from "node:crypto";
import { composeUpgradeSupervisor } from "./upgrade-supervisor-runtime-compose";
import { UpgradeHostJournal } from "../journal/upgrade-host-journal";
import { NativeUpgradeInspection } from "./native-upgrade-inspection";
import { SupervisorMountedMedia } from "./upgrade-supervisor-runtime";
import * as keys from "./local-upgrade-control";
import * as backups from "../backup/upgrade-backup-runtime";
import * as images from "../deployment/load-verified-upgrade-images";
import * as policy from "../../domain/upgrade-preflight";
import type { UpgradeSupervisorDependencies } from "../../application/upgrade-supervisor";
import type { VerifiedUpgradeBundle } from "../media/mounted-upgrade-media";
import { NativeLinuxDeploymentHost } from "../deployment/native-linux-deployment-host";
jest.mock("../deployment/native-linux-deployment-host", () => ({
  NativeLinuxDeploymentHost: jest.fn().mockImplementation(() => ({
    initializeSelection: jest.fn().mockResolvedValue(undefined),
  })),
}));
const id = randomUUID(),
  digest = "a".repeat(64);
function fixture() {
  const configuration = {
    instanceId: id,
    socketPath: "/control/socket",
    controlKeyPath: "/control/key",
    journalKeyPath: "/journal/key",
    journalRoot: "/journal",
    minimumJournalSequence: 0,
    grantsPath: "/grants",
    inboxRoot: "/inbox",
    stagingRoot: "/stage",
    trustPath: "/trust",
    protectedRoots: ["/source"],
    runtime: {
      inspection: {
        instanceId: id,
        installedReceiptPath: "/installed",
        qualificationReceiptPath: "/qualification",
        receiptPublicKey: "key",
        supervisorVersion: "1.0.0",
        trustDigest: digest,
        dockerExecutable: "/docker",
        psqlExecutable: "/psql",
        pgDumpExecutable: "/pgdump",
        cwd: "/host",
        diskRoot: "/disk",
        maintenanceRequestPath: "/maintenance/request.json",
        environment: {},
        sourceNetwork: "source",
        infrastructureContainers: {
          postgres: "postgres",
          auth: "auth",
          rest: "rest",
          storage: "storage",
          supervisor: "supervisor",
        },
        applicationContainers: { api: "api", web: "web" },
        allowedDatabaseApplications: ["api"],
        organizationIds: [id],
      },
      audit: {
        endpoint: "http://127.0.0.1:54321",
        projectApiKey: "public",
        credentialPath: "/audit-key",
      },
      backup: {
        configurationPath: "/backup",
        readOnly: {
          psqlBinary: "/psql",
          host: "localhost",
          port: 5432,
          database: "postgres",
          user: "reader",
          pgpassFile: "/pgpass",
        },
      },
      host: {
        deployment: {
          dockerExecutable: "/docker",
          composeFile: "/compose",
          project: "cra",
          cwd: "/host",
          candidateServices: ["api", "web"],
          workerServices: ["worker"],
          serviceRoles: { api: "api", web: "web", worker: "api" },
          imageVariables: { api: "API_IMAGE", web: "WEB_IMAGE" },
          environment: {},
        },
        maintenanceDirectory: "/maintenance",
        acknowledgementDirectory: "/acks",
        selectionDirectory: "/selection",
        selectionKeyPath: "/key",
        drainServices: ["api"],
        fixedServices: ["postgres"],
        organizationIds: [id],
        psqlExecutable: "/psql",
        pgDumpExecutable: "/pgdump",
        databaseEnvironment: {},
        candidateReadinessUrl: "http://localhost/health/ready",
        workerReadinessUrl: "http://localhost/health/ready",
        migrations: {
          databaseUrl: "postgresql://reader@localhost/postgres",
          cliExecutable: "/supabase",
          cwd: "/migrations",
          migrationDirectory: "/migrations/files",
          environment: {},
          baselineFiles: {},
        },
      },
    },
  };
  jest.spyOn(audits, "createUpgradeAuditRuntime").mockResolvedValue({
    flush: jest.fn().mockResolvedValue(undefined),
    appendPending: jest.fn(),
  });
  jest.spyOn(UpgradeHostJournal.prototype, "read").mockResolvedValue([]);
  jest
    .spyOn(keys, "readUpgradeControlKey")
    .mockResolvedValue(Buffer.alloc(32, 1));
  jest
    .spyOn(SupervisorMountedMedia.prototype, "revalidate")
    .mockResolvedValue();
  jest.spyOn(images, "loadVerifiedUpgradeImages").mockResolvedValue();
  const backup = {
    validateExisting: jest
      .fn()
      .mockResolvedValue({ certificateDigest: digest }),
    checkpointAfterDrain: jest.fn().mockResolvedValue({}),
  };
  jest.spyOn(backups, "createUpgradeBackupRuntime").mockResolvedValue(backup);
  jest
    .spyOn(NativeUpgradeInspection.prototype, "installedVersion")
    .mockResolvedValue("1.0.0");
  jest
    .spyOn(NativeUpgradeInspection.prototype, "maintenanceActive")
    .mockResolvedValue(false);
  const inspected = {
    committedMigrations: {},
    facts: {
      currentVersion: "1.0.0",
      checkedAt: "2026-10-15T00:00:00Z",
      expiresAt: "2026-10-15T00:05:00Z",
    },
    plan: {
      runId: id,
      fingerprint: digest,
      previousImages: [{ service: "api", imageId: "old" }],
      candidateImages: [{ service: "api", imageId: "new" }],
    },
    qualification: { cliVersion: "1", atomicLedger: true },
  } as unknown as Awaited<ReturnType<NativeUpgradeInspection["inspect"]>>;
  jest
    .spyOn(NativeUpgradeInspection.prototype, "inspect")
    .mockResolvedValue(inspected);
  jest
    .spyOn(policy, "preflightUpgrade")
    .mockReturnValue({ allowed: true, blockers: [], fingerprint: digest });
  return {
    mounted: {
      config: configuration,
      controlKey: Buffer.alloc(32, 1),
      journalKey: Buffer.alloc(32, 2),
    },
    backup,
    inspected,
  };
}
afterEach(() => jest.restoreAllMocks());
it("composes real observation, verified load, checkpoint and restart boundaries", async () => {
  const f = fixture();
  const supervisor = await composeUpgradeSupervisor(f.mounted);
  jest.spyOn(supervisor, "authorize").mockResolvedValue();
  const deps = (
    supervisor as unknown as { deps: UpgradeSupervisorDependencies }
  ).deps;
  expect(await deps.capabilities()).toMatchObject({
    enabled: true,
    currentVersion: "1.0.0",
    maintenance: false,
  });
  const bundle = { manifest: { version: "2.0.0" } } as VerifiedUpgradeBundle;
  const actor = {
    principalId: id,
    fingerprint256: Array(32).fill("AA").join(":"),
    grantRevision: "1",
  };
  await deps.loadImages!(bundle);
  expect(images.loadVerifiedUpgradeImages).toHaveBeenCalled();
  await deps.prepare(bundle, actor, id);
  let authority = jest.mocked(NativeLinuxDeploymentHost).mock.calls.at(-1)![2];
  await authority.assertFresh(digest);
  await authority.holdVerifiedBackup();
  expect(f.backup.checkpointAfterDrain).toHaveBeenCalledWith(
    id,
    expect.any(AbortSignal),
  );
  await expect(authority.assertFresh("wrong")).rejects.toThrow("stale");
  await deps.resume!(bundle, actor, f.inspected.plan, f.inspected.facts);
  authority = jest.mocked(NativeLinuxDeploymentHost).mock.calls.at(-1)![2];
  await authority.assertFresh(digest);
  await authority.holdVerifiedBackup();
  expect(supervisor.authorize).toHaveBeenCalledWith(actor, "run/rollback");
});
it("rejects cross-instance or incomplete configuration", async () => {
  const f = fixture();
  await expect(
    composeUpgradeSupervisor({
      ...f.mounted,
      config: { ...f.mounted.config, instanceId: randomUUID() },
    }),
  ).rejects.toThrow("instance");
  await expect(
    composeUpgradeSupervisor({
      ...f.mounted,
      config: { ...f.mounted.config, runtime: {} },
    }),
  ).rejects.toThrow();
});
import { NativeFlock } from "../journal/native-flock";
import { ShellFreeCommandRunner } from "../deployment/linux-deployment.adapter";
import { OperatorGrantStore } from "../../../operator/operator-security";
import type { UpgradeJournalLock } from "../journal/native-flock";
it("loss of native lock cancels all privileged work permanently", async () => {
  const f = fixture();
  const supervisor = await composeUpgradeSupervisor(f.mounted);
  const deps = (
    supervisor as unknown as { deps: UpgradeSupervisorDependencies }
  ).deps;
  jest
    .spyOn(OperatorGrantStore.prototype, "read")
    .mockResolvedValue({ revision: "1", grants: [] });
  expect(await deps.readGrants()).toEqual({ revision: "1", grants: [] });
  const nativeJournal = jest
    .mocked(UpgradeHostJournal.prototype.read)
    .mock.contexts.at(-1) as unknown as {
    config: { lock: UpgradeJournalLock };
  };
  const controller = new AbortController();
  jest
    .spyOn(NativeFlock.prototype, "run")
    .mockImplementation((_path, effect) => effect(controller.signal));
  const abort = jest.spyOn(ShellFreeCommandRunner.prototype, "abortAll");
  await nativeJournal.config.lock.run("/lock", () => {
    controller.abort();
    return Promise.resolve();
  });
  expect(abort).toHaveBeenCalled();
  await expect(
    nativeJournal.config.lock.run("/lock", () => Promise.resolve()),
  ).rejects.toThrow();
  await deps.prepare(
    { manifest: { version: "2.0.0" } } as VerifiedUpgradeBundle,
    {
      principalId: id,
      fingerprint256: Array(32).fill("AA").join(":"),
      grantRevision: "1",
    },
    id,
  );
  const inspection = jest
    .mocked(NativeUpgradeInspection.prototype.inspect)
    .mock.contexts.at(-1) as unknown as {
    dependencies: { backup: (id: string) => Promise<unknown> };
  };
  expect(await inspection.dependencies.backup(id)).toEqual({
    certificateDigest: digest,
    verified: true,
    held: true,
    keysAvailable: true,
  });
});
it("continues approved execution after its own import consumes disk, but rejects failed remaining/source inspection", async () => {
  const f = fixture();
  const supervisor = await composeUpgradeSupervisor(f.mounted);
  jest.spyOn(supervisor, "authorize").mockResolvedValue();
  const deps = (
    supervisor as unknown as { deps: UpgradeSupervisorDependencies }
  ).deps;
  const bundle = {
    manifest: { version: "2.0.0" },
    manifestDigest: digest,
  } as VerifiedUpgradeBundle;
  const actor = {
    principalId: id,
    fingerprint256: Array(32).fill("AA").join(":"),
    grantRevision: "1",
  };
  const approved = {
    ...f.inspected.facts,
    freeBytes: 1000,
    requiredBytes: 1000,
  };
  jest
    .mocked(NativeUpgradeInspection.prototype.inspect)
    .mockResolvedValueOnce({ ...f.inspected, facts: approved });
  await deps.prepare(bundle, actor, id);
  const authority = jest
    .mocked(NativeLinuxDeploymentHost)
    .mock.calls.at(-1)![2];
  jest.mocked(UpgradeHostJournal.prototype.read).mockResolvedValue([
    { kind: "run", runId: id, data: { facts: approved } },
    {
      kind: "image-load-result",
      runId: id,
      data: { manifestDigest: digest, fingerprint: digest },
    },
  ] as never);
  jest.mocked(NativeUpgradeInspection.prototype.inspect).mockResolvedValue({
    ...f.inspected,
    facts: { ...approved, freeBytes: 400, requiredBytes: 400 },
  });
  await expect(authority.assertFresh(digest)).resolves.toBeUndefined();
  expect(NativeUpgradeInspection.prototype.inspect).toHaveBeenLastCalledWith(
    bundle,
    actor,
    id,
    { checkedAt: approved.checkedAt, expiresAt: approved.expiresAt },
    { imagesImported: true },
  );
  const restarted = await deps.prepare(bundle, actor, id, {
    checkedAt: approved.checkedAt,
    expiresAt: approved.expiresAt,
    fingerprint: digest,
  });
  expect(restarted.facts).toMatchObject({
    freeBytes: 1000,
    requiredBytes: 1000,
  });
  jest.mocked(policy.preflightUpgrade).mockReturnValue({
    allowed: false,
    blockers: ["source-compatibility"],
    fingerprint: digest,
  });
  await expect(authority.assertFresh(digest)).rejects.toThrow("stale");
});
it.each(["run", "manifest", "fingerprint"])(
  "cannot relax import capacity for a receipt with a different %s",
  async (field) => {
    const f = fixture();
    const supervisor = await composeUpgradeSupervisor(f.mounted);
    const deps = (
      supervisor as unknown as { deps: UpgradeSupervisorDependencies }
    ).deps;
    const bundle = {
      manifest: { version: "2.0.0" },
      manifestDigest: digest,
    } as VerifiedUpgradeBundle;
    const actor = {
      principalId: id,
      fingerprint256: Array(32).fill("AA").join(":"),
      grantRevision: "1",
    };
    jest.mocked(UpgradeHostJournal.prototype.read).mockResolvedValue([
      {
        kind: "image-load-result",
        runId: field === "run" ? randomUUID() : id,
        data: {
          manifestDigest: field === "manifest" ? "b".repeat(64) : digest,
          fingerprint: field === "fingerprint" ? "b".repeat(64) : digest,
        },
      },
    ] as never);
    const window = {
      checkedAt: f.inspected.facts.checkedAt,
      expiresAt: f.inspected.facts.expiresAt,
      fingerprint: digest,
    };
    await deps.prepare(bundle, actor, id, window);
    expect(NativeUpgradeInspection.prototype.inspect).toHaveBeenLastCalledWith(
      bundle,
      actor,
      id,
      window,
      undefined,
    );
  },
);
it("rejects an import receipt without its authenticated approved facts", async () => {
  const f = fixture();
  const supervisor = await composeUpgradeSupervisor(f.mounted);
  const deps = (
    supervisor as unknown as { deps: UpgradeSupervisorDependencies }
  ).deps;
  jest.mocked(UpgradeHostJournal.prototype.read).mockResolvedValue([
    {
      kind: "image-load-result",
      runId: id,
      data: { manifestDigest: digest, fingerprint: digest },
    },
  ] as never);
  await expect(
    deps.prepare(
      {
        manifest: { version: "2.0.0" },
        manifestDigest: digest,
      } as VerifiedUpgradeBundle,
      {
        principalId: id,
        fingerprint256: Array(32).fill("AA").join(":"),
        grantRevision: "1",
      },
      id,
      {
        checkedAt: f.inspected.facts.checkedAt,
        expiresAt: f.inspected.facts.expiresAt,
        fingerprint: digest,
      },
    ),
  ).rejects.toThrow("approval_missing");
});
