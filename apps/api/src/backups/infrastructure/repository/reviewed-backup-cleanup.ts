import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import type { BackupCertificate } from "../../application/backup-execution.port";
import { BackupExecutionError } from "../../application/backup-execution.port";
import { EncryptedBackupRepository } from "./encrypted-backup.repository";
import {
  consumeBackupRepositoryReviewBudget,
  readBackupReviewReceipt,
} from "./backup-partial-parts";

export interface BackupRepositoryCleanupRequest {
  readonly runId: string;
  readonly instanceId: string;
  readonly retainedCaptureRunIds: readonly string[];
  readonly verifiedBaseRunIds: readonly string[];
}
export interface PreparedBackupRepositoryCleanup {
  commit(signal: AbortSignal): Promise<void>;
  rollback(signal: AbortSignal): Promise<void>;
}
interface CleanupIntent {
  readonly version: 1;
  readonly runId: string;
  readonly certificateDigest: string;
  readonly parts: readonly string[];
  readonly receipt: boolean;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

/** SQL protection locks remain held while prepare renames. Bytes are deleted only after its audited COMMIT. */
export class ReviewedBackupRepositoryCleanup {
  constructor(
    private readonly configuration: {
      readonly repositoryPath: string;
      readonly keyRepositories: readonly EncryptedBackupRepository[];
    },
  ) {}

  async prepare(
    request: BackupRepositoryCleanupRequest,
    signal: AbortSignal,
    assertAuthority: () => Promise<void>,
  ): Promise<PreparedBackupRepositoryCleanup> {
    signal.throwIfAborted();
    this.requireId(request.runId);
    this.requireId(request.instanceId);
    const lockPath = join(
      this.configuration.repositoryPath,
      ".publication.lock",
    );
    const lock = await open(lockPath, "wx", 0o600).catch(() => {
      throw new BackupExecutionError("conflict");
    });
    await lock.writeFile(
      JSON.stringify({ runId: request.runId, kind: "cleanup" }),
    );
    await lock.sync();
    const transaction = join(
      this.configuration.repositoryPath,
      "cleanup",
      `${request.runId}-${randomUUID()}`,
    );
    let staged = false;
    const release = async () => {
      await lock.close();
      await rm(lockPath, { force: true });
    };
    try {
      await assertAuthority();
      const names = (
        await readdir(join(this.configuration.repositoryPath, "certificates"))
      ).filter((name) => /^[a-f0-9-]{36}\.json$/.test(name));
      if (names.length > 10000)
        throw new BackupExecutionError("cleanup_capacity");
      const certificates: BackupCertificate[] = [];
      let budget = { metadataBytes: 0, references: 0 };
      for (const name of names) {
        signal.throwIfAborted();
        const receipt = await readBackupReviewReceipt(
          this.configuration.repositoryPath,
          name,
        );
        const certificate = await this.load(name.slice(0, -5), signal);
        budget = consumeBackupRepositoryReviewBudget(
          budget,
          Buffer.byteLength(JSON.stringify(certificate), "utf8") +
            Buffer.byteLength(receipt.part.id, "utf8"),
          certificate.parts.length + 1,
        );
        certificates.push(certificate);
      }
      const target = certificates.find(
        (c) => c.runId === request.runId && c.instanceId === request.instanceId,
      );
      if (!target) throw new BackupExecutionError("repository_discontinuity");
      for (const id of request.retainedCaptureRunIds)
        if (
          !certificates.some(
            (c) => c.runId === id && c.instanceId === request.instanceId,
          )
        )
          throw new BackupExecutionError("repository_discontinuity");
      const others = certificates.filter((c) => c.runId !== request.runId);
      const bases = new Set<string>();
      for (const candidate of others.filter((c) =>
        request.verifiedBaseRunIds.includes(c.baseRunId ?? c.runId),
      )) {
        let valid = true;
        for (const part of candidate.parts) {
          signal.throwIfAborted();
          try {
            await this.authenticatePart(
              { ...part, keyId: part.keyId ?? candidate.keyId },
              signal,
            );
          } catch {
            signal.throwIfAborted();
            valid = false;
            break;
          }
        }
        if (valid)
          for (const part of candidate.parts.filter((p) => p.kind === "base"))
            bases.add(part.id);
      }
      if (bases.size < 2)
        throw new BackupExecutionError("last_recoverable_chain");
      await this.assertNotLatest(request);
      const referenced = new Set(
        others.flatMap((c) => c.parts.map((p) => p.id)),
      );
      // The separately authenticated continuous WAL journal is authoritative. Its parts are never removed by capture cleanup.
      const deletable = target.parts
        .filter((p) => p.kind !== "wal" && !referenced.has(p.id))
        .map((p) => p.id);
      const receiptPath = join(
        this.configuration.repositoryPath,
        "certificates",
        `${request.runId}.json`,
      );
      const receipt = await readBackupReviewReceipt(
        this.configuration.repositoryPath,
        `${request.runId}.json`,
      );
      if (!referenced.has(receipt.part.id)) deletable.push(receipt.part.id);
      const parts = [...new Set(deletable)];
      for (const id of parts) this.requireId(id);
      await assertAuthority();
      signal.throwIfAborted();
      await mkdir(join(this.configuration.repositoryPath, "cleanup"), {
        recursive: true,
        mode: 0o700,
      });
      await mkdir(transaction, { mode: 0o700 });
      const intent: CleanupIntent = {
        version: 1,
        runId: request.runId,
        certificateDigest: target.certificateDigest,
        parts,
        receipt: true,
      };
      await this.writeIntent(transaction, intent);
      staged = true;
      for (const id of parts) {
        await assertAuthority();
        signal.throwIfAborted();
        await this.moveIfExists(
          join(this.configuration.repositoryPath, "parts", `${id}.gpg`),
          join(transaction, `${id}.gpg`),
        );
      }
      await rename(receiptPath, join(transaction, "receipt.json"));
      await this.sync(transaction);
      await this.sync(join(this.configuration.repositoryPath, "parts"));
      await this.sync(join(this.configuration.repositoryPath, "certificates"));
      let finished = false;
      return {
        commit: async (commitSignal) => {
          if (finished) return;
          commitSignal.throwIfAborted();
          await this.commit(transaction, intent);
          finished = true;
          await release();
        },
        rollback: async (rollbackSignal) => {
          if (finished) return;
          rollbackSignal.throwIfAborted();
          await this.rollback(transaction, intent);
          finished = true;
          await release();
        },
      };
    } catch (error) {
      if (staged) {
        const intent = JSON.parse(
          await readFile(join(transaction, "intent.json"), "utf8"),
        ) as CleanupIntent;
        await this.rollback(transaction, intent);
      }
      await release();
      throw error;
    }
  }

  /** Restart recovery must pass the durable SQL tombstone decision; an unknown decision restores bytes. */
  async recover(
    runId: string,
    committed: boolean,
    signal: AbortSignal,
  ): Promise<void> {
    this.requireId(runId);
    const root = join(this.configuration.repositoryPath, "cleanup");
    const names = await readdir(root).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const name of names) {
      if (!name.startsWith(`${runId}-`) || !/^[a-f0-9-]{73}$/.test(name))
        continue;
      signal.throwIfAborted();
      const transaction = join(root, name);
      const intent = JSON.parse(
        await readFile(join(transaction, "intent.json"), "utf8"),
      ) as CleanupIntent;
      this.validateIntent(intent, runId);
      if (committed) await this.commit(transaction, intent);
      else await this.rollback(transaction, intent);
    }
    const lockPath = join(
      this.configuration.repositoryPath,
      ".publication.lock",
    );
    const marker = await readFile(lockPath, "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    if (marker) {
      const owner = JSON.parse(marker) as { runId: string; kind: string };
      if (owner.runId === runId && owner.kind === "cleanup")
        await rm(lockPath, { force: true });
    }
  }

  private async load(
    runId: string,
    signal: AbortSignal,
  ): Promise<BackupCertificate> {
    for (const repository of this.configuration.keyRepositories) {
      try {
        return await repository.loadCertificateInMemory(runId, signal);
      } catch {
        signal.throwIfAborted();
      }
    }
    throw new BackupExecutionError("repository_discontinuity");
  }
  private async authenticatePart(
    part: BackupCertificate["parts"][number],
    signal: AbortSignal,
  ): Promise<void> {
    for (const repository of this.configuration.keyRepositories) {
      signal.throwIfAborted();
      try {
        // Discard bounded plaintext as it streams; a chain counts only after OCB,
        // plaintext hash and length checks all finish with its actual recovery key.
        await repository.openPartToSink(
          part,
          new Writable({
            write(_chunk, _encoding, callback) {
              callback();
            },
          }),
          signal,
        );
        return;
      } catch {
        signal.throwIfAborted();
      }
    }
    throw new BackupExecutionError("historical_key_unavailable");
  }
  private async assertNotLatest(
    request: BackupRepositoryCleanupRequest,
  ): Promise<void> {
    const path = join(
      this.configuration.repositoryPath,
      "instances",
      `${request.instanceId}.json`,
    );
    const contents = await readFile(path, "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    if (
      contents &&
      (JSON.parse(contents) as { runId: string }).runId === request.runId
    )
      throw new BackupExecutionError("required_dependency");
  }
  private requireId(value: string): void {
    if (!uuid.test(value)) throw new BackupExecutionError("unsafe_identifier");
  }
  private validateIntent(intent: CleanupIntent, runId: string): void {
    if (
      intent.version !== 1 ||
      intent.runId !== runId ||
      !Array.isArray(intent.parts) ||
      intent.parts.length > 100000 ||
      !/^[a-f0-9]{64}$/.test(intent.certificateDigest)
    )
      throw new BackupExecutionError("repository_discontinuity");
    for (const id of intent.parts) {
      if (typeof id !== "string")
        throw new BackupExecutionError("repository_discontinuity");
      this.requireId(id);
    }
  }
  private async writeIntent(
    transaction: string,
    intent: CleanupIntent,
  ): Promise<void> {
    const file = await open(join(transaction, "intent.json"), "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(intent));
      await file.sync();
    } finally {
      await file.close();
    }
    await this.sync(transaction);
  }
  private async moveIfExists(source: string, target: string): Promise<void> {
    const stat = await lstat(source);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new BackupExecutionError("repository_discontinuity");
    await rename(source, target);
  }
  private async rollback(
    transaction: string,
    intent: CleanupIntent,
  ): Promise<void> {
    for (const id of intent.parts) {
      const source = join(transaction, `${id}.gpg`);
      if (await this.exists(source))
        await rename(
          source,
          join(this.configuration.repositoryPath, "parts", `${id}.gpg`),
        );
    }
    const receipt = join(transaction, "receipt.json");
    if (await this.exists(receipt))
      await rename(
        receipt,
        join(
          this.configuration.repositoryPath,
          "certificates",
          `${intent.runId}.json`,
        ),
      );
    await rm(transaction, { recursive: true, force: true });
    await this.sync(join(this.configuration.repositoryPath, "parts"));
  }
  private async commit(
    transaction: string,
    intent: CleanupIntent,
  ): Promise<void> {
    const tombstones = join(this.configuration.repositoryPath, "tombstones");
    await mkdir(tombstones, { recursive: true, mode: 0o700 });
    const target = join(tombstones, `${intent.runId}.json`);
    const file = await open(target, "wx", 0o600).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "EEXIST") return null;
        throw error;
      },
    );
    if (file) {
      try {
        await file.writeFile(
          JSON.stringify({
            runId: intent.runId,
            certificateDigest: intent.certificateDigest,
            deletedAt: new Date().toISOString(),
          }),
        );
        await file.sync();
      } finally {
        await file.close();
      }
    }
    await this.sync(tombstones);
    await rm(transaction, { recursive: true, force: true });
    await this.sync(join(this.configuration.repositoryPath, "cleanup"));
  }
  private async exists(path: string): Promise<boolean> {
    return lstat(path).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    );
  }
  private async sync(path: string): Promise<void> {
    const directory = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}
