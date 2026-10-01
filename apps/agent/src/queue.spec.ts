import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { AgentQueue } from "./queue.js";
import type Database from "better-sqlite3";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup(maxBytes = 1024) {
  const root = mkdtempSync(join(tmpdir(), "cra-agent-"));
  roots.push(root);
  return { root, path: join(root, "queue.sqlite"), key: Buffer.alloc(32, 7), maxBytes };
}

it("encrypts a queued page and survives restart without advancing its checkpoint", () => {
  const options = setup();
  const first = new AgentQueue(options);
  first.enqueue({ sourceId: "plm", batchId: "e7d5d1c3-5a1b-4e09-af0d-89c07f789c04", sequence: 1, cursorFrom: null, cursorTo: "offset:2", body: "sensitive product data" });
  expect(first.checkpoint("plm")).toBeNull();
  first.close();
  expect(readFileSync(options.path).includes(Buffer.from("sensitive product data"))).toBe(false);
  expect(readFileSync(options.path).includes(Buffer.from("offset:2"))).toBe(false);
  const second = new AgentQueue(options);
  expect(second.pending("plm")?.body).toBe("sensitive product data");
  second.ack("e7d5d1c3-5a1b-4e09-af0d-89c07f789c04", 1);
  expect(second.checkpoint("plm")).toBe("offset:2");
  expect(second.pending("plm")).toBeNull();
  second.close();
  expect(readFileSync(options.path).includes(Buffer.from("offset:2"))).toBe(false);
});

it("enforces per-source backpressure, cursor ordering and disk bound", () => {
  const options = setup(32);
  const queue = new AgentQueue(options);
  const page = { sourceId: "plm", batchId: "b1", sequence: 1, cursorFrom: null, cursorTo: "next", body: "page" };
  queue.enqueue(page);
  expect(() => queue.enqueue({ ...page, batchId: "b2", sequence: 2 })).toThrow("pending_batch");
  queue.ack("b1", 1);
  expect(() => queue.enqueue({ ...page, batchId: "b2", sequence: 2 })).toThrow("cursor_conflict");
  expect(() => queue.enqueue({ ...page, batchId: "b2", sequence: 2, cursorFrom: "next", body: "x".repeat(33) })).toThrow("queue_full");
  queue.close();
});

it("keeps the checkpoint unchanged when SQLite runs out of pages and rejects replayed cursors", () => {
  const options = setup(1024 * 1024);
  const queue = new AgentQueue(options);
  const database = (queue as unknown as { db: Database.Database }).db;
  const pages = database.pragma("page_count", { simple: true }) as number;
  database.pragma(`max_page_count = ${pages}`);
  expect(() => queue.enqueue({ sourceId: "plm", batchId: "full", sequence: 1, cursorFrom: null, cursorTo: "next", body: "x".repeat(100_000) })).toThrow();
  expect(queue.checkpoint("plm")).toBeNull();
  expect(queue.pending("plm")).toBeNull();
  database.pragma(`max_page_count = ${pages + 1024}`);
  queue.enqueue({ sourceId: "plm", batchId: "first", sequence: 1, cursorFrom: null, cursorTo: "next", body: "page" });
  queue.ack("first", 1);
  expect(() => queue.ack("first", 1)).not.toThrow();
  expect(() => queue.ack("unknown", 1)).toThrow("unknown_batch_ack");
  expect(() => queue.enqueue({ sourceId: "plm", batchId: "replay", sequence: 2, cursorFrom: "next", cursorTo: "next", body: "page" })).toThrow("cursor_replayed");
  queue.enqueue({ sourceId: "plm", batchId: "second", sequence: 2, cursorFrom: "next", cursorTo: "later", body: "page" });
  expect(queue.pending("plm")?.cursorFrom).toBe("next");
  queue.ack("second", 2);
  expect(queue.checkpoint("plm")).toBe("later");
  database.prepare("UPDATE source_state SET checkpoint = 'plaintext' WHERE source_id = 'plm'").run();
  expect(() => queue.checkpoint("plm")).toThrow("invalid_encrypted_cursor");
  queue.close();
});
