import type { Writable } from "node:stream";
import { UpgradeBackupMaterialReader } from "./upgrade-backup-material";
import type { EncryptedBackupRepository } from "../../../backups/infrastructure/repository/encrypted-backup.repository";
import type { BackupCertificate } from "../../../backups/application/backup-execution.port";

describe("upgrade backup material authentication", () => {
  const certificate = {
    keyId: "default",
    parts: [{ id: "part", keyId: "historical" }],
  } as unknown as BackupCertificate;
  const signal = new AbortController().signal;
  const failed = {
    loadCertificateInMemory: jest.fn(async () => {
      await Promise.resolve();
      throw Error("missing");
    }),
    openPartToSink: jest.fn(async () => {
      await Promise.resolve();
      throw Error("wrong key");
    }),
  } as unknown as EncryptedBackupRepository;
  const working = {
    loadCertificateInMemory: jest.fn(() => Promise.resolve(certificate)),
    openPartToSink: jest.fn(
      (_part: unknown, sink: Writable) =>
        new Promise<void>((resolve, reject) => {
          sink.write(Buffer.from("authenticated"), (error) =>
            error ? reject(error) : resolve(),
          );
        }),
    ),
  };
  it("tries historical keys and authenticates every exact certificate part", async () => {
    const reader = new UpgradeBackupMaterialReader([
      failed,
      working as unknown as EncryptedBackupRepository,
    ]);
    expect(await reader.loadCertificate("capture", signal)).toBe(certificate);
    await reader.authenticateParts(certificate, signal);
    expect(working.openPartToSink).toHaveBeenCalledWith(
      certificate.parts[0],
      expect.anything(),
      signal,
    );
    await reader.authenticateParts(
      {
        ...certificate,
        parts: [{ ...certificate.parts[0]!, keyId: undefined }],
      },
      signal,
    );
    expect(working.openPartToSink).toHaveBeenLastCalledWith(
      expect.objectContaining({ keyId: "default" }),
      expect.anything(),
      signal,
    );
  });
  it("fails closed on unavailable certificate/key, empty material and cancellation", async () => {
    const reader = new UpgradeBackupMaterialReader([failed]);
    await expect(reader.loadCertificate("capture", signal)).rejects.toThrow(
      "discontinuity",
    );
    await expect(reader.authenticateParts(certificate, signal)).rejects.toThrow(
      "historical_key_unavailable",
    );
    await expect(
      reader.authenticateParts({ ...certificate, parts: [] }, signal),
    ).rejects.toThrow("discontinuity");
    await expect(
      reader.loadCertificate("capture", AbortSignal.abort()),
    ).rejects.toThrow();
  });
});
