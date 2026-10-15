import {
  NativeWalSupervisor,
  validateWalJournal,
  WAL_SEGMENT_BYTES,
} from "./native-wal-supervisor";

const part = (name: string) => ({
  id: "11111111-1111-4111-8111-111111111111",
  kind: "wal" as const,
  name,
  sha256: "a".repeat(64),
  bytes: WAL_SEGMENT_BYTES,
  cipherSha256: "b".repeat(64),
  cipherBytes: WAL_SEGMENT_BYTES + 100,
});
const journal = {
  version: 1,
  instanceId: "11111111-1111-4111-8111-111111111111",
  sourceSystemIdentifier: "123456789",
  timeline: 1,
  repositoryGeneration: "22222222-2222-4222-8222-222222222222",
  keyId: "backup-key",
  sourceAlias: "source",
  parts: [part("000000010000000000000001")],
};
describe("continuous encrypted WAL authority", () => {
  it("exports the native supervisor lifecycle", () =>
    expect(NativeWalSupervisor).toBeDefined());
  it("accepts contiguous authenticated part descriptors", () =>
    expect(validateWalJournal(journal)).toEqual(journal));
  it.each([
    { ...journal, parts: [part("../../secret")] },
    { ...journal, sourceSystemIdentifier: "secret" },
    {
      ...journal,
      parts: [
        part("000000010000000000000001"),
        part("000000010000000000000003"),
      ],
    },
    { ...journal, parts: [part("000000020000000000000001")] },
    { ...journal, parts: [{ ...part("000000010000000000000001"), bytes: 1 }] },
    { ...journal, repositoryGeneration: "../repo" },
    { ...journal, keys: "secret" },
  ])("rejects unsafe, incomplete or discontinuous archives", (input) => {
    expect(() => validateWalJournal(input)).toThrow();
  });
  it("accepts only bounded versioned window links with continuous overlapping WAL", () => {
    const previousWindow = {
      part: {
        ...part("wal-journal.json"),
        kind: "inventory",
        bytes: 1024,
        cipherBytes: 1124,
      },
      endSegment: "000000010000000000000001",
    };
    expect(
      validateWalJournal({ ...journal, version: 2, previousWindow }).version,
    ).toBe(2);
    for (const input of [
      { ...journal, version: 2 },
      { ...journal, previousWindow },
      { ...journal, version: 2, previousWindow, parts: [] },
      {
        ...journal,
        version: 2,
        previousWindow: {
          ...previousWindow,
          endSegment: "000000020000000000000001",
        },
      },
      {
        ...journal,
        version: 2,
        previousWindow,
        parts: [part("000000010000000000000003")],
      },
      {
        ...journal,
        version: 2,
        previousWindow: {
          ...previousWindow,
          endSegment: "000000010000000000000003",
        },
      },
      { ...journal, parts: [...journal.parts, ...journal.parts] },
    ])
      expect(() => validateWalJournal(input)).toThrow("wal_gap");
  });
});

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { Readable } from "node:stream";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  chmod,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import * as mountsModule from "./backup-mounted-runtime";
import type {
  BackupMountedRuntime,
  ResolvedBackupMounts,
} from "./backup-mounted-runtime";
import { NativeBackupProcess } from "./native-backup-process";
import type {
  BackupCaptureRequest,
  BackupEncryptedPart,
} from "../../application/backup-execution.port";

class FakeProcess extends NativeBackupProcess {
  slot = false;
  segment = 0;
  timeline = 1;
  system = "123456789";
  segmentBytes = WAL_SEGMENT_BYTES;
  lockAllowed = true;
  lockClosed = false;
  children: ChildProcessWithoutNullStreams[] = [];
  prior = false;
  foreign = false;
  failRun = false;
  failCat = false;
  available: string[] | undefined;
  requireInitialSeed = false;
  seeded = false;
  seedSystem: string | undefined;
  freshRestartLsn: string | null = "0/1000000";
  events: string[] = [];
  advanceCheck: () => Promise<void> = () => Promise.resolve();
  override start(
    _binary: string,
    args: readonly string[],
  ): ChildProcessWithoutNullStreams {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: () => {
        child.emit("close", 0);
        return true;
      },
    });
    if (args.includes("pg_receivewal")) {
      if (this.requireInitialSeed && !this.seeded)
        throw Error("receiver_started_without_restart_seed");
      this.events.push("receiver_started");
      this.children.push(child as unknown as ChildProcessWithoutNullStreams);
    }
    if (args.includes("psql"))
      child.stdin.once("data", () =>
        setImmediate(() =>
          this.lockClosed
            ? child.emit("close", 1)
            : child.stdout.write(this.lockAllowed ? "t\n" : "f\n"),
        ),
      );
    if (args.includes("cat") && !args.includes("sh"))
      setImmediate(() => {
        child.stdout.end(Buffer.from("wal"));
        child.emit("close", this.failCat ? 1 : 0);
      });
    if (args.includes("sh"))
      child.stdin.once("finish", () =>
        setImmediate(() => child.emit("close", 0)),
      );
    return child as unknown as ChildProcessWithoutNullStreams;
  }
  override wait(child: ChildProcessWithoutNullStreams): Promise<number> {
    return new Promise((resolve) =>
      child.once("close", (code) => resolve(code ?? -1)),
    );
  }
  override async run(
    _binary: string,
    args: readonly string[],
  ): Promise<string> {
    const query = args.at(-1) ?? "";
    if (query.includes("restartLsn"))
      return JSON.stringify({
        systemIdentifier: this.seedSystem ?? this.system,
        timeline: this.timeline,
        restartLsn: this.freshRestartLsn,
      });
    if (query.includes("segmentBytes"))
      return JSON.stringify({
        systemIdentifier: this.system,
        timeline: this.timeline,
        segmentBytes: this.segmentBytes,
      });
    if (query.includes("pg_replication_slots"))
      return this.slot
        ? JSON.stringify({ type: "physical", lsn: "0/1000000" })
        : "null";
    if (query.includes("pg_create_physical")) {
      this.slot = true;
      this.events.push("slot_created");
      return "";
    }
    if (query.includes("pg_replication_slot_advance")) {
      await this.advanceCheck();
      this.events.push("advanced");
      return "";
    }
    if (query.includes("pg_switch_wal")) {
      this.segment++;
      return JSON.stringify({
        systemIdentifier: this.system,
        timeline: this.timeline,
        segment: this.name(),
      });
    }
    if (query.includes("pg_walfile_name(")) return "000000010000000000000001";
    if (args.includes("touch")) {
      this.seeded = true;
      this.events.push("partial_seeded");
    }
    if (args.includes("find"))
      return this.available
        ? this.available.map((name) => `/stage/wal/${name}`).join("\n")
        : this.segment
          ? `/stage/wal/${this.name()}`
          : "";
    if (args.includes("ps")) return this.prior ? "task-owned-container" : "";
    if (args.includes("inspect"))
      return JSON.stringify({
        "cra.backup.wal.instance": this.foreign
          ? "foreign"
          : request.instanceId,
        "cra.backup.wal.generation": request.repositoryGeneration,
      });
    if (args.includes("run") && this.failRun)
      throw new Error("native_tool_failed");
    return "";
  }
  name() {
    return `00000001${Math.floor(this.segment / 256)
      .toString(16)
      .toUpperCase()
      .padStart(
        8,
        "0",
      )}${(this.segment % 256).toString(16).toUpperCase().padStart(8, "0")}`;
  }
}
const request: BackupCaptureRequest = {
  runId: "11111111-1111-4111-8111-111111111111",
  instanceId: "11111111-1111-4111-8111-111111111111",
  configurationRevision: 1,
  repositoryGeneration: "22222222-2222-4222-8222-222222222222",
  sourceAlias: "source",
  repositoryAlias: "off-host",
  stagingAlias: "private-ram",
  keyAlias: "backup-key",
  keyId: "backup-key",
  pauseLimitSeconds: 120,
};
describe("WAL receiver lifecycle and durable retention", () => {
  let directory: string;
  let process: FakeProcess;
  let supervisor: NativeWalSupervisor;
  let resolved: ResolvedBackupMounts;
  let data: Map<string, Buffer>;
  let sealFailure = false;
  let held: NativeWalSupervisor[];
  const pointer = () =>
    join(directory, "repo", "wal", `${request.instanceId}.json`);
  const factory = () => ({
    sealPart: jest.fn(
      async (
        _run: string,
        kind: "wal" | "inventory",
        name: string,
        input: NodeJS.ReadableStream,
      ) => {
        if (sealFailure && kind === "wal") throw new Error("encryption_failed");
        const chunks: Buffer[] = [];
        for await (const chunk of input)
          chunks.push(Buffer.from(chunk as Uint8Array));
        const body = Buffer.concat(chunks);
        const id = randomUUID();
        data.set(id, body);
        process.events.push(kind === "wal" ? "encrypted" : "journal_durable");
        return {
          id,
          kind,
          name,
          sha256: "a".repeat(64),
          cipherSha256: "b".repeat(64),
          bytes: kind === "wal" ? WAL_SEGMENT_BYTES : body.length,
          cipherBytes:
            kind === "wal" ? WAL_SEGMENT_BYTES + 100 : body.length + 100,
        };
      },
    ),
    openPartToSink: jest.fn(
      (part: BackupEncryptedPart, sink: NodeJS.WritableStream) => {
        sink.end(data.get(part.id) ?? Buffer.from("wal"));
        return Promise.resolve();
      },
    ),
  });
  const seedFullWindow = async () => {
    const parts = Array.from({ length: 4096 }, (_, index) => {
      process.segment = index + 1;
      return { ...part(process.name()), id: randomUUID() };
    });
    const value = { ...journal, parts };
    const descriptor = await factory().sealPart(
      request.instanceId,
      "inventory",
      "wal-journal.json",
      Readable.from([JSON.stringify(value)]),
    );
    await mkdir(join(directory, "repo", "wal"), { mode: 0o700 });
    await writeFile(pointer(), JSON.stringify(descriptor), { mode: 0o600 });
    process.slot = true;
    return descriptor;
  };
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "m15-wal-test-"));
    await mkdir(join(directory, "repo"), { mode: 0o700 });
    process = new FakeProcess();
    data = new Map();
    sealFailure = false;
    held = [];
    resolved = {
      source: {
        databaseContainer: "source",
        databaseName: "postgres",
        databaseUser: "postgres",
        network: "task",
        host: "source",
        port: 5432,
        postgresImage: "supabase/postgres:17.6.1.156",
        pgpassFile: join(directory, "pass"),
        storageContainer: "storage",
        storageRoot: "/mnt",
        storageTenantPrefix: "stub",
      },
      repository: {
        path: join(directory, "repo"),
        generation: request.repositoryGeneration,
        residency: "local",
        offHost: true,
      },
      staging: { kind: "tmpfs", maximumBytes: 64 * 1024 * 1024 },
      key: { path: join(directory, "key"), keyId: "backup-key" },
    };
    jest.spyOn(mountsModule, "resolveBackupMounts").mockResolvedValue(resolved);
    supervisor = new NativeWalSupervisor(
      { gpgBinary: "gpg" } as BackupMountedRuntime,
      process,
      factory,
    );
    held.push(supervisor);
  });
  afterEach(async () => {
    for (const s of held) await s.stop();
    jest.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });
  it("retains WAL until encrypted bytes AND externally durable journal exist", async () => {
    process.advanceCheck = async () => {
      const p = JSON.parse(await readFile(pointer(), "utf8")) as { id: string };
      const j = JSON.parse(data.get(p.id)!.toString()) as { parts: unknown[] };
      expect(j.parts).toHaveLength(1);
    };
    const handle = await supervisor.start(request);
    expect(await supervisor.start(request)).toBe(handle);
    expect(handle.snapshot()).toEqual([]);
    const parts = await handle.checkpoint();
    expect(parts).toHaveLength(1);
    expect(process.events.indexOf("advanced")).toBeGreaterThan(
      process.events.lastIndexOf("journal_durable"),
    );
    await handle.stop();
    await handle.stop();
  });
  it("seeds the fresh hold-slot restart segment before receiver connection and immediate checkpoint", async () => {
    process.requireInitialSeed = true;
    const handle = await supervisor.start(request);
    expect(process.events.indexOf("journal_durable")).toBeLessThan(
      process.events.indexOf("slot_created"),
    );
    expect(process.events.indexOf("slot_created")).toBeLessThan(
      process.events.indexOf("partial_seeded"),
    );
    expect(process.events.indexOf("partial_seeded")).toBeLessThan(
      process.events.indexOf("receiver_started"),
    );
    const sealed = await handle.checkpoint();
    expect(sealed.map((part) => part.name)).toEqual([
      "000000010000000000000001",
    ]);
    expect(sealed.some((part) => part.name.endsWith(".partial"))).toBe(false);
  });
  it.each(["source-changed", "missing-lsn", "invalid-lsn"])(
    "preserves the source hold and fails closed when fresh seed authority is %s",
    async (failure) => {
      if (failure === "source-changed") process.seedSystem = "987654321";
      else
        process.freshRestartLsn =
          failure === "missing-lsn" ? null : "unsafe';drop";
      await expect(supervisor.start(request)).rejects.toThrow(
        failure === "source-changed"
          ? "source_identity_changed"
          : "repository_discontinuity",
      );
      expect(process.slot).toBe(true);
      expect(process.children).toHaveLength(0);
      expect(process.events).not.toContain("advanced");
      expect(process.events).not.toContain("partial_seeded");
    },
  );
  it("resumes authenticated sealed segments and keeps the same source pin", async () => {
    const first = await supervisor.start(request);
    await first.checkpoint();
    await supervisor.stop();
    const second = await supervisor.start(request);
    expect(second.snapshot()).toHaveLength(1);
    expect(await second.checkpoint()).toHaveLength(2);
  });
  it("rolls a full window into authenticated immutable history and resumes past 4096 segments", async () => {
    const oldPointer = await seedFullWindow();
    const handle = await supervisor.start(request);
    expect(handle.snapshot()).toHaveLength(4096);
    const next = await handle.checkpoint();
    expect(next).toHaveLength(2049);
    const currentPointer = JSON.parse(
      await readFile(pointer(), "utf8"),
    ) as BackupEncryptedPart;
    const current = JSON.parse(data.get(currentPointer.id)!.toString()) as {
      version: number;
      previousWindow: { part: BackupEncryptedPart; endSegment: string };
      parts: unknown[];
    };
    expect(current.version).toBe(2);
    expect(current.previousWindow.part.id).not.toBe(currentPointer.id);
    expect(data.has(oldPointer.id)).toBe(true);
    expect(data.has(current.previousWindow.part.id)).toBe(true);
    await supervisor.stop();
    const restarted = await supervisor.start(request);
    expect(restarted.snapshot()).toHaveLength(2049);
    expect(await restarted.checkpoint()).toHaveLength(2050);
  });
  it.each(["before", "after"])(
    "does not advance source hold when acknowledgement fails %s durable rollover publication",
    async (boundary) => {
      const oldPointer = await seedFullWindow();
      const handle = await supervisor.start(request);
      const internals = supervisor as unknown as {
        writePointer(pointer: string, part: BackupEncryptedPart): Promise<void>;
      };
      const original = internals.writePointer.bind(supervisor);
      const writer = jest
        .spyOn(internals, "writePointer")
        .mockImplementationOnce(async (path, part) => {
          if (boundary === "after") await original(path, part);
          throw Error("publication_failed");
        });
      await expect(handle.checkpoint()).rejects.toThrow("publication_failed");
      expect(process.events).not.toContain("advanced");
      const current: unknown = JSON.parse(await readFile(pointer(), "utf8"));
      if (boundary === "before") expect(current).toEqual(oldPointer);
      else expect(current).not.toEqual(oldPointer);
      writer.mockRestore();
      await supervisor.stop();
      const firstPending = process.name();
      process.segment++;
      process.available = [firstPending, process.name()];
      process.segment--;
      const restarted = await supervisor.start(request);
      expect(await restarted.checkpoint()).toHaveLength(2050);
      expect(process.events).toContain("advanced");
    },
  );
  it.each(["missing", "corrupt", "binding", "overlap", "endpoint"])(
    "fails closed on %s predecessor authority after rollover",
    async (failure) => {
      await seedFullWindow();
      const handle = await supervisor.start(request);
      await handle.checkpoint();
      await supervisor.stop();
      const descriptor = JSON.parse(
        await readFile(pointer(), "utf8"),
      ) as BackupEncryptedPart;
      const current = JSON.parse(data.get(descriptor.id)!.toString()) as {
        previousWindow: { part: BackupEncryptedPart };
      };
      const previousId = current.previousWindow.part.id;
      if (failure === "missing") data.delete(previousId);
      else if (failure === "corrupt") data.set(previousId, Buffer.from("bad"));
      else {
        const old = JSON.parse(
          data.get(previousId)!.toString(),
        ) as typeof journal;
        const changed =
          failure === "binding"
            ? { ...old, sourceSystemIdentifier: "999999" }
            : failure === "overlap"
              ? {
                  ...old,
                  parts: old.parts.map((p) => ({ ...p, id: randomUUID() })),
                }
              : { ...old, parts: [] };
        data.set(previousId, Buffer.from(JSON.stringify(changed)));
      }
      process.events = [];
      await expect(supervisor.start(request)).rejects.toThrow();
      expect(process.events).not.toContain("advanced");
    },
  );
  it("keeps historical window keys and refuses checkpoint targets evicted from the bounded window", async () => {
    await seedFullWindow();
    const handle = await supervisor.start(request);
    await handle.checkpoint();
    await expect(handle.checkpoint("000000010000000000000001")).rejects.toThrow(
      "wal_gap",
    );
    const pointerPart = JSON.parse(
      await readFile(pointer(), "utf8"),
    ) as BackupEncryptedPart;
    const content = JSON.parse(data.get(pointerPart.id)!.toString()) as {
      previousWindow: { part: BackupEncryptedPart };
    };
    expect(content.previousWindow.part.keyId).toBe("backup-key");
    await supervisor.stop();
    const next = new NativeWalSupervisor(
      {
        gpgBinary: "gpg",
        keys: {
          old: { path: "/old", keyId: "backup-key" },
          next: { path: "/next", keyId: "next-key" },
        },
      } as unknown as BackupMountedRuntime,
      process,
      factory,
    );
    held.push(next);
    const rotated = await next.start({
      ...request,
      keyId: "next-key",
      keyAlias: "next",
    });
    expect(rotated.snapshot()[0]?.keyId).toBe("backup-key");
    const pending = process.name();
    process.segment++;
    process.available = [pending, process.name()];
    process.segment--;
    expect(await rotated.checkpoint()).toHaveLength(2051);
  });
  it("restarts an empty authenticated journal from retained restart_lsn", async () => {
    await supervisor.start(request);
    await supervisor.stop();
    const resumed = await supervisor.start(request);
    expect(resumed.snapshot()).toEqual([]);
    expect(await resumed.checkpoint()).toHaveLength(1);
  });
  it("does not advance the retention slot after encryption failure", async () => {
    const handle = await supervisor.start(request);
    sealFailure = true;
    await expect(handle.checkpoint()).rejects.toThrow("encryption_failed");
    expect(process.events).not.toContain("advanced");
  });
  it("rejects cross-instance configuration changes while a daemon owns the stream", async () => {
    await supervisor.start(request);
    await expect(
      supervisor.start({ ...request, keyId: "rotated" }),
    ).rejects.toThrow("configuration_changed");
  });
  it("refuses unsupported segment size and missing repository continuity", async () => {
    process.segmentBytes = 1;
    await expect(supervisor.start(request)).rejects.toThrow(
      "incompatible_runtime",
    );
    process.segmentBytes = WAL_SEGMENT_BYTES;
    process.slot = true;
    await expect(supervisor.start(request)).rejects.toThrow(
      "repository_discontinuity",
    );
  });
  it("refuses source identity changes after restart", async () => {
    await supervisor.start(request);
    await supervisor.stop();
    process.system = "987654321";
    await expect(supervisor.start(request)).rejects.toThrow(
      "source_identity_changed",
    );
  });
  it("refuses lost hold slots even when local ciphertext still exists", async () => {
    const handle = await supervisor.start(request);
    await handle.checkpoint();
    await supervisor.stop();
    process.slot = false;
    await expect(supervisor.start(request)).rejects.toThrow(
      "repository_discontinuity",
    );
  });
  it("rejects competing daemons without deleting their tool container", async () => {
    process.lockAllowed = false;
    await expect(supervisor.start(request)).rejects.toThrow("lease_lost");
  });
  it("removes only a stale positively owned container", async () => {
    process.prior = true;
    await supervisor.start(request);
    await supervisor.stop();
    process.foreign = true;
    await expect(supervisor.start(request)).rejects.toThrow("target_unsafe");
  });
  it("cleans its own failed start without advancing or discarding a source pin", async () => {
    process.failRun = true;
    await expect(supervisor.start(request)).rejects.toThrow(
      "native_tool_failed",
    );
    expect(process.events).not.toContain("advanced");
  });
  it("rejects unsafe journal pointers and directories", async () => {
    await mkdir(join(directory, "repo", "wal"), { mode: 0o700 });
    await writeFile(pointer(), "x".repeat(5000));
    await expect(supervisor.start(request)).rejects.toThrow(
      "repository_discontinuity",
    );
    await rm(pointer());
    await symlink(join(directory, "outside"), pointer());
    await expect(supervisor.start(request)).rejects.toThrow(
      "repository_discontinuity",
    );
    await rm(pointer());
    await chmod(join(directory, "repo", "wal"), 0o777);
    await expect(supervisor.start(request)).rejects.toThrow(
      "repository_unavailable",
    );
  });
  it("handles invalid checkpoint targets and cut cancellation", async () => {
    const handle = await supervisor.start(request);
    await expect(handle.checkpoint("../path")).rejects.toThrow("wal_gap");
    const abort = new AbortController();
    abort.abort();
    await expect(
      handle.checkpoint("0000000100000000000000FF", abort.signal),
    ).rejects.toThrow();
  });
  it("stops cleanly when the worker shutdown signal aborts", async () => {
    const abort = new AbortController();
    const handle = await supervisor.start(request, abort.signal);
    abort.abort();
    await handle.stop();
    expect(() => handle.snapshot()).toThrow();
  });
  it("rejects source identity changes at the certified checkpoint boundary", async () => {
    const handle = await supervisor.start(request);
    process.timeline = 2;
    await expect(handle.checkpoint()).rejects.toThrow(
      "source_identity_changed",
    );
  });
  it("does not publish a WAL segment whose reader failed", async () => {
    const handle = await supervisor.start(request);
    process.failCat = true;
    await expect(handle.checkpoint()).rejects.toThrow("wal_receiver_failed");
    expect(process.events).not.toContain("advanced");
  });
  it.each([0, 1])(
    "reports continuous receiver termination code %s",
    async (code) => {
      const handle = await supervisor.start(request);
      process.children[0]!.emit("close", code);
      await new Promise((resolve) => setImmediate(resolve));
      expect(() => handle.snapshot()).toThrow(
        code === 0 ? "wal_receiver_failed" : "wal_gap",
      );
    },
  );
  it("refuses an advisory session that exits before taking the source lock", async () => {
    process.lockClosed = true;
    await expect(supervisor.start(request)).rejects.toThrow("lease_lost");
  });
  it("uses explicitly encrypted staging and cleans its generated directory", async () => {
    const encrypted = join(directory, "encrypted");
    await mkdir(encrypted, { mode: 0o700 });
    resolved = {
      ...resolved,
      staging: {
        kind: "encrypted",
        path: encrypted,
        maximumBytes: 64 * 1024 * 1024,
        attestedMount: true,
        mountDevice: 1,
      },
    };
    jest.spyOn(mountsModule, "resolveBackupMounts").mockResolvedValue(resolved);
    const handle = await supervisor.start(request);
    expect(await handle.checkpoint()).toHaveLength(1);
    await supervisor.stop();
  });
  it("honors shutdown that was already requested", async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(supervisor.start(request, abort.signal)).rejects.toThrow();
  });
  it("serializes concurrent starts in the same executor", async () => {
    const handles = await Promise.all([
      supervisor.start(request),
      supervisor.start(request),
    ]);
    expect(handles[0]).toBe(handles[1]);
  });
  it("requires retained historical keys before accepting rotated archive authority", async () => {
    const handle = await supervisor.start(request);
    await handle.checkpoint();
    await supervisor.stop();
    const replacement = new NativeWalSupervisor(
      {
        gpgBinary: "gpg",
        keys: { next: { keyId: "next-key", path: "/next" } },
      } as unknown as BackupMountedRuntime,
      process,
      factory,
    );
    held.push(replacement);
    await expect(
      replacement.start({ ...request, keyId: "next-key", keyAlias: "next" }),
    ).rejects.toThrow("historical_key_unavailable");
  });
  it("preserves old WAL part key IDs when a mounted key rotates", async () => {
    const runtime = {
      gpgBinary: "gpg",
      keys: {
        old: { keyId: "backup-key", path: "/old" },
        next: { keyId: "next-key", path: "/next" },
      },
    } as unknown as BackupMountedRuntime;
    const stream = new NativeWalSupervisor(runtime, process, factory);
    held.push(stream);
    const first = await stream.start(request);
    await first.checkpoint();
    const rotated = await stream.start({
      ...request,
      keyId: "next-key",
      keyAlias: "next",
    });
    expect(rotated.snapshot()[0]?.keyId).toBe("backup-key");
    expect(await rotated.checkpoint()).toHaveLength(2);
  });
  it("reconciles only abandoned directories in its encrypted instance namespace", async () => {
    const encrypted = join(directory, "encrypted");
    await mkdir(encrypted, { mode: 0o700 });
    const old = join(
      encrypted,
      `cra-backup-wal-${request.instanceId.replaceAll("-", "")}-${randomUUID()}`,
    );
    await mkdir(old, { mode: 0o700 });
    await writeFile(join(old, "owned-plaintext"), "canary");
    const other = join(encrypted, "other-feature");
    await mkdir(other, { mode: 0o700 });
    await writeFile(join(other, "untouched"), "preserved");
    resolved = {
      ...resolved,
      staging: {
        kind: "encrypted",
        path: encrypted,
        maximumBytes: 64 * 1024 * 1024,
        attestedMount: true,
        mountDevice: 1,
      },
    };
    jest.spyOn(mountsModule, "resolveBackupMounts").mockResolvedValue(resolved);
    await supervisor.start(request);
    await expect(readFile(join(old, "owned-plaintext"))).rejects.toHaveProperty(
      "code",
      "ENOENT",
    );
    expect(await readFile(join(other, "untouched"), "utf8")).toBe("preserved");
  });
});
