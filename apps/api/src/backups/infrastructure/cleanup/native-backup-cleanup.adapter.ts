import { z } from "zod";
import { lstat, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { ReviewedBackupRepositoryCleanup } from "../repository/reviewed-backup-cleanup";
import { EncryptedBackupRepository } from "../repository/encrypted-backup.repository";
import { BackupExecutionError } from "../../application/backup-execution.port";
import type { BackupMountedRuntime } from "../capture/backup-mounted-runtime";
import { NativeBackupProcess } from "../capture/native-backup-process";
import { NativeBackupControlTransaction } from "./native-backup-control-transaction";

const alias = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const uuid = z.string().uuid();
const requestSchema = z
  .object({
    instanceId: uuid,
    runId: uuid,
    actor: z.string().regex(/^[a-z0-9][a-z0-9:_/-]{0,199}$/),
    workerId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/),
    expectedVersion: z.number().int().nonnegative(),
    reviewFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    idempotencyKey: uuid,
    sourceAlias: alias,
    repositoryAlias: alias,
  })
  .strict();
export type BackupCleanupExecutionRequest = z.output<typeof requestSchema>;
export interface BackupRepositoryRetirement {
  commit(signal: AbortSignal): Promise<void>;
  rollback(signal: AbortSignal): Promise<void>;
}
export interface ReviewedBackupCleanupRepository {
  recover?(
    runId: string,
    committed: boolean,
    signal: AbortSignal,
  ): Promise<void>;
  prepare(
    request: Readonly<{
      runId: string;
      instanceId: string;
      retainedCaptureRunIds: readonly string[];
      verifiedBaseRunIds: readonly string[];
    }>,
    signal: AbortSignal,
    assertAuthority: () => Promise<void>,
  ): Promise<BackupRepositoryRetirement>;
}
export type BackupCleanupRepositoryFactory = (
  repositoryAlias: string,
) => ReviewedBackupCleanupRepository | Promise<ReviewedBackupCleanupRepository>;
const authorizationSchema = z
  .object({
    run: z
      .object({
        version: z.number().int().nonnegative(),
        kind: z.enum(["capture", "verification"]),
        certificate: z.object({}).passthrough().nullable(),
      })
      .passthrough(),
    retainedCaptureRunIds: z.array(uuid).max(50000),
    verifiedBaseRunIds: z.array(uuid).max(50000),
  })
  .strict();
const reviewSchema = z
  .object({
    eligible: z.boolean(),
    reviewFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .passthrough();

/** Executes only a previously reviewed, claimed cleanup. No timer or API request calls filesystem deletion directly. */
export class NativeBackupCleanupAdapter {
  constructor(
    private readonly runtime: BackupMountedRuntime,
    private readonly repositories: BackupCleanupRepositoryFactory = createCleanupRepositoryFactory(
      runtime,
    ),
    private readonly process = new NativeBackupProcess(),
  ) {}
  cleanup(
    request: BackupCleanupExecutionRequest,
    signal: AbortSignal,
  ): Promise<unknown> {
    return this.execute(request, signal);
  }
  async execute(
    input: BackupCleanupExecutionRequest,
    signal: AbortSignal,
  ): Promise<unknown> {
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success)
      throw new BackupExecutionError("cleanup_configuration");
    const request = parsed.data;
    const source = this.runtime.sources[request.sourceAlias];
    const mount = this.runtime.repositories[request.repositoryAlias];
    if (!source || !mount || !mount.offHost)
      throw new BackupExecutionError("cleanup_configuration");
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(40000)]);
    const session = await NativeBackupControlTransaction.open(
      source,
      this.process,
      bounded,
    );
    let retirement: BackupRepositoryRetirement | undefined;
    let committed = false;
    try {
      const operation = {
        runId: request.runId,
        workerId: request.workerId,
        expectedVersion: request.expectedVersion,
        idempotencyKey: request.idempotencyKey,
        reviewFingerprint: request.reviewFingerprint,
      };
      const authorization = authorizationSchema.parse(
        await session.execute(
          request.instanceId,
          request.actor,
          "cleanup/authorize",
          operation,
        ),
      );
      const assertAuthority = async () => {
        bounded.throwIfAborted();
        const review = reviewSchema.parse(
          await session.execute(
            request.instanceId,
            request.actor,
            "cleanup/review",
            { runId: request.runId },
          ),
        );
        if (
          !review.eligible ||
          review.reviewFingerprint !== request.reviewFingerprint
        )
          throw new BackupExecutionError("cleanup_blocked");
      };
      if (
        authorization.run.kind === "capture" &&
        authorization.run.certificate !== null
      ) {
        const repository = await this.repositories(request.repositoryAlias);
        await repository.recover?.(request.runId, false, bounded);
        retirement = await repository.prepare(
          {
            instanceId: request.instanceId,
            runId: request.runId,
            retainedCaptureRunIds: authorization.retainedCaptureRunIds,
            verifiedBaseRunIds: authorization.verifiedBaseRunIds,
          },
          bounded,
          assertAuthority,
        );
      }
      await assertAuthority();
      const result = await session.execute(
        request.instanceId,
        request.actor,
        "cleanup/finish",
        { ...operation, expectedVersion: authorization.run.version },
      );
      bounded.throwIfAborted();
      await session.commit();
      committed = true;
      // Until acknowledged COMMIT, retirement is reversible. Afterwards only task-owned encrypted trash is removed.
      await retirement?.commit(AbortSignal.timeout(30000));
      return result;
    } catch {
      if (!committed) {
        try {
          await session.rollback();
        } catch {
          /* Closing the connection releases all transaction locks; ciphertext rollback remains mandatory. */
        }
        if (retirement) {
          try {
            await retirement.rollback(AbortSignal.timeout(30000));
          } catch {
            /* The durable cleanup intent remains in encrypted repository storage for conservative recovery. */
          }
        }
      }
      throw new BackupExecutionError("cleanup_failed");
    } finally {
      await session.close();
    }
  }
}

/** Every historical key remains a separate mount. Missing/unsafe keys block the complete graph scan. */
export function createCleanupRepositoryFactory(
  runtime: BackupMountedRuntime,
): BackupCleanupRepositoryFactory {
  return async (alias) => {
    const repository = runtime.repositories[alias];
    if (!repository?.offHost)
      throw new BackupExecutionError("cleanup_configuration");
    const stat = await lstat(repository.path);
    const path = await realpath(repository.path);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o077) !== 0 ||
      path !== resolve(repository.path)
    )
      throw new BackupExecutionError("cleanup_configuration");
    const keys = Object.values(runtime.keys);
    if (keys.length === 0)
      throw new BackupExecutionError("cleanup_configuration");
    for (const key of keys) {
      const keyStat = await lstat(key.path);
      const keyPath = await realpath(key.path);
      if (
        !keyStat.isFile() ||
        keyStat.isSymbolicLink() ||
        (keyStat.mode & 0o077) !== 0 ||
        keyPath !== resolve(key.path) ||
        keyPath.startsWith(path + sep)
      )
        throw new BackupExecutionError("cleanup_configuration");
    }
    return new ReviewedBackupRepositoryCleanup({
      repositoryPath: path,
      keyRepositories: keys.map(
        (key) =>
          new EncryptedBackupRepository({
            repository: path,
            keyFile: key.path,
            keyId: key.keyId,
            gpgBinary: runtime.gpgBinary,
            maximumPartBytes: Math.max(
              64 * 1024 * 1024,
              ...Object.values(runtime.staging ?? {}).map(
                (mount) => mount.maximumBytes,
              ),
            ),
            keyFilesById: Object.fromEntries(
              keys.map((key) => [key.keyId, key.path]),
            ),
          }),
      ),
    });
  };
}
