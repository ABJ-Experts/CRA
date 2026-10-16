import type {
  BackupCertificate,
  BackupEncryptedPart,
} from "../../application/backup-execution.port";
import { reusableBackupBase } from "./reusable-backup-base";
describe("daily physical base reuse", () => {
  const part = (
    name: string,
    kind: BackupEncryptedPart["kind"] = "wal",
  ): BackupEncryptedPart => ({
    id: "11111111-1111-4111-8111-111111111111",
    kind,
    name,
    sha256: "a".repeat(64),
    bytes: 1,
    cipherSha256: "b".repeat(64),
    cipherBytes: 2,
  });
  const certificate: BackupCertificate = {
    formatVersion: 1,
    instanceId: "instance",
    runId: "run",
    repositoryGeneration: "generation",
    configurationRevision: 1,
    keyId: "key",
    capturedAt: "2026-10-14T00:00:00.000Z",
    checkpoint: {
      systemIdentifier: "source",
      timeline: 1,
      lsn: "0/1000000",
      postgresVersion: "17.6",
      restorePoint: "point",
    },
    parts: [part("base.tar", "base"), part("000000010000000000000001")],
    inventoryDigest: "a".repeat(64),
    auditHeadsDigest: "b".repeat(64),
    certificateDigest: "c".repeat(64),
  };
  const input = {
    instanceId: "instance",
    keyId: "key",
    repositoryGeneration: "generation",
    systemIdentifier: "source",
    timeline: 1,
    now: Date.parse("2026-10-14T01:00:00.000Z"),
    intervalHours: 24,
    currentWalName: "000000010000000000000003",
    archivedWal: [part("000000010000000000000002")],
  };
  it("reuses one verified base with contiguous WAL and retains the original base age", () => {
    expect(reusableBackupBase(certificate, input)?.wal).toHaveLength(2);
    expect(
      reusableBackupBase(
        { ...certificate, baseCapturedAt: "2026-10-12T00:00:00Z" },
        input,
      ),
    ).toBeNull();
  });
  it.each([NaN, Infinity, -1, 0, 25])(
    "rejects invalid base interval %s",
    (intervalHours) => {
      expect(
        reusableBackupBase(certificate, { ...input, intervalHours }),
      ).toBeNull();
    },
  );
  it("rejects source, key, timeline, repository, clock and WAL discontinuities", () => {
    expect(reusableBackupBase(null, input)).toBeNull();
    for (const altered of [
      { keyId: "other" },
      { instanceId: "other" },
      { repositoryGeneration: "other" },
      { systemIdentifier: "other" },
      { timeline: 2 },
      { now: 0 },
    ])
      expect(
        reusableBackupBase(certificate, { ...input, ...altered }),
      ).toBeNull();
    expect(reusableBackupBase({ ...certificate, parts: [] }, input)).toBeNull();
    expect(
      reusableBackupBase(
        {
          ...certificate,
          parts: [part("wrong", "base"), part("000000010000000000000001")],
        },
        input,
      ),
    ).toBeNull();
    expect(
      reusableBackupBase(
        { ...certificate, parts: [part("base.tar", "base")] },
        input,
      ),
    ).toBeNull();
    expect(
      reusableBackupBase(certificate, {
        ...input,
        archivedWal: [part("000000010000000000000003")],
      }),
    ).toBeNull();
    expect(
      reusableBackupBase(certificate, {
        ...input,
        archivedWal: [part("000000020000000000000002")],
      }),
    ).toBeNull();
  });
  it("requires fresh archived coverage beyond the previous cut", () => {
    expect(
      reusableBackupBase(certificate, { ...input, archivedWal: [] }),
    ).toBeNull();
    expect(
      reusableBackupBase(certificate, {
        ...input,
        archivedWal: [part("000000010000000000000001")],
      }),
    ).toBeNull();
  });
});
