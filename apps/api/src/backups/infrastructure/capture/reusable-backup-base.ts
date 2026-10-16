import {
  BackupCertificate,
  BackupEncryptedPart,
} from "../../application/backup-execution.port";
import { assertWalSequence, walOrdinal } from "./wal-sequence";

/** Reuse is permitted only with one independently sealed base and complete WAL continuity. */
export function reusableBackupBase(
  certificate: BackupCertificate | null,
  input: {
    readonly instanceId: string;
    readonly keyId: string;
    readonly repositoryGeneration: string;
    readonly systemIdentifier: string;
    readonly timeline: number;
    readonly now: number;
    readonly intervalHours: number;
    readonly archivedWal: readonly BackupEncryptedPart[];
    readonly currentWalName: string;
  },
): {
  readonly base: BackupEncryptedPart;
  readonly wal: readonly BackupEncryptedPart[];
  readonly baseCapturedAt: string;
} | null {
  if (
    certificate === null ||
    certificate.instanceId !== input.instanceId ||
    certificate.keyId !== input.keyId ||
    certificate.repositoryGeneration !== input.repositoryGeneration ||
    certificate.checkpoint.systemIdentifier !== input.systemIdentifier ||
    certificate.checkpoint.timeline !== input.timeline
  )
    return null;
  const baseCapturedAt = certificate.baseCapturedAt ?? certificate.capturedAt;
  const age = input.now - Date.parse(baseCapturedAt);
  if (
    !Number.isFinite(age) ||
    !Number.isInteger(input.intervalHours) ||
    age < 0 ||
    input.intervalHours <= 0 ||
    input.intervalHours > 24 ||
    age >= input.intervalHours * 3600000
  )
    return null;
  const bases = certificate.parts.filter((part) => part.kind === "base");
  if (bases.length !== 1 || bases[0]!.name !== "base.tar") return null;
  const existing = certificate.parts.filter((part) => part.kind === "wal");
  if (existing.length === 0) return null;
  const byName = new Map(
    [
      ...existing,
      ...input.archivedWal.filter((part) => part.kind === "wal"),
    ].map((part) => [part.name, part]),
  );
  const names = [...byName.keys()].sort();
  try {
    assertWalSequence(names);
  } catch {
    return null;
  }
  const lastExisting = existing
    .map((part) => part.name)
    .sort()
    .at(-1)!;
  try {
    const archived = input.archivedWal
      .filter((part) => part.kind === "wal")
      .map((part) => part.name)
      .sort();
    const last = archived.at(-1);
    if (
      !last ||
      walOrdinal(last) <= walOrdinal(lastExisting) ||
      walOrdinal(last) < walOrdinal(input.currentWalName) - 1n ||
      last.slice(0, 8) !== input.currentWalName.slice(0, 8)
    )
      return null;
  } catch {
    return null;
  }
  // A supervisor starting beyond the previous cut cannot establish the intervening chain.
  if (
    input.archivedWal.length > 0 &&
    input.archivedWal.every(
      (part) => walOrdinal(part.name) > walOrdinal(lastExisting) + 1n,
    )
  )
    return null;
  return {
    base: bases[0]!,
    wal: names.map((name) => byName.get(name)!),
    baseCapturedAt,
  };
}
