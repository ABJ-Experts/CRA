import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type {
  BackupCertificate,
  BackupInventory,
} from "../../application/backup-execution.port";
import {
  backupDigest,
  EncryptedBackupRepository,
} from "./encrypted-backup.repository";
import { ReviewedBackupRepositoryCleanup } from "./reviewed-backup-cleanup";

jest.setTimeout(30_000);

describe("reviewed cleanup historical recovery keys", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "m15-cleanup-keys-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  it.each(["missing", "wrong", "available"])(
    "authenticates every survivor WAL with historical key %s",
    async (availability) => {
      const repository = join(root, "repository");
      await mkdir(repository, { mode: 0o700 });
      const currentKey = join(root, "current-key");
      const historicalKey = join(root, "historical-key");
      const wrongKey = join(root, "wrong-key");
      await writeFile(currentKey, "synthetic-current-key", { mode: 0o600 });
      await writeFile(historicalKey, "synthetic-historical-key", {
        mode: 0o600,
      });
      await writeFile(wrongKey, "synthetic-wrong-key", { mode: 0o600 });
      const configuration = {
        repository,
        keyFile: currentKey,
        keyId: "v2",
        gpgBinary: "gpg",
        maximumPartBytes: 1024 * 1024,
      };
      const current = new EncryptedBackupRepository(configuration);
      const historical = new EncryptedBackupRepository({
        ...configuration,
        keyFile: historicalKey,
        keyId: "v1",
      });
      const ids = [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
      ];
      const instanceId = "44444444-4444-4444-8444-444444444444";
      const signal = new AbortController().signal;
      const wal = await historical.sealPart(
        ids[1]!,
        "wal",
        "000000010000000000000001",
        Readable.from(["historical WAL"]),
        signal,
      );
      const inventory: BackupInventory = {
        catalog: {},
        auditHeads: [],
        objects: [],
        externalKeyChecks: [],
      };
      let targetPartPath = "";
      for (const runId of ids) {
        const base = await current.sealPart(
          runId,
          "base",
          "base.tar",
          Readable.from([runId]),
          signal,
        );
        if (runId === ids[0]) targetPartPath = current.partPath(base);
        const unsigned = {
          formatVersion: 1 as const,
          instanceId,
          runId,
          repositoryGeneration: "generation",
          configurationRevision: 1,
          keyId: "v2",
          capturedAt: "2026-10-14T00:00:00Z",
          checkpoint: {
            systemIdentifier: "123",
            timeline: 1,
            lsn: "0/1000000",
            postgresVersion: "17.6" as const,
            restorePoint: "fixture",
          },
          parts: runId === ids[0] ? [base] : [base, wal],
          inventoryDigest: backupDigest(inventory),
          auditHeadsDigest: backupDigest([]),
        };
        const certificate: BackupCertificate = {
          ...unsigned,
          certificateDigest: backupDigest(unsigned),
        };
        await current.sealCertificate(certificate, inventory, signal);
      }
      const keys: Record<string, string> =
        availability === "missing"
          ? {}
          : { v1: availability === "wrong" ? wrongKey : historicalKey };
      const cleanup = new ReviewedBackupRepositoryCleanup({
        repositoryPath: repository,
        keyRepositories: [
          new EncryptedBackupRepository({
            ...configuration,
            keyFilesById: keys,
          }),
        ],
      });
      const operation = cleanup.prepare(
        {
          runId: ids[0]!,
          instanceId,
          retainedCaptureRunIds: ids.slice(1),
          verifiedBaseRunIds: ids.slice(1),
        },
        signal,
        async () => {},
      );
      if (availability === "available") {
        const prepared = await operation;
        await prepared.rollback(signal);
      } else await expect(operation).rejects.toThrow("last_recoverable_chain");
      expect((await readFile(targetPartPath)).length).toBeGreaterThan(0);
      expect(
        (await readFile(join(repository, "certificates", `${ids[0]}.json`)))
          .length,
      ).toBeGreaterThan(0);
    },
  );
});
