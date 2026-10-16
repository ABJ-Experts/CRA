/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/prefer-promise-reject-errors, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { createHash } from "node:crypto";
import fs from "node:fs";
import { finished } from "node:stream/promises";
import yauzl from "yauzl";

import {
  AuditExportWorker,
  auditExportContentHash,
} from "./audit-export-worker";
import type { AuditExportEvent, AuditExportJob } from "./audit-export-types";

const organizationId = "33333333-3333-4333-8333-333333333333";
const jobId = "44444444-4444-4444-8444-444444444444";
const previousHash = "00".repeat(32);
const eventId = "11111111-1111-4111-8111-111111111111";

const job: AuditExportJob = Object.freeze({
  id: jobId,
  organizationId,
  actorUserId: "55555555-5555-4555-8555-555555555555",
  leaseOwner: "worker-1",
  checkpointVersion: 1,
  format: "json",
  filters: { from: "2026-10-01T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z" },
  scopeDigest: "11".repeat(32),
  selectedIds: [eventId],
});
const event: AuditExportEvent = Object.freeze({
  id: eventId,
  sequence: "7",
  previousHash,
  contentHash: auditExportContentHash(previousHash, "canonical"),
  canonicalContent: "canonical",
  recomputedCanonicalContent: "canonical",
  canonicalDisclosable: true,
  legacy: false,
  createdAt: "2026-10-07T00:00:00.000Z",
  actorId: "actor",
  actorType: "user",
  actorLabel: "Actor",
  action: "audit.read",
  resourceType: "audit_log",
  resourceId: "row",
  correlationId: null,
  outcome: "success",
  before: null,
  after: { typed: 1 },
  reason: null,
});

describe("AuditExportWorker", () => {
  it("writes a ready archive from claimed selected rows", async () => {
    const completed: unknown[] = [];
    const uploaded: Buffer[] = [];
    const worker = new AuditExportWorker({
      workerId: "worker-1",
      now: () => new Date("2026-10-07T00:00:00.000Z"),
      repository: {
        claim: async () => job,
        events: async (_job, offset) => (offset === 0 ? [event] : []),
        heartbeat: async (claimedJob) => claimedJob,
        complete: async (command) => {
          completed.push(command);
          return "completed";
        },
        fail: async (command) => {
          throw new Error(`unexpected fail ${command.code}`);
        },
      },
      storage: {
        upload: async (input) => {
          const chunks: Buffer[] = [];
          for await (const chunk of input.stream)
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          uploaded.push(Buffer.concat(chunks));
          return { outcome: "stored" };
        },
        verify: async () => ({ outcome: "verified" }),
      },
    });
    await expect(worker.runOnce()).resolves.toBe("processed");
    expect(completed).toHaveLength(1);
    expect(
      (completed[0] as { artifact: { manifest: { proofCount: number } } })
        .artifact.manifest.proofCount,
    ).toBe(1);
    await expect(
      readZipEntry(uploaded[0]!, "proofs.ndjson"),
    ).resolves.toContain(eventId);
  });

  it("fails closed when selected rows drift before delivery", async () => {
    const failures: string[] = [];
    const worker = new AuditExportWorker({
      workerId: "worker-1",
      repository: {
        claim: async () => job,
        events: async () => [
          { ...event, id: "22222222-2222-4222-8222-222222222222" },
        ],
        heartbeat: async (claimedJob) => claimedJob,
        complete: async () => {
          throw new Error("must not complete");
        },
        fail: async (command) => {
          failures.push(command.code);
        },
      },
      storage: {
        upload: async () => ({ outcome: "stored" }),
        verify: async () => ({ outcome: "verified" }),
      },
    });
    await expect(worker.runOnce()).resolves.toBe("processed");
    expect(failures).toEqual(["access_changed"]);
  });

  it("settles every file writer before cleaning up a failed selection", async () => {
    const original = fs.createWriteStream;
    const streams: fs.WriteStream[] = [];
    const spy = jest
      .spyOn(fs, "createWriteStream")
      .mockImplementation((path, options) => {
        const stream = original(path, options);
        streams.push(stream);
        return stream;
      });
    const closedAtFailure: boolean[][] = [];
    const failures: string[] = [];
    try {
      const worker = new AuditExportWorker({
        repository: {
          claim: async () => job,
          events: async () => [],
          heartbeat: async (value) => value,
          complete: async () => "completed",
          fail: async (command) => {
            failures.push(command.code);
            closedAtFailure.push(streams.map((stream) => stream.closed));
          },
        },
        storage: {
          upload: async () => ({ outcome: "stored" }),
          verify: async () => ({ outcome: "verified" }),
        },
      });
      await worker.runOnce();
      expect(streams).toHaveLength(2);
      expect(closedAtFailure).toEqual([[true, true]]);
      expect(failures).toEqual(["access_changed"]);
    } finally {
      spy.mockRestore();
      await Promise.all(
        streams.map(async (stream) => {
          stream.destroy();
          await finished(stream).catch(() => undefined);
        }),
      );
    }
  });

  it("rejects I/O errors while waiting for writer backpressure", async () => {
    const original = fs.createWriteStream;
    const streams: fs.WriteStream[] = [];
    const failures: string[] = [];
    const spy = jest
      .spyOn(fs, "createWriteStream")
      .mockImplementation((path, options) => {
        const stream = original(path, options);
        streams.push(stream);
        if (streams.length === 1) {
          const write = stream.write.bind(stream);
          jest.spyOn(stream, "write").mockImplementation((chunk) => {
            write(chunk);
            queueMicrotask(() =>
              stream.destroy(new Error("owned disk failure")),
            );
            return false;
          });
        }
        return stream;
      });
    let running: Promise<unknown> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const worker = new AuditExportWorker({
        repository: {
          claim: async () => job,
          events: async () => [event],
          heartbeat: async (value) => value,
          complete: async () => "completed",
          fail: async (command) => {
            failures.push(command.code);
          },
        },
        storage: {
          upload: async () => ({ outcome: "stored" }),
          verify: async () => ({ outcome: "verified" }),
        },
      });
      running = worker.runOnce();
      const result = await Promise.race([
        running,
        new Promise((resolve) => {
          timeout = setTimeout(() => resolve("hung"), 500);
        }),
      ]);
      expect(result).toBe("processed");
      expect(failures).toEqual(["generation_failed"]);
      expect(streams.every((stream) => stream.closed)).toBe(true);
    } finally {
      if (timeout) clearTimeout(timeout);
      spy.mockRestore();
      for (const stream of streams) {
        stream.emit("drain");
        stream.destroy();
      }
      const release = setInterval(() => {
        for (const stream of streams) stream.emit("drain");
      }, 5);
      try {
        await running;
      } finally {
        clearInterval(release);
      }
    }
  });

  it("settles archive reader when storage rejects before consuming it", async () => {
    const original = fs.createReadStream;
    const readers: fs.ReadStream[] = [];
    const failures: string[] = [];
    const closed: boolean[] = [];
    const spy = jest
      .spyOn(fs, "createReadStream")
      .mockImplementation((path, options) => {
        const stream = original(path, options);
        if (String(path).endsWith("audit-export.zip")) readers.push(stream);
        return stream;
      });
    try {
      const worker = new AuditExportWorker({
        repository: {
          claim: async () => job,
          events: async () => [event],
          heartbeat: async (value) => value,
          complete: async () => "completed",
          fail: async (command) => {
            failures.push(command.code);
            closed.push(...readers.map((reader) => reader.closed));
          },
        },
        storage: {
          upload: async () => ({ outcome: "unavailable" }),
          verify: async () => ({ outcome: "verified" }),
        },
      });
      await worker.runOnce();
      expect(readers).toHaveLength(1);
      expect(closed).toEqual([true]);
      expect(failures).toEqual(["storage_unavailable"]);
    } finally {
      spy.mockRestore();
      await Promise.all(
        readers.map(async (reader) => {
          reader.destroy();
          await finished(reader).catch(() => undefined);
        }),
      );
    }
  });

  it("fails integrity breaks before uploading", async () => {
    const failures: string[] = [];
    let uploads = 0;
    const worker = new AuditExportWorker({
      repository: {
        claim: async () => job,
        events: async () => [
          {
            ...event,
            contentHash: createHash("sha256").update("canonical").digest("hex"),
          },
        ],
        heartbeat: async (claimedJob) => claimedJob,
        complete: async () => "completed",
        fail: async (command) => {
          failures.push(command.code);
        },
      },
      storage: {
        upload: async () => {
          uploads += 1;
          return { outcome: "stored" };
        },
        verify: async () => ({ outcome: "verified" }),
      },
    });
    await expect(worker.runOnce()).resolves.toBe("processed");
    expect(uploads).toBe(0);
    expect(failures).toEqual(["integrity_break"]);
  });

  it("reuses an already-existing object only after hash verification", async () => {
    let verified = false;
    const worker = new AuditExportWorker({
      workerId: "worker-1",
      repository: {
        claim: async () => job,
        events: async () => [event],
        heartbeat: async (claimedJob) => claimedJob,
        complete: async () => "completed",
        fail: async (command) => {
          throw new Error(`unexpected fail ${command.code}`);
        },
      },
      storage: {
        upload: async () => ({ outcome: "already_exists" }),
        verify: async () => {
          verified = true;
          return { outcome: "verified" };
        },
      },
    });
    await expect(worker.runOnce()).resolves.toBe("processed");
    expect(verified).toBe(true);
  });

  it("fails retryably when an existing object does not verify", async () => {
    const failures: string[] = [];
    const worker = new AuditExportWorker({
      workerId: "worker-1",
      repository: {
        claim: async () => job,
        events: async () => [event],
        heartbeat: async (claimedJob) => claimedJob,
        complete: async () => "completed",
        fail: async (command) => {
          failures.push(`${command.code}:${command.retryable}`);
        },
      },
      storage: {
        upload: async () => ({ outcome: "already_exists" }),
        verify: async () => ({ outcome: "corrupt" }),
      },
    });
    await expect(worker.runOnce()).resolves.toBe("processed");
    expect(failures).toEqual(["storage_unavailable:true"]);
  });

  it("records failure against the latest heartbeat version", async () => {
    const selectedIds = Array.from({ length: 251 }, (_, index) =>
      index === 250
        ? eventId
        : `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
    );
    const heartbeats: number[] = [];
    const failedVersions: number[] = [];
    const first = selectedIds
      .slice(0, 250)
      .map((id, index) => ({ ...event, id, sequence: String(300 - index) }));
    const worker = new AuditExportWorker({
      workerId: "worker-1",
      repository: {
        claim: async () => ({ ...job, selectedIds }),
        events: async (_job, offset) =>
          offset === 0
            ? first
            : [{ ...event, id: eventId, contentHash: "11".repeat(32) }],
        heartbeat: async (claimedJob) => {
          heartbeats.push(claimedJob.checkpointVersion);
          return {
            ...claimedJob,
            checkpointVersion: claimedJob.checkpointVersion + 1,
          };
        },
        complete: async () => "completed",
        fail: async (command) => {
          failedVersions.push(command.job.checkpointVersion);
        },
      },
      storage: {
        upload: async () => ({ outcome: "stored" }),
        verify: async () => ({ outcome: "verified" }),
      },
    });
    await expect(worker.runOnce()).resolves.toBe("processed");
    expect(heartbeats.length).toBeGreaterThan(0);
    expect(failedVersions[0]).toBeGreaterThan(job.checkpointVersion);
  });

  it("returns idle without touching storage when no job is claimed", async () => {
    const worker = new AuditExportWorker({
      repository: {
        claim: async () => null,
        events: async () => [],
        heartbeat: async (claimedJob) => claimedJob,
        complete: async () => "completed",
        fail: async () => undefined,
      },
      storage: {
        upload: async () => {
          throw new Error("no upload");
        },
        verify: async () => ({ outcome: "verified" }),
      },
    });
    await expect(worker.runOnce()).resolves.toBe("idle");
  });

  it("fails export_limit before querying rows when selected ids exceed the cap", async () => {
    const failures: string[] = [];
    const worker = new AuditExportWorker({
      repository: {
        claim: async () => ({
          ...job,
          selectedIds: Array.from(
            { length: 100001 },
            (_, index) =>
              `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
          ),
        }),
        events: async () => {
          throw new Error("no rows");
        },
        heartbeat: async (claimedJob) => claimedJob,
        complete: async () => "completed",
        fail: async (command) => {
          failures.push(command.code);
        },
      },
      storage: {
        upload: async () => ({ outcome: "stored" }),
        verify: async () => ({ outcome: "verified" }),
      },
    });
    await expect(worker.runOnce()).resolves.toBe("processed");
    expect(failures).toEqual(["export_limit"]);
  });

  it("fails retryably when storage upload is unavailable", async () => {
    const failures: string[] = [];
    const worker = new AuditExportWorker({
      repository: {
        claim: async () => job,
        events: async () => [event],
        heartbeat: async (claimedJob) => claimedJob,
        complete: async () => "completed",
        fail: async (command) => {
          failures.push(`${command.code}:${command.retryable}`);
        },
      },
      storage: {
        upload: async () => ({ outcome: "unavailable" }),
        verify: async () => ({ outcome: "verified" }),
      },
    });
    await expect(worker.runOnce()).resolves.toBe("processed");
    expect(failures).toEqual(["storage_unavailable:true"]);
  });

  it("fails terminally when disclosed canonical bytes differ from recomputed bytes", async () => {
    const failures: string[] = [];
    const worker = new AuditExportWorker({
      repository: {
        claim: async () => job,
        events: async () => [
          {
            ...event,
            canonicalContent: "public",
            recomputedCanonicalContent: "private",
            contentHash: auditExportContentHash(previousHash, "private"),
          },
        ],
        heartbeat: async (claimedJob) => claimedJob,
        complete: async () => "completed",
        fail: async (command) => {
          failures.push(command.code);
        },
      },
      storage: {
        upload: async () => ({ outcome: "stored" }),
        verify: async () => ({ outcome: "verified" }),
      },
    });
    await expect(worker.runOnce()).resolves.toBe("processed");
    expect(failures).toEqual(["integrity_break"]);
  });

  it("exports CSV legacy rows without proofs", async () => {
    const completed: unknown[] = [];
    const uploaded: Buffer[] = [];
    const legacy = {
      ...event,
      sequence: null,
      previousHash: null,
      contentHash: null,
      canonicalContent: null,
      recomputedCanonicalContent: null,
      canonicalDisclosable: false,
      legacy: true,
      actorLabel: "\u00a0=formula",
      action: "\ufeff@audit.read",
      resourceType: "\u0085+audit_log",
      resourceId: "@row",
    };
    const worker = new AuditExportWorker({
      repository: {
        claim: async () => ({ ...job, format: "csv", selectedIds: [eventId] }),
        events: async () => [legacy],
        heartbeat: async (claimedJob) => claimedJob,
        complete: async (command) => {
          completed.push(command);
          return "completed";
        },
        fail: async (command) => {
          throw new Error(`unexpected fail ${command.code}`);
        },
      },
      storage: {
        upload: async (input) => {
          const chunks: Buffer[] = [];
          for await (const chunk of input.stream)
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          uploaded.push(Buffer.concat(chunks));
          return { outcome: "stored" };
        },
        verify: async () => ({ outcome: "verified" }),
      },
    });
    await expect(worker.runOnce()).resolves.toBe("processed");
    expect(
      (
        completed[0] as {
          artifact: {
            manifest: {
              legacyCount: number;
              proofCount: number;
              sequenceRange: { from: string | null; to: string | null };
            };
          };
        }
      ).artifact.manifest,
    ).toMatchObject({
      legacyCount: 1,
      proofCount: 0,
      sequenceRange: { from: null, to: null },
    });
    const csv = await readZipEntry(uploaded[0]!, "events.csv");
    expect(csv).toContain('"\'\u00a0=formula"');
    expect(csv).toContain('"\'\ufeff@audit.read"');
    expect(csv).toContain('"\'\u0085+audit_log"');
    expect(csv).toContain('"\'@row"');
  });

  it("fails when completion conflicts after archive upload", async () => {
    const failures: string[] = [];
    const worker = new AuditExportWorker({
      repository: {
        claim: async () => job,
        events: async () => [event],
        heartbeat: async (claimedJob) => claimedJob,
        complete: async () => "conflict",
        fail: async (command) => {
          failures.push(`${command.code}:${command.retryable}`);
        },
      },
      storage: {
        upload: async () => ({ outcome: "stored" }),
        verify: async () => ({ outcome: "verified" }),
      },
    });
    await expect(worker.runOnce()).resolves.toBe("processed");
    expect(failures).toEqual(["generation_failed:false"]);
  });
});

function readZipEntry(bytes: Buffer, name: string): Promise<string> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (openError, zip) => {
      if (openError || !zip) return reject(openError);
      zip.readEntry();
      zip.on("entry", (entry) => {
        if (entry.fileName !== name) return zip.readEntry();
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return reject(streamError);
          const chunks: Buffer[] = [];
          stream.on("data", (chunk) =>
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
          );
          stream.on("end", () =>
            resolve(Buffer.concat(chunks).toString("utf8")),
          );
        });
      });
      zip.on("end", () => reject(new Error("missing entry")));
      zip.on("error", reject);
    });
  });
}
