import { constants } from "node:fs";
import { lstat, mkdir, open, opendir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { hostname } from "node:os";
import { BackupExecutionError } from "../../application/backup-execution.port";
import type { BackupCertificate } from "../../application/backup-execution.port";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export interface BackupRepositoryReviewBudget {
  readonly metadataBytes: number;
  readonly references: number;
}
/** Bound compact certificate/reference metadata retained across sequential reads.
 * Full inventory manifests are transient and bounded independently per receipt.
 */
export function consumeBackupRepositoryReviewBudget(
  current: BackupRepositoryReviewBudget,
  metadataBytes: number,
  references: number,
): BackupRepositoryReviewBudget {
  const next = {
    metadataBytes: current.metadataBytes + metadataBytes,
    references: current.references + references,
  };
  if (
    !Number.isSafeInteger(metadataBytes) ||
    metadataBytes < 0 ||
    !Number.isSafeInteger(references) ||
    references < 0 ||
    next.metadataBytes > 16 * 1024 * 1024 ||
    next.references > 50000
  )
    throw new BackupExecutionError("cleanup_capacity");
  return next;
}
export async function readBackupReviewReceipt(root: string, name: string) {
  const file = await open(
    join(root, "certificates", name),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 8192)
      throw new BackupExecutionError("repository_discontinuity");
    const receipt = JSON.parse(await file.readFile("utf8")) as {
      part: { id: string; bytes: number };
    };
    if (
      !uuid.test(receipt.part.id) ||
      !Number.isSafeInteger(receipt.part.bytes) ||
      receipt.part.bytes <= 0
    )
      throw new BackupExecutionError("repository_discontinuity");
    // The inventory inside one authenticated manifest is discarded by the reader;
    // refuse excessive transient input before invoking decryption.
    if (receipt.part.bytes > 32 * 1024 * 1024)
      throw new BackupExecutionError("cleanup_capacity");
    return receipt;
  } finally {
    await file.close();
  }
}
/** An ownership intent is durable before ciphertext creation. Unknown source state always retains bytes. */
export class BackupPartialParts {
  constructor(
    private readonly root: string,
    private readonly instanceId: string,
    private readonly reader: {
      loadCertificateInMemory(
        runId: string,
        signal: AbortSignal,
      ): Promise<Pick<BackupCertificate, "parts">>;
    },
  ) {}
  async record(partId: string, runId: string): Promise<void> {
    this.id(partId);
    this.id(runId);
    this.id(this.instanceId);
    const directory = join(this.root, "owners");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await this.privateDirectory(directory);
    const file = await open(join(directory, `${partId}.json`), "wx", 0o600);
    try {
      await file.writeFile(
        JSON.stringify({
          version: 1,
          instanceId: this.instanceId,
          runId,
          partId,
        }),
      );
      await file.sync();
    } finally {
      await file.close();
    }
    await this.sync(directory);
  }
  async discard(partIds: readonly string[]): Promise<void> {
    for (const partId of partIds) {
      this.id(partId);
      await rm(join(this.root, "owners", `${partId}.json`), { force: true });
    }
  }
  async reconcile(
    isAbandoned: (runId: string) => Promise<boolean>,
    signal: AbortSignal,
    publicationLeaseHeld = false,
    publicationOwnerRunId?: string,
  ): Promise<number> {
    const directory = join(this.root, "owners");
    try {
      await this.privateDirectory(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw error;
    }
    const scan = await opendir(directory);
    let first;
    try {
      first = await scan.read();
    } finally {
      await scan.close();
    }
    if (!first) return 0;
    const lockPath = join(this.root, ".publication.lock");
    const lock = publicationLeaseHeld
      ? null
      : await open(lockPath, "wx", 0o600).catch(() => {
          throw new BackupExecutionError("conflict");
        });
    if (lock && publicationOwnerRunId) {
      this.id(publicationOwnerRunId);
      await lock.writeFile(
        JSON.stringify({
          runId: publicationOwnerRunId,
          kind: "capture",
          pid: process.pid,
          host: hostname(),
        }),
      );
      await lock.sync();
    }
    try {
      const retained = new Set<string>();
      let budget = { metadataBytes: 0, references: 0 };
      const names = await readdir(join(this.root, "certificates")).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return [];
          throw error;
        },
      );
      if (names.length > 10000)
        throw new BackupExecutionError("cleanup_capacity");
      for (const name of names) {
        if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
        const receipt = await readBackupReviewReceipt(this.root, name);
        const certificate = await this.reader.loadCertificateInMemory(
          name.slice(0, -5),
          signal,
        );
        budget = consumeBackupRepositoryReviewBudget(
          budget,
          Buffer.byteLength(JSON.stringify(certificate), "utf8") +
            Buffer.byteLength(receipt.part.id, "utf8"),
          certificate.parts.length + 1,
        );
        for (const part of certificate.parts) retained.add(part.id);
        retained.add(receipt.part.id);
      }
      const proofs = new Map<string, boolean>();
      let removed = 0;
      let visited = 0;
      for await (const entry of await opendir(directory)) {
        signal.throwIfAborted();
        visited += 1;
        if (visited > 5000 || removed >= 250) break;
        if (!entry.isFile() || !/^[a-f0-9-]{36}\.json$/.test(entry.name))
          throw new BackupExecutionError("repository_discontinuity");
        const path = join(directory, entry.name);
        const file = await open(
          path,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        let intent: {
          version: number;
          instanceId: string;
          runId: string;
          partId: string;
        };
        try {
          if ((await file.stat()).size > 1024)
            throw new BackupExecutionError("repository_discontinuity");
          intent = JSON.parse(await file.readFile("utf8")) as typeof intent;
        } finally {
          await file.close();
        }
        this.id(intent.runId);
        this.id(intent.partId);
        if (intent.version !== 1 || `${intent.partId}.json` !== entry.name)
          throw new BackupExecutionError("repository_discontinuity");
        if (intent.instanceId !== this.instanceId) continue;
        if (retained.has(intent.partId)) {
          await rm(path);
          continue;
        }
        let abandoned = proofs.get(intent.runId);
        if (abandoned === undefined) {
          abandoned = await isAbandoned(intent.runId);
          proofs.set(intent.runId, abandoned);
        }
        if (!abandoned) continue;
        // Recheck the exact terminal source proof at the physical authorization boundary.
        if (!(await isAbandoned(intent.runId))) continue;
        signal.throwIfAborted();
        const partPath = join(this.root, "parts", `${intent.partId}.gpg`);
        const stat = await lstat(partPath).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return null;
            throw error;
          },
        );
        if (stat && (!stat.isFile() || stat.isSymbolicLink()))
          throw new BackupExecutionError("repository_discontinuity");
        await rm(partPath, { force: true });
        await rm(path);
        removed += 1;
      }
      await this.sync(directory);
      await this.sync(join(this.root, "parts"));
      return removed;
    } finally {
      if (lock) {
        await lock.close();
        await rm(lockPath, { force: true });
      }
    }
  }
  private id(value: string): void {
    if (!uuid.test(value)) throw new BackupExecutionError("unsafe_identifier");
  }
  private async privateDirectory(path: string): Promise<void> {
    const stat = await lstat(path);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o077) !== 0
    )
      throw new BackupExecutionError("repository_discontinuity");
  }
  private async sync(path: string): Promise<void> {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      await file.sync();
    } finally {
      await file.close();
    }
  }
}
