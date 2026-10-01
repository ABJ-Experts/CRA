import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

export type QueuedPage = Readonly<{
  sourceId: string;
  batchId: string;
  sequence: number;
  cursorFrom: string | null;
  cursorTo: string;
  body: string;
}>;

type StoredPage = Omit<QueuedPage, "body"> & {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
};

/** One outstanding page per source keeps the accepted checkpoint unambiguous. */
export class AgentQueue {
  private readonly db: Database.Database;
  private readonly key: Buffer;
  private readonly maxBytes: number;
  private readonly maxBatches: number;
  private readonly path: string;

  constructor(input: Readonly<{ path: string; key: Buffer; maxBytes: number; maxBatches?: number }>) {
    if (input.key.length !== 32) throw new Error("invalid_queue_key");
    if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1) throw new Error("invalid_queue_limit");
    this.key = input.key;
    this.maxBytes = input.maxBytes;
    this.path = input.path;
    this.maxBatches = input.maxBatches ?? 100;
    if (!Number.isSafeInteger(this.maxBatches) || this.maxBatches < 1) throw new Error("invalid_queue_limit");
    mkdirSync(dirname(input.path), { recursive: true, mode: 0o700 });
    const existed = existsSync(input.path);
    this.db = new Database(input.path, { timeout: 5000 });
    if (!existed) chmodSync(input.path, 0o600);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = FULL");
    this.db.pragma("secure_delete = ON");
    this.db.pragma("wal_autocheckpoint = 32");
    this.db.pragma("journal_size_limit = 1048576");
    const pageSize = this.db.pragma("page_size", { simple: true }) as number;
    this.db.pragma(`max_page_count = ${Math.floor(this.diskCeiling() / pageSize)}`);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS source_state (
        source_id TEXT PRIMARY KEY,
        checkpoint TEXT,
        last_sequence INTEGER NOT NULL DEFAULT 0,
        last_batch_id TEXT
      );
      CREATE TABLE IF NOT EXISTS pending_pages (
        source_id TEXT PRIMARY KEY REFERENCES source_state(source_id),
        batch_id TEXT NOT NULL UNIQUE,
        sequence INTEGER NOT NULL,
        cursor_from TEXT,
        cursor_to TEXT NOT NULL,
        plaintext_bytes INTEGER NOT NULL,
        iv BLOB NOT NULL,
        tag BLOB NOT NULL,
        ciphertext BLOB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS seen_cursors (
        source_id TEXT NOT NULL REFERENCES source_state(source_id),
        cursor_hash TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        PRIMARY KEY (source_id, cursor_hash)
      );
    `);
  }

  checkpoint(sourceId: string): string | null {
    const row = this.db.prepare("SELECT checkpoint FROM source_state WHERE source_id = ?").get(sourceId) as {checkpoint: string | null} | undefined;
    return row?.checkpoint ? this.openCursor(sourceId, row.checkpoint) : null;
  }

  nextSequence(sourceId: string): number {
    const row = this.db.prepare("SELECT last_sequence FROM source_state WHERE source_id = ?").get(sourceId) as {last_sequence: number} | undefined;
    return (row?.last_sequence ?? 0) + 1;
  }

  pending(sourceId: string): QueuedPage | null {
    const row = this.db.prepare("SELECT source_id sourceId, batch_id batchId, sequence, cursor_from cursorFrom, cursor_to cursorTo, ciphertext, iv, tag FROM pending_pages WHERE source_id = ?").get(sourceId) as StoredPage | undefined;
    return row ? this.decrypt(row) : null;
  }

  pendingAll(): readonly QueuedPage[] {
    const rows = this.db.prepare("SELECT source_id sourceId, batch_id batchId, sequence, cursor_from cursorFrom, cursor_to cursorTo, ciphertext, iv, tag FROM pending_pages ORDER BY rowid").all() as StoredPage[];
    return rows.map((row) => this.decrypt(row));
  }

  backlog(): Readonly<{ count: number; bytes: number }> {
    const row = this.db.prepare("SELECT COUNT(*) count, COALESCE(SUM(plaintext_bytes), 0) bytes FROM pending_pages").get() as {count: number; bytes: number};
    return row;
  }

  hasSeenCursor(sourceId: string, cursor: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM seen_cursors WHERE source_id = ? AND cursor_hash = ?").get(sourceId, this.cursorFingerprint(sourceId, cursor)));
  }

  enqueue(page: QueuedPage): void {
    if (!Number.isSafeInteger(page.sequence) || page.sequence < 1) throw new Error("invalid_sequence");
    const bytes = Buffer.byteLength(page.body, "utf8");
    this.db.transaction(() => {
      this.db.prepare("INSERT OR IGNORE INTO source_state(source_id) VALUES (?)").run(page.sourceId);
      const state = this.db.prepare("SELECT last_sequence FROM source_state WHERE source_id = ?").get(page.sourceId) as {last_sequence: number};
      if (this.db.prepare("SELECT 1 FROM pending_pages WHERE source_id = ?").get(page.sourceId)) throw new Error("pending_batch");
      if (this.checkpoint(page.sourceId) !== page.cursorFrom) throw new Error("cursor_conflict");
      if (page.sequence !== state.last_sequence + 1) throw new Error("sequence_conflict");
      const backlog = this.backlog();
      if (bytes > this.maxBytes - backlog.bytes || backlog.count >= this.maxBatches) throw new Error("queue_full");
      if (this.physicalBytes() + bytes * 2 + 256 * 1024 > this.diskCeiling()) throw new Error("queue_full");
      if (this.hasSeenCursor(page.sourceId, page.cursorTo)) throw new Error("cursor_replayed");
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", this.key, iv);
      cipher.setAAD(Buffer.from(`${page.sourceId}.${page.batchId}.${page.sequence}`));
      const ciphertext = Buffer.concat([cipher.update(page.body, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      this.db.prepare("INSERT INTO pending_pages(source_id,batch_id,sequence,cursor_from,cursor_to,plaintext_bytes,iv,tag,ciphertext) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(page.sourceId, page.batchId, page.sequence, page.cursorFrom === null ? null : this.sealCursor(page.sourceId, page.cursorFrom), this.sealCursor(page.sourceId, page.cursorTo), bytes, iv, tag, ciphertext);
    })();
  }

  ack(batchId: string, sequence: number): void {
    this.db.transaction(() => {
      const row = this.db.prepare("SELECT source_id sourceId, sequence, cursor_to cursorTo FROM pending_pages WHERE batch_id = ?").get(batchId) as {sourceId: string; sequence: number; cursorTo: string} | undefined;
      if (!row) {
        const prior = this.db.prepare("SELECT last_sequence lastSequence FROM source_state WHERE last_batch_id = ?").get(batchId) as {lastSequence: number} | undefined;
        if (prior?.lastSequence === sequence) return;
        throw new Error("unknown_batch_ack");
      }
      if (row.sequence !== sequence) throw new Error("ack_sequence_conflict");
      const cursorTo = this.openCursor(row.sourceId, row.cursorTo);
      this.db.prepare("UPDATE source_state SET checkpoint = ?, last_sequence = ?, last_batch_id = ? WHERE source_id = ?")
        .run(row.cursorTo, sequence, batchId, row.sourceId);
      this.db.prepare("DELETE FROM pending_pages WHERE batch_id = ?").run(batchId);
      this.db.prepare("INSERT INTO seen_cursors(source_id,cursor_hash,sequence) VALUES (?,?,?)")
        .run(row.sourceId, this.cursorFingerprint(row.sourceId, cursorTo), sequence);
      // ponytail: Keep the last 1024 cursors; older opaque tokens need source-side uniqueness.
      this.db.prepare("DELETE FROM seen_cursors WHERE source_id = ? AND sequence < ?")
        .run(row.sourceId, sequence - 1024);
    })();
    this.db.pragma("wal_checkpoint(TRUNCATE)");
  }

  close(): void {
    this.db.pragma("wal_checkpoint(TRUNCATE)");
    this.db.close();
  }

  private decrypt(row: StoredPage): QueuedPage {
    const decipher = createDecipheriv("aes-256-gcm", this.key, row.iv);
    decipher.setAAD(Buffer.from(`${row.sourceId}.${row.batchId}.${row.sequence}`));
    decipher.setAuthTag(row.tag);
    return {
      sourceId: row.sourceId,
      batchId: row.batchId,
      sequence: row.sequence,
      cursorFrom: row.cursorFrom === null ? null : this.openCursor(row.sourceId, row.cursorFrom),
      cursorTo: this.openCursor(row.sourceId, row.cursorTo),
      body: Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString("utf8"),
    };
  }

  private diskCeiling(): number { return this.maxBytes * 2 + 8 * 1024 * 1024; }

  private cursorFingerprint(sourceId: string, cursor: string): string {
    return createHmac("sha256", this.key).update(`${sourceId}.${cursor}`).digest("hex");
  }

  private sealCursor(sourceId: string, cursor: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(`${sourceId}.cursor`));
    const ciphertext = Buffer.concat([cipher.update(cursor, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
  }

  private openCursor(sourceId: string, sealed: string): string {
    const packed = Buffer.from(sealed, "base64url");
    if (packed.length < 29) throw new Error("invalid_encrypted_cursor");
    const decipher = createDecipheriv("aes-256-gcm", this.key, packed.subarray(0, 12));
    decipher.setAAD(Buffer.from(`${sourceId}.cursor`));
    decipher.setAuthTag(packed.subarray(12, 28));
    return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8");
  }

  private physicalBytes(): number {
    return [this.path, `${this.path}-wal`, `${this.path}-shm`].reduce((sum, path) => sum + (existsSync(path) ? statSync(path).size : 0), 0);
  }
}
