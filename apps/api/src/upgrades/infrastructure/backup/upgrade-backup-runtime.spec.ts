/* eslint-disable @typescript-eslint/require-await -- Immediate boundary doubles return durable fixture receipts. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupVerificationCheckCodeSchema } from "@repo/contracts/backups/schemas";
import {
  createUpgradeBackupRuntime,
  upgradeBackupRuntimeConfigurationSchema,
} from "./upgrade-backup-runtime";
import { loadBackupWorkerRuntime } from "../../../backups/infrastructure/backup-worker-runtime";
import { createBackupExecutor } from "../../../backups/infrastructure/backup-executor";
import { NativeBackupWorkerControlClient } from "../../../backups/infrastructure/native-backup-worker-control.client";
import { BackupWorker } from "../../../backups/worker/backup-worker";
import { NativeBackupEvidenceReader } from "./backup-evidence-reader";
import { UpgradeBackupMaterialReader } from "./upgrade-backup-material";
import type { BackupCertificate } from "../../../backups/application/backup-execution.port";

jest.mock("../../../backups/infrastructure/backup-worker-runtime");
jest.mock("../../../backups/infrastructure/backup-executor");
jest.mock("../../../backups/worker/backup-worker");
const id = (n: number) =>
  `15000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-10-15T00:00:00.000Z";
const policy = {
  instanceId: id(1),
  version: 1,
  configurationRevision: 1,
  approvedAt: at,
  approvedBy: "operator",
  lastValidatedAt: at,
  configuration: {
    sourceAlias: "source",
    repositoryAlias: "repository",
    stagingAlias: "staging",
    keyAlias: "key",
    targetProfile: "isolated",
    residency: "local",
    schedulingEnabled: false,
    checkpointIntervalMinutes: 30,
    baseIntervalHours: 24,
    verificationIntervalDays: 30,
    retentionDays: 30,
    pauseLimitSeconds: 120,
  },
};
const cert = (runId: string) => ({
  version: 1,
  checkpointId: runId,
  certifiedAt: at,
  recoveryPointAt: at,
  manifestSha256: "a".repeat(64),
  repositoryGeneration: id(9),
  keyId: "key",
  baseRunId: runId,
  timeline: 1,
  checkpointLsn: "0/ABC",
  sourceSystemIdentifier: "123",
  databaseBytes: 1,
  objectBytes: 0,
  objectCount: 0,
  walBytes: 0,
  postgresqlVersion: "17.6",
  integrity: "passed",
});
const verification = {
  targetProfile: "isolated",
  verifiedAt: at,
  integrity: "passed",
  checks: backupVerificationCheckCodeSchema.options.map((code) => ({
    code,
    status: "passed",
    durationMs: 1,
    failureCode: null,
  })),
  recoveryPointAgeMs: 1,
  recoveryDurationMs: 1,
  measuredProfile: "isolated",
  databaseBytes: 1,
  objectBytes: 0,
};
const run = (
  kind: "capture" | "verification",
  runId: string,
  state: string,
  parent: string | null = null,
) => ({
  id: runId,
  instanceId: id(1),
  kind,
  parentRunId: parent,
  state,
  stage: state === "queued" ? "queued" : "completed",
  progress: state === "queued" ? 0 : 100,
  version: 1,
  attempt: 1,
  configurationRevision: 1,
  createdAt: at,
  startedAt: state === "queued" ? null : at,
  completedAt: state === "queued" ? null : at,
  durationMs: state === "queued" ? null : 1,
  failureCode: null,
  certificate: kind === "capture" && state === "certified" ? cert(runId) : null,
  verification:
    kind === "verification" && state === "verified" ? verification : null,
  cleanup: { state: "retained", deletedAt: null },
});

describe("production upgrade backup composition", () => {
  const actualPlatform = process.platform;
  let root: string;
  let completed: Set<string>;
  let replay: boolean;
  let actors: string[];
  const input = () => ({
    instanceId: id(1),
    journalBinding: "journal",
    hostKey: Buffer.alloc(32, 7),
    configurationPath: "/private/backup.json",
    timeoutMs: 10000,
    readOnly: {
      psqlBinary: "/usr/bin/psql",
      host: "localhost",
      port: 54322,
      database: "postgres",
      user: "backup_reader",
      pgpassFile: "/private/pgpass",
    },
  });
  beforeEach(async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    root = await mkdtemp(join(tmpdir(), "upgrade-runtime-"));
    actors = [];
    completed = new Set();
    replay = false;
    jest.mocked(loadBackupWorkerRuntime).mockResolvedValue({
      instanceId: id(1),
      runtime: {
        sources: {
          source: {
            databaseContainer: "postgres",
            databaseName: "postgres",
            databaseUser: "postgres",
          },
        },
        repositories: { repository: { path: root, offHost: true } },
        keys: { key: { path: "/private/key", keyId: "key" } },
        staging: { staging: { maximumBytes: 1024 } },
        gpgBinary: "/usr/bin/gpg",
      },
      targetProfiles: { isolated: { deadlineMs: 10000 } },
    } as never);
    jest
      .mocked(createBackupExecutor)
      .mockReturnValue({ capture: jest.fn(), verify: jest.fn() });
    jest
      .spyOn(NativeBackupEvidenceReader.prototype, "readApprovedEvidence")
      .mockResolvedValue({
        policy,
        capture: run("capture", id(2), "certified"),
        child: run("verification", id(3), "verified", id(2)),
      } as never);
    jest
      .spyOn(NativeBackupEvidenceReader.prototype, "assertVerifiedChild")
      .mockResolvedValue();
    jest
      .spyOn(UpgradeBackupMaterialReader.prototype, "loadCertificate")
      .mockImplementation(
        async (runId) =>
          ({
            instanceId: id(1),
            runId,
            certificateDigest: "a".repeat(64),
            keyId: "key",
            parts: [{ id: id(8) }],
          }) as unknown as BackupCertificate,
      );
    jest
      .spyOn(UpgradeBackupMaterialReader.prototype, "authenticateParts")
      .mockResolvedValue();
    jest
      .spyOn(NativeBackupWorkerControlClient.prototype, "execute")
      .mockImplementation(async (_instance, _actor, action, data) => {
        actors.push(_actor);
        if (action === "policy/read") return policy;
        const kind = data?.kind as "capture" | "verification";
        if (action === "run/create")
          return run(
            kind,
            kind === "capture" ? id(4) : id(5),
            replay ? (kind === "capture" ? "certified" : "verified") : "queued",
            kind === "capture" ? null : id(4),
          );
        if (action === "run/claim")
          return {
            run: run(
              kind,
              kind === "capture" ? id(4) : id(5),
              "running",
              kind === "capture" ? null : id(4),
            ),
          };
        if (action === "run/read")
          return run(
            data?.runId === id(4) ? "capture" : "verification",
            String(data?.runId),
            completed.has(String(data?.runId))
              ? data?.runId === id(4)
                ? "certified"
                : "verified"
              : "failed",
            data?.runId === id(4) ? null : id(4),
          );
        return null;
      });
    jest.mocked(BackupWorker).mockImplementation(
      (options) =>
        ({
          runOnce: async (
            kind: "capture" | "verification",
            signal: AbortSignal,
          ) => {
            await options.control.execute(
              id(1),
              `backup-worker:${options.workerId}`,
              "run/claim",
              { kind },
              signal,
            );
            options.verificationTimeoutMs?.("isolated");
            completed.add(kind === "capture" ? id(4) : id(5));
          },
        }) as unknown as BackupWorker,
    );
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    Object.defineProperty(process, "platform", { value: actualPlatform });
    await rm(root, { recursive: true, force: true });
  });
  it("constructs real approved mounted execution and pins existing evidence before a fresh audited checkpoint", async () => {
    const runtime = await createUpgradeBackupRuntime(input());
    expect((await runtime.validateExisting(id(6))).captureRunId).toBe(id(2));
    const held = await runtime.checkpointAfterDrain(id(6));
    expect(held.captureRunId).toBe(id(4));
    expect(held.verifiedChildRunId).toBe(id(5));
    expect(held.dependencyRunIds).toEqual(
      expect.arrayContaining([id(2), id(3), id(4), id(5)]),
    );
    expect(createBackupExecutor).toHaveBeenCalledTimes(1);
    expect(loadBackupWorkerRuntime).toHaveBeenCalledWith({
      BACKUP_WORKER_ENABLED: "true",
      BACKUP_WORKER_CONFIGURATION_PATH: "/private/backup.json",
      LICENSING_INSTANCE_ID: id(1),
    });
    expect(actors).toContain("backup-worker:upgrade-supervisor");
    expect(actors.every((actor) => actor.startsWith("backup-worker:"))).toBe(
      true,
    );
  });
  it("replays completed capture/verification without running another source effect", async () => {
    replay = true;
    const runtime = await createUpgradeBackupRuntime(input());
    await runtime.checkpointAfterDrain(id(6));
    expect(BackupWorker).not.toHaveBeenCalled();
  });
  it("blocks unsupported hosts, disabled configuration, unsafe input and missing policy", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    await expect(createUpgradeBackupRuntime(input())).rejects.toThrow(
      "unavailable",
    );
    Object.defineProperty(process, "platform", { value: "linux" });
    expect(() =>
      upgradeBackupRuntimeConfigurationSchema.parse({
        ...input(),
        configurationPath: "relative",
      }),
    ).toThrow();
    jest.mocked(loadBackupWorkerRuntime).mockResolvedValueOnce(null);
    await expect(createUpgradeBackupRuntime(input())).rejects.toThrow(
      "unavailable",
    );
    const runtime = await createUpgradeBackupRuntime(input());
    jest
      .spyOn(NativeBackupWorkerControlClient.prototype, "execute")
      .mockResolvedValue(null);
    await expect(runtime.checkpointAfterDrain(id(6))).rejects.toThrow();
  });
  it("rejects mismatched claim and unavailable fresh capture instead of certifying an unrelated run", async () => {
    const runtime = await createUpgradeBackupRuntime(input());
    jest.mocked(BackupWorker).mockImplementation(
      (options) =>
        ({
          runOnce: async () => {
            await options.control.execute(
              id(1),
              "backup-worker:upgrade",
              "run/claim",
              { kind: "verification" },
            );
          },
        }) as unknown as BackupWorker,
    );
    await expect(runtime.checkpointAfterDrain(id(6))).rejects.toThrow(
      "claim_mismatch",
    );
    jest
      .mocked(BackupWorker)
      .mockImplementation(
        () => ({ runOnce: async () => undefined }) as unknown as BackupWorker,
      );
    await expect(runtime.checkpointAfterDrain(id(7))).rejects.toThrow(
      "capture_unavailable",
    );
  });
});
