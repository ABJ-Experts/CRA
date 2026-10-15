import { lstat, realpath, statfs } from "node:fs/promises";
import { resolve, sep } from "node:path";
import {
  BackupCaptureRequest,
  BackupExecutionError,
} from "../../application/backup-execution.port";

export interface BackupSourceMount {
  readonly databaseContainer: string;
  readonly databaseName: string;
  readonly databaseUser: string;
  readonly network: string;
  readonly host: string;
  readonly port: number;
  readonly postgresImage: string;
  readonly pgpassFile: string;
  readonly storageContainer: string;
  readonly storageRoot: string;
  readonly storageTenantPrefix: string;
  readonly externalRecoveryKeys?: Readonly<
    Record<string, { readonly containerPath: string }>
  >;
}
export interface BackupRepositoryMount {
  readonly path: string;
  readonly generation: string;
  readonly residency: string;
  readonly offHost: boolean;
}
export type BackupStagingMount =
  | { readonly kind: "tmpfs"; readonly maximumBytes: number }
  | {
      readonly kind: "encrypted";
      readonly path: string;
      readonly maximumBytes: number;
      readonly attestedMount: boolean;
      readonly mountDevice: number;
    };
export interface BackupKeyMount {
  readonly path: string;
  readonly keyId: string;
}
export interface BackupMountedRuntime {
  readonly sources: Readonly<Record<string, BackupSourceMount>>;
  readonly repositories: Readonly<Record<string, BackupRepositoryMount>>;
  readonly staging: Readonly<Record<string, BackupStagingMount>>;
  readonly keys: Readonly<Record<string, BackupKeyMount>>;
  readonly gpgBinary: string;
}
export interface ResolvedBackupMounts {
  readonly source: BackupSourceMount;
  readonly repository: BackupRepositoryMount;
  readonly staging: BackupStagingMount;
  readonly key: BackupKeyMount;
}

export async function resolveBackupMounts(
  runtime: BackupMountedRuntime,
  request: BackupCaptureRequest,
): Promise<ResolvedBackupMounts> {
  const source = runtime.sources[request.sourceAlias];
  const repository = runtime.repositories[request.repositoryAlias];
  const staging = runtime.staging[request.stagingAlias];
  const key = runtime.keys[request.keyAlias];
  if (!source || !repository || !staging || !key)
    throw new BackupExecutionError("unknown_mount_alias");
  for (const id of [request.instanceId, request.runId])
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)
    )
      throw new BackupExecutionError("unsafe_identifier");
  if (
    request.pauseLimitSeconds <= 0 ||
    request.pauseLimitSeconds > 120 ||
    !Number.isInteger(request.pauseLimitSeconds)
  )
    throw new BackupExecutionError("unsafe_pause_limit");
  if (
    !repository.offHost ||
    repository.generation !== request.repositoryGeneration ||
    key.keyId !== request.keyId
  )
    throw new BackupExecutionError("repository_binding");
  if (
    !/^public\.ecr\.aws\/supabase\/postgres:17\.6\.[\w.-]+$|^supabase\/postgres:17\.6\.[\w.-]+$/.test(
      source.postgresImage,
    )
  )
    throw new BackupExecutionError("incompatible_runtime");
  for (const value of [
    source.databaseContainer,
    source.storageContainer,
    source.network,
    source.host,
    source.databaseName,
    source.databaseUser,
  ])
    if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(value))
      throw new BackupExecutionError("unsafe_mount_configuration");
  const repositoryPath = await privateDirectory(repository.path);
  const keyPath = await realpath(key.path);
  if (keyPath.startsWith(`${repositoryPath}${sep}`))
    throw new BackupExecutionError("unsafe_key_mount");
  for (const file of [key.path, source.pgpassFile]) {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0)
      throw new BackupExecutionError("unsafe_key_mount");
  }
  if (
    staging.maximumBytes < 64 * 1024 * 1024 ||
    !Number.isSafeInteger(staging.maximumBytes)
  )
    throw new BackupExecutionError("insufficient_staging");
  if (staging.kind === "encrypted") {
    const path = await privateDirectory(staging.path);
    const stat = await lstat(path);
    if (
      !staging.attestedMount ||
      stat.dev !== staging.mountDevice ||
      path === repositoryPath ||
      path.startsWith(`${repositoryPath}${sep}`)
    )
      throw new BackupExecutionError("unsafe_plaintext_staging");
  }
  const capacity = await statfs(repositoryPath);
  if (Number(capacity.bavail) * Number(capacity.bsize) < 64 * 1024 * 1024)
    throw new BackupExecutionError("insufficient_repository");
  return { source, repository, staging, key };
}

async function privateDirectory(path: string): Promise<string> {
  if (!path.startsWith("/"))
    throw new BackupExecutionError("unsafe_mount_configuration");
  const stat = await lstat(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    (await realpath(path)) !== resolve(path)
  )
    throw new BackupExecutionError("unsafe_mount_configuration");
  return resolve(path);
}
