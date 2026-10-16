import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, lstat, readdir, rename, link, unlink } from "node:fs/promises";
import { join } from "node:path";
import { NativeFlock, type UpgradeJournalLock } from "./native-flock";

export interface JournalRecord {
  readonly sequence: number;
  readonly instanceId: string;
  readonly runId: string;
  readonly kind: string;
  readonly idempotencyKey: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly previousHash: string;
  readonly hash: string;
}
export interface JournalAppend {
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly runId: string;
  readonly kind: string;
  readonly data: Readonly<Record<string, unknown>>;
}
interface Configuration {
  readonly root: string;
  readonly key: Buffer;
  readonly instanceId: string;
  /** Independently retained authority checkpoint, never derived from this journal. */
  readonly minimumSequence: number;
  readonly lock?: UpgradeJournalLock;
}
const fail = (): never => {
  throw new Error("upgrade_journal_unavailable");
};
const MAX_RECORD = 128 * 1024;
const MAX_RECORDS = 10000;

/** Private host mount; no automatic lease expiry or stale lock stealing. */
export class UpgradeHostJournal {
  private readonly key: Buffer;
  constructor(private readonly config: Configuration) {
    if (
      config.key.length < 32 ||
      !Number.isSafeInteger(config.minimumSequence) ||
      config.minimumSequence < 0
    )
      fail();
    this.key = Buffer.from(config.key);
  }
  private mac(value: unknown): string {
    return createHmac("sha256", this.key)
      .update("CRA-UPGRADE-JOURNAL-V1\0")
      .update(JSON.stringify(value))
      .digest("hex");
  }
  private async root(): Promise<void> {
    const stat = await lstat(this.config.root);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o077) !== 0
    )
      fail();
  }
  private async flush(): Promise<void> {
    const fd = await open(
      this.config.root,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      await fd.sync();
    } finally {
      await fd.close();
    }
  }
  private async readJson(name: string): Promise<Record<string, unknown>> {
    const fd = await open(
      join(this.config.root, name),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const stat = await fd.stat();
      if (!stat.isFile() || stat.size > MAX_RECORD) fail();
      const bytes = Buffer.alloc(MAX_RECORD + 1);
      const { bytesRead } = await fd.read(bytes, 0, bytes.length, 0);
      if (bytesRead !== stat.size || bytesRead > MAX_RECORD) fail();
      const value: unknown = JSON.parse(
        bytes.subarray(0, bytesRead).toString("utf8"),
      );
      if (!value || typeof value !== "object" || Array.isArray(value)) fail();
      return value as Record<string, unknown>;
    } finally {
      await fd.close();
    }
  }
  private authentic(value: Record<string, unknown>): Record<string, unknown> {
    const { hash, ...payload } = value;
    if (
      typeof hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(hash) ||
      !timingSafeEqual(
        Buffer.from(hash, "hex"),
        Buffer.from(this.mac(payload), "hex"),
      )
    )
      fail();
    return payload;
  }
  private async readLocked(): Promise<readonly JournalRecord[]> {
    await this.root();
    const names = (await readdir(this.config.root))
      .filter((name) => /^\d{12}\.json$/.test(name))
      .sort();
    if (names.length > MAX_RECORDS) fail();
    let previousHash = "0".repeat(64);
    const records: JournalRecord[] = [];
    for (const [index, name] of names.entries()) {
      if (name !== `${String(index + 1).padStart(12, "0")}.json`) fail();
      const raw = await this.readJson(name);
      const payload = this.authentic(raw);
      if (
        payload.sequence !== index + 1 ||
        payload.instanceId !== this.config.instanceId ||
        payload.previousHash !== previousHash
      )
        fail();
      records.push(raw as unknown as JournalRecord);
      previousHash = raw.hash as string;
    }
    if (records.length < this.config.minimumSequence) fail();
    const hasHead = (await readdir(this.config.root)).includes("current.json");
    if (hasHead) {
      const head = this.authentic(await this.readJson("current.json"));
      if (head.instanceId !== this.config.instanceId) fail();
      if (
        head.sequence === records.length - 1 &&
        head.recordHash === (records.at(-2)?.hash ?? "0".repeat(64))
      ) {
        await this.writeHead(records.length, previousHash);
      } else if (
        head.sequence !== records.length ||
        head.recordHash !== previousHash
      )
        fail();
    } else if (records.length === 1 && this.config.minimumSequence === 0) {
      await this.writeHead(1, previousHash);
    } else if (records.length > 0) fail();
    return records;
  }
  read(): Promise<readonly JournalRecord[]> {
    return this.exclusive("append.lock", () => this.readLocked());
  }
  private async writeHead(sequence: number, recordHash: string): Promise<void> {
    const headName = `head-${randomUUID()}.tmp`;
    await this.write(headName, {
      sequence,
      instanceId: this.config.instanceId,
      recordHash,
    });
    await rename(
      join(this.config.root, headName),
      join(this.config.root, "current.json"),
    );
    await this.flush();
  }
  async readPage(
    afterSequence = 0,
    limit = 100,
  ): Promise<readonly JournalRecord[]> {
    if (
      !Number.isSafeInteger(afterSequence) ||
      afterSequence < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      fail();
    return (await this.read()).slice(afterSequence, afterSequence + limit);
  }
  private async exclusive<T>(
    name: string,
    effect: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    await this.root();
    return (this.config.lock ?? new NativeFlock()).run(
      join(this.config.root, name),
      effect,
    );
  }
  withExclusive<T>(effect: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return this.exclusive("execution.lock", effect);
  }
  private async write(
    name: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const bytes = JSON.stringify({ ...payload, hash: this.mac(payload) });
    if (Buffer.byteLength(bytes) > MAX_RECORD) fail();
    const fd = await open(
      join(this.config.root, name),
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await fd.writeFile(bytes);
      await fd.sync();
    } finally {
      await fd.close();
    }
  }
  async append(command: JournalAppend): Promise<JournalRecord> {
    if (
      ![command.idempotencyKey, command.runId, command.kind].every(
        (value) =>
          typeof value === "string" && /^[a-zA-Z0-9:_-]{1,128}$/.test(value),
      )
    )
      fail();
    return this.exclusive("append.lock", async () => {
      const records = await this.readLocked();
      const existing = records.find(
        (record) => record.idempotencyKey === command.idempotencyKey,
      );
      if (existing) {
        if (
          existing.runId !== command.runId ||
          existing.kind !== command.kind ||
          JSON.stringify(existing.data) !== JSON.stringify(command.data)
        )
          fail();
        return existing;
      }
      if (
        command.expectedVersion !== records.length ||
        records.length >= MAX_RECORDS
      )
        fail();
      const payload = {
        sequence: records.length + 1,
        instanceId: this.config.instanceId,
        runId: command.runId,
        kind: command.kind,
        idempotencyKey: command.idempotencyKey,
        data: command.data,
        previousHash: records.at(-1)?.hash ?? "0".repeat(64),
      };
      const temporary = `record-${randomUUID()}.tmp`;
      await this.write(temporary, payload);
      // A hard link publishes a fully flushed inode atomically without overwrite.
      await link(
        join(this.config.root, temporary),
        join(
          this.config.root,
          `${String(payload.sequence).padStart(12, "0")}.json`,
        ),
      );
      await unlink(join(this.config.root, temporary));
      await this.flush();
      await this.writeHead(payload.sequence, this.mac(payload));
      return { ...payload, hash: this.mac(payload) };
    });
  }
}
