import { Writable } from "node:stream";
import type { BackupCertificate } from "../../../backups/application/backup-execution.port";
import { BackupExecutionError } from "../../../backups/application/backup-execution.port";
import type { EncryptedBackupRepository } from "../../../backups/infrastructure/repository/encrypted-backup.repository";

/** Reuses M15-05's encrypted certificate parser, digest and streaming AEAD/hash/length verification. */
export class UpgradeBackupMaterialReader {
  constructor(
    private readonly repositories: readonly EncryptedBackupRepository[],
  ) {}
  async loadCertificate(
    runId: string,
    signal: AbortSignal,
  ): Promise<BackupCertificate> {
    for (const repository of this.repositories) {
      signal.throwIfAborted();
      try {
        return await repository.loadCertificateInMemory(runId, signal);
      } catch {
        signal.throwIfAborted();
      }
    }
    throw new BackupExecutionError("repository_discontinuity");
  }
  async authenticateParts(
    certificate: BackupCertificate,
    signal: AbortSignal,
  ): Promise<void> {
    for (const candidate of certificate.parts) {
      const part = {
        ...candidate,
        keyId: candidate.keyId ?? certificate.keyId,
      };
      let valid = false;
      for (const repository of this.repositories) {
        signal.throwIfAborted();
        try {
          await repository.openPartToSink(
            part,
            new Writable({
              write(_chunk, _encoding, callback) {
                callback();
              },
            }),
            signal,
          );
          valid = true;
          break;
        } catch {
          signal.throwIfAborted();
        }
      }
      if (!valid) throw new BackupExecutionError("historical_key_unavailable");
    }
    if (certificate.parts.length === 0)
      throw new BackupExecutionError("repository_discontinuity");
  }
}
