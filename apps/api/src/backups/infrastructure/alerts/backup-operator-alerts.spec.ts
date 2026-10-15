import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  realpath,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BackupOperatorAlerts } from "./backup-operator-alerts";
import { EncryptedBackupRepository } from "../repository/encrypted-backup.repository";
import type { Readable, Writable } from "node:stream";
const instanceId = "20000000-0000-4000-8000-000000000001";
it("persists an authenticated, deduplicated fixed-code operator fallback without source exceptions", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "backup-alert-")));
  let plaintext = "";
  const seal = jest
    .spyOn(EncryptedBackupRepository.prototype, "sealPart")
    .mockImplementation(async (_run, _kind, _name, source: Readable) => {
      for await (const chunk of source as AsyncIterable<Buffer>)
        plaintext += chunk.toString();
      return {
        id: "30000000-0000-4000-8000-000000000001",
        kind: "inventory",
        name: "operator-alert.json",
        bytes: Buffer.byteLength(plaintext),
        cipherBytes: 100,
        sha256: "a".repeat(64),
        cipherSha256: "b".repeat(64),
      };
    });
  const opened = jest
    .spyOn(EncryptedBackupRepository.prototype, "openPartToSink")
    .mockImplementation(
      (_part, sink: Writable) =>
        new Promise<void>((resolve) => {
          sink.end(plaintext, resolve);
        }),
    );
  try {
    const repository = join(root, "repository");
    await mkdir(repository, { mode: 0o700 });
    const key = join(root, "key");
    await writeFile(key, "dedicated", { mode: 0o600 });
    const runtime = {
      repositories: {
        offhost: {
          path: repository,
          offHost: true,
          generation: instanceId,
          residency: "local",
        },
      },
      keys: { key: { path: key, keyId: "key" } },
      sources: {},
      staging: {},
      gpgBinary: "/gpg",
    };
    const journal = new BackupOperatorAlerts(
      instanceId,
      runtime,
      undefined,
      () => new Date("2026-10-14T00:00:00.000Z"),
    );
    expect(
      await journal.record("source_unavailable", new AbortController().signal),
    ).toBe(true);
    expect(
      await journal.record("source_unavailable", new AbortController().signal),
    ).toBe(false);
    expect(
      await new BackupOperatorAlerts(
        instanceId,
        runtime,
        undefined,
        () => new Date("2026-10-14T00:00:00.000Z"),
      ).record("source_unavailable", new AbortController().signal),
    ).toBe(false);
    expect(seal).toHaveBeenCalledTimes(1);
    expect(JSON.parse(plaintext)).toEqual({
      schemaVersion: 1,
      instanceId,
      code: "source_unavailable",
      occurredAt: "2026-10-14T00:00:00.000Z",
      occurrenceKey: "source_unavailable:2026-10-14",
    });
    opened.mockRejectedValueOnce(new Error("raw credential canary"));
    await expect(
      new BackupOperatorAlerts(
        instanceId,
        runtime,
        undefined,
        () => new Date("2026-10-14T00:00:00.000Z"),
      ).record("source_unavailable", new AbortController().signal),
    ).rejects.toThrow("Operator alert journal unavailable");
    await expect(
      new BackupOperatorAlerts(instanceId, {
        ...runtime,
        repositories: {
          ...runtime.repositories,
          extra: runtime.repositories.offhost,
        },
      }).record("source_unavailable", new AbortController().signal),
    ).rejects.toThrow("Operator alert journal unavailable");
    await expect(
      journal.record("password=canary" as never, new AbortController().signal),
    ).rejects.toThrow("Operator alert journal unavailable");
    const linked = join(root, "linked");
    await symlink(repository, linked);
    await expect(
      new BackupOperatorAlerts(instanceId, {
        ...runtime,
        repositories: {
          only: { ...runtime.repositories.offhost, path: linked },
        },
      }).record("source_unavailable", new AbortController().signal),
    ).rejects.toThrow("Operator alert journal unavailable");
    journal.select({ repositoryAlias: "unknown", keyAlias: "key" });
    await expect(
      journal.record("source_unavailable", new AbortController().signal),
    ).rejects.toThrow("Operator alert journal unavailable");
  } finally {
    seal.mockRestore();
    opened.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});
