import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { z } from "zod";
import { backupFailureCodeSchema } from "@repo/contracts/backups/schemas";
import type { BackupFailureCode } from "@repo/contracts/backups/types";
import type { BackupMountedRuntime } from "../capture/backup-mounted-runtime";
import { EncryptedBackupRepository } from "../repository/encrypted-backup.repository";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const partSchema = z.strictObject({
  id: z.uuid(),
  kind: z.literal("inventory"),
  name: z.literal("operator-alert.json"),
  sha256: digest,
  bytes: z.number().int().min(1).max(4096),
  cipherSha256: digest,
  cipherBytes: z.number().int().min(1).max(1048576),
  keyId: z
    .string()
    .regex(/^[a-z][a-z0-9_-]{0,63}$/)
    .optional(),
});
const noticeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  instanceId: z.uuid(),
  code: backupFailureCodeSchema,
  occurredAt: z.iso.datetime(),
  occurrenceKey: z.string().regex(/^[a-z_]+:\d{4}-\d{2}-\d{2}$/),
});
export interface BackupOperatorAlertSelection {
  readonly repositoryAlias: string;
  readonly keyAlias: string;
}
/** Fixed operational notices remain durable when the source database cannot accept an alert receipt. */
export class BackupOperatorAlerts {
  private selection?: BackupOperatorAlertSelection;
  private acknowledged: ReadonlySet<string> = new Set();
  constructor(
    private readonly instanceId: string,
    private readonly runtime: BackupMountedRuntime,
    selection?: BackupOperatorAlertSelection,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.selection = selection;
  }
  select(selection: BackupOperatorAlertSelection): void {
    if (
      selection.repositoryAlias !== this.selection?.repositoryAlias ||
      selection.keyAlias !== this.selection?.keyAlias
    )
      this.acknowledged = new Set();
    this.selection = {
      repositoryAlias: selection.repositoryAlias,
      keyAlias: selection.keyAlias,
    };
  }
  async record(code: BackupFailureCode, signal: AbortSignal): Promise<boolean> {
    try {
      z.uuid().parse(this.instanceId);
      backupFailureCodeSchema.parse(code);
      signal.throwIfAborted();
      const occurredAt = this.now().toISOString();
      const occurrenceKey = `${code}:${occurredAt.slice(0, 10)}`;
      if (this.acknowledged.has(occurrenceKey)) return false;
      const selection = this.selection ?? this.singleSelection();
      const mount = this.runtime.repositories[selection.repositoryAlias];
      const key = this.runtime.keys[selection.keyAlias];
      if (!mount?.offHost || !key) throw new Error();
      const repositoryPath = await this.privateDirectory(mount.path);
      const repository = new EncryptedBackupRepository({
        repository: repositoryPath,
        keyFile: key.path,
        keyId: key.keyId,
        keyFilesById: Object.fromEntries(
          Object.values(this.runtime.keys).map((value) => [
            value.keyId,
            value.path,
          ]),
        ),
        gpgBinary: this.runtime.gpgBinary,
        maximumPartBytes: 4096,
      });
      const directory = join(
        repositoryPath,
        "operator-alerts",
        this.instanceId,
      );
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await this.privateDirectory(directory);
      const index = join(directory, `${code}-${occurredAt.slice(0, 10)}.json`);
      const existing = await this.readIndex(index);
      if (existing) {
        const part = partSchema.parse(JSON.parse(existing) as unknown);
        const chunks: Buffer[] = [];
        let bytes = 0;
        await repository.openPartToSink(
          part,
          new Writable({
            write(chunk: Buffer, _encoding, done) {
              bytes += chunk.length;
              if (bytes > 4096) return done(new Error());
              chunks.push(chunk);
              done();
            },
          }),
          signal,
        );
        const notice = noticeSchema.parse(
          JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
        );
        if (
          notice.instanceId !== this.instanceId ||
          notice.code !== code ||
          notice.occurrenceKey !== occurrenceKey
        )
          throw new Error();
        this.acknowledged = new Set(
          [...this.acknowledged, occurrenceKey].slice(-128),
        );
        return false;
      }
      const notice = noticeSchema.parse({
        schemaVersion: 1,
        instanceId: this.instanceId,
        code,
        occurredAt,
        occurrenceKey,
      });
      const part = partSchema.parse(
        await repository.sealPart(
          this.instanceId,
          "inventory",
          "operator-alert.json",
          Readable.from([JSON.stringify(notice)]),
          signal,
        ),
      );
      const pending = join(directory, `${randomUUID()}.partial`);
      const file = await open(
        pending,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await file.writeFile(JSON.stringify(part));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(pending, index);
      const parent = await open(directory, "r");
      try {
        await parent.sync();
      } finally {
        await parent.close();
      }
      this.acknowledged = new Set(
        [...this.acknowledged, occurrenceKey].slice(-128),
      );
      return true;
    } catch {
      throw new Error("Operator alert journal unavailable");
    }
  }
  private singleSelection(): BackupOperatorAlertSelection {
    const repositories = Object.keys(this.runtime.repositories);
    const keys = Object.keys(this.runtime.keys);
    if (repositories.length !== 1 || keys.length !== 1) throw new Error();
    return { repositoryAlias: repositories[0]!, keyAlias: keys[0]! };
  }
  private async privateDirectory(path: string): Promise<string> {
    const info = await lstat(path);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (info.mode & 0o077) !== 0 ||
      (await realpath(path)) !== resolve(path)
    )
      throw new Error();
    return resolve(path);
  }
  private async readIndex(path: string): Promise<string | null> {
    try {
      const info = await lstat(path);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        (info.mode & 0o077) !== 0 ||
        info.size > 8192
      )
        throw new Error();
      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        return await file.readFile("utf8");
      } finally {
        await file.close();
      }
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return null;
      throw error;
    }
  }
}
