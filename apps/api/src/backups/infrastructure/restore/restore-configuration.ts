import { lstat, realpath, statfs } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { BackupVerificationRequest } from "../../application/backup-execution.port";
import { BackupExecutionError } from "../../application/backup-execution.port";
import type { BackupMountedRuntime } from "../capture/backup-mounted-runtime";
import type { ExternalRecoveryKeyMount } from "./external-recovery-keys";
import { assertRecoveryProfile, type RecoveryProfile } from "./restore-safety";
import type { RecoveryObjectVolumeBacking } from "./recovery-object-volume";

export interface BackupRecoveryProfile extends RecoveryProfile {
  readonly stagingAlias: string;
  readonly storageTenantPrefix: string;
  readonly objectVolumeBacking?: RecoveryObjectVolumeBacking;
  readonly externalRecoveryKeys?: Readonly<
    Record<string, ExternalRecoveryKeyMount>
  >;
}
export interface RecoveryApplicationTarget {
  readonly databaseContainer: string;
  readonly network: string;
  readonly directory: string;
  readonly objectDirectory: string;
  readonly objectVolume: string;
  readonly databaseName: string;
  readonly databaseUser: string;
  readonly databasePassword: string;
  readonly ownership: Readonly<Record<string, string>>;
  sql(query: string, signal: AbortSignal, database?: string): Promise<string>;
  cleanupRun(
    args: readonly string[],
    signal: AbortSignal,
    input?: string,
  ): Promise<string>;
  run(
    args: readonly string[],
    signal: AbortSignal,
    input?: string,
  ): Promise<string>;
}
export type RecoveryApplicationProbes = (
  target: RecoveryApplicationTarget,
  signal: AbortSignal,
) => Promise<readonly string[]>;
export type RecoveryExternalKeyProbe = (
  alias: string,
  target: RecoveryApplicationTarget,
  signal: AbortSignal,
) => Promise<boolean>;
export async function resolveRecoveryConfiguration(
  runtime: BackupMountedRuntime,
  profiles: Readonly<Record<string, BackupRecoveryProfile>>,
  request: BackupVerificationRequest,
) {
  const profile = profiles[request.targetProfile];
  const staging = runtime.staging[request.stagingAlias];
  const repository = runtime.repositories[request.repositoryAlias];
  const key = runtime.keys[request.keyAlias];
  if (!profile || !staging || !repository || !key)
    throw new BackupExecutionError("unknown_mount_alias");
  assertRecoveryProfile(profile);
  if (
    profile.stagingAlias !== request.stagingAlias ||
    staging.kind !== "encrypted" ||
    !staging.attestedMount ||
    !repository.offHost ||
    repository.generation !== request.certificate.repositoryGeneration ||
    key.keyId !== request.certificate.keyId
  )
    throw new BackupExecutionError("unsafe_recovery_mount");
  const stat = await lstat(staging.path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.dev !== staging.mountDevice ||
    (stat.mode & 0o077) !== 0 ||
    (await realpath(staging.path)) !== resolve(staging.path)
  )
    throw new BackupExecutionError("unsafe_plaintext_staging");
  const keyStat = await lstat(key.path);
  if (
    !keyStat.isFile() ||
    keyStat.isSymbolicLink() ||
    (keyStat.mode & 0o077) !== 0 ||
    resolve(key.path).startsWith(resolve(repository.path) + "/")
  )
    throw new BackupExecutionError("unsafe_key_mount");
  const capacity = await statfs(staging.path);
  const required = request.certificate.parts.reduce(
    (sum, part) => sum + part.bytes,
    0,
  );
  if (
    !Number.isSafeInteger(required) ||
    required * 2 > staging.maximumBytes ||
    required * 2 > Number(capacity.bavail) * Number(capacity.bsize)
  )
    throw new BackupExecutionError("insufficient_staging");
  return {
    profile,
    staging: staging.path,
    repository: repository.path,
    keyFile: key.path,
    keyId: key.keyId,
  };
}

/** A clean target must never stage beneath a source-owned bind or volume. */
export async function assertStageOutsideSourceMounts(
  staging: string,
  sourceContainers: readonly string[],
  inspect: (containers: readonly string[]) => Promise<string>,
): Promise<void> {
  if (sourceContainers.length === 0) return;
  const uniqueContainers = [...new Set(sourceContainers)];
  const lines = (await inspect(uniqueContainers)).split("\n").filter(Boolean);
  if (lines.length !== uniqueContainers.length)
    throw new BackupExecutionError("unsafe_recovery_mount");
  for (const line of lines) {
    const mounts: unknown = JSON.parse(line);
    if (!Array.isArray(mounts))
      throw new BackupExecutionError("unsafe_recovery_mount");
    for (const mount of mounts as readonly unknown[]) {
      if (
        !mount ||
        typeof mount !== "object" ||
        !("Source" in mount) ||
        typeof mount.Source !== "string"
      )
        throw new BackupExecutionError("unsafe_recovery_mount");
      const source = resolve(mount.Source);
      const target = resolve(staging);
      if (
        target === source ||
        target.startsWith(source + sep) ||
        source.startsWith(target + sep)
      )
        throw new BackupExecutionError("unsafe_recovery_mount");
    }
  }
}
