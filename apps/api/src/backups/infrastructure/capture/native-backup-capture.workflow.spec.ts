import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type {
  BackupCaptureRequest,
  BackupExecutionContext,
} from "../../application/backup-execution.port";
import { BackupMountedRuntime } from "./backup-mounted-runtime";
import { NativeBackupCaptureAdapter } from "./native-backup-capture.adapter";
import { NativeBackupProcess } from "./native-backup-process";
import {
  RECOVERY_AUDIT_HEADS_SQL,
  RECOVERY_CATALOG_SQL,
  RECOVERY_MIGRATIONS_SQL,
} from "../restore/restore-inventory";

jest.setTimeout(30_000);
class FixtureProcess extends NativeBackupProcess {
  readonly calls: string[][] = [];
  fail = "";
  sourceMount: string | undefined;
  walName = "000000010000000000000001";
  objects = [
    { bucket_id: "evidence", name: "file.bin", version: "v1", bytes: 4 },
  ];
  override async run(
    _binary: string,
    args: readonly string[],
    _signal: AbortSignal,
    input?: string,
  ): Promise<string> {
    await Promise.resolve();
    this.calls.push([...args]);
    if (args.includes("{{json .Mounts}}"))
      return Array.from({ length: args.length - 3 }, () =>
        JSON.stringify(this.sourceMount ? [{ Source: this.sourceMount }] : []),
      ).join("\n");
    if (args.includes("{{.Id}}")) return "a".repeat(64);
    if (args.includes("--dump-options"))
      return "--force-ocb\n--symmetric\n--passphrase-fd\n--no-symkey-cache";
    if (args[0] === "ls") return "";
    if (args.includes("ls"))
      return this.fail === "gap"
        ? "000000010000000000000000\n000000010000000000000002"
        : this.walName;
    if (args.includes("sha256sum")) return `${"a".repeat(64)}  fixture`;
    if (args.includes("pg_controldata"))
      return `Database system identifier: ${this.fail === "source-binding" ? "999999" : "123456"}`;
    if (input === RECOVERY_CATALOG_SQL)
      return JSON.stringify({ fixture: true });
    if (input === RECOVERY_AUDIT_HEADS_SQL) return "[]";
    if (input === RECOVERY_MIGRATIONS_SQL) return "[]";
    if (input?.includes("pg_extension"))
      return this.fail === "external" ? "t" : "f";
    if (input?.includes("SHOW wal_segment_size")) return "16MB";
    if (input?.includes("SHOW server_version"))
      return this.fail === "version" ? "16.0" : "17.6";
    if (input?.includes("pg_tablespace"))
      return this.fail === "tablespace" ? "1" : "0";
    if (input?.includes("sum(pg_database_size"))
      return this.fail === "capacity" ? String(2e9) : "1024";
    if (input?.includes("SELECT to_char"))
      return new Date(Date.now() + 120000).toISOString();
    if (input?.includes("SELECT datname")) return "postgres";
    if (input?.includes("FROM public.organizations")) return "[]";
    if (input?.includes("FROM storage.objects"))
      return JSON.stringify(this.objects);
    if (
      input?.includes("systemIdentifier") &&
      !input.includes("pg_create_restore_point")
    )
      return JSON.stringify({
        systemIdentifier: "123456",
        timeline: 1,
        currentWalName: this.walName,
      });
    if (input?.includes("pg_create_restore_point"))
      return JSON.stringify({
        systemIdentifier: "123456",
        timeline: 1,
        lsn: "0/1000100",
      });
    if (input?.includes("pg_walfile_name"))
      return this.fail === "wal"
        ? "invalid"
        : this.fail === "gap"
          ? "000000010000000000000002"
          : this.walName;
    return "";
  }
  override start(
    _binary: string,
    args: readonly string[],
  ): ChildProcessWithoutNullStreams {
    this.calls.push([...args]);
    const emitter = new EventEmitter();
    const child = Object.assign(emitter, {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: () => {
        setImmediate(() => emitter.emit("close", 0));
        return true;
      },
    }) as unknown as ChildProcessWithoutNullStreams;
    if (args.includes("psql")) {
      child.stdin.on("data", (input: Buffer) =>
        setImmediate(() => {
          (child.stdout as PassThrough).write(
            input.toString().match(/FENCE_CHECK_[a-f0-9]+/)?.[0] ??
              "FENCE_READY\n",
          );
          if (this.fail === "fence") emitter.emit("close", 1);
        }),
      );
      child.stdin.on("finish", () =>
        setImmediate(() => emitter.emit("close", 0)),
      );
    } else if (!args.includes("pg_receivewal")) {
      setImmediate(() => {
        (child.stdout as PassThrough).end("data");
        emitter.emit(
          "close",
          (this.fail === "missing" && args.includes("python3")) ||
            (this.fail === "base" && args.includes("tar"))
            ? 1
            : 0,
        );
      });
    }
    return child;
  }
}

describe("certified capture workflow", () => {
  let directory: string;
  let runtime: BackupMountedRuntime;
  let native: FixtureProcess;
  let context: BackupExecutionContext;
  const request: BackupCaptureRequest = {
    runId: "11111111-1111-4111-8111-111111111111",
    instanceId: "22222222-2222-4222-8222-222222222222",
    configurationRevision: 1,
    repositoryGeneration: "33333333-3333-4333-8333-333333333333",
    sourceAlias: "source",
    repositoryAlias: "repository",
    stagingAlias: "staging",
    keyAlias: "key",
    keyId: "key-v1",
    pauseLimitSeconds: 120,
  };
  beforeEach(async () => {
    directory = await realpath(await mkdtemp(join(tmpdir(), "m15-capture-")));
    await mkdir(join(directory, "repo"), { mode: 0o700 });
    await mkdir(join(directory, "stage"), { mode: 0o700 });
    await writeFile(
      join(directory, "key"),
      "synthetic-only-long-backup-key\n",
      { mode: 0o600 },
    );
    await writeFile(join(directory, "pgpass"), "fixture", { mode: 0o600 });
    runtime = {
      sources: {
        source: {
          databaseContainer: "db",
          databaseName: "postgres",
          databaseUser: "postgres",
          network: "private",
          host: "db",
          port: 5432,
          postgresImage: "public.ecr.aws/supabase/postgres:17.6.1.156",
          pgpassFile: join(directory, "pgpass"),
          storageContainer: "objects",
          storageRoot: "/mnt",
          storageTenantPrefix: "stub/stub",
        },
      },
      repositories: {
        repository: {
          path: join(directory, "repo"),
          generation: "33333333-3333-4333-8333-333333333333",
          residency: "local",
          offHost: true,
        },
      },
      staging: {
        staging: {
          kind: "encrypted",
          path: join(directory, "stage"),
          maximumBytes: 1e9,
          attestedMount: true,
          mountDevice: (await lstat(join(directory, "stage"))).dev,
        },
      },
      keys: { key: { path: join(directory, "key"), keyId: "key-v1" } },
      gpgBinary: "gpg",
    };
    native = new FixtureProcess();
    context = {
      signal: new AbortController().signal,
      checkpoint: jest.fn(() => Promise.resolve()),
      assertAuthority: jest.fn(() => Promise.resolve()),
    };
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  it("refuses encrypted staging inside a source mount before any plaintext tool starts", async () => {
    native.sourceMount = join(directory, "stage");
    native.fail = "base";
    const executor = new NativeBackupCaptureAdapter(runtime, native, {
      start: () =>
        Promise.resolve({
          checkpoint: () => Promise.resolve([]),
          snapshot: () => [],
          stop: () => Promise.resolve(),
        }),
      stop: () => Promise.resolve(),
    });
    await expect(executor.capture(request, context)).rejects.toThrow(
      "unsafe_recovery_mount",
    );
    expect(native.calls.some((args) => args.includes("pg_basebackup"))).toBe(
      false,
    );
    expect(native.calls.some((args) => args.includes("--detach"))).toBe(false);
  });
  it("rejects a native physical backup from a different cluster than the inventoried source", async () => {
    native.fail = "source-binding";
    const executor = new NativeBackupCaptureAdapter(runtime, native, {
      start: () =>
        Promise.resolve({
          checkpoint: () => Promise.resolve([]),
          snapshot: () => [],
          stop: () => Promise.resolve(),
        }),
      stop: () => Promise.resolve(),
    });
    await expect(executor.capture(request, context)).rejects.toThrow(
      "source_identity_changed",
    );
    expect(native.calls.some((args) => args.includes("tar"))).toBe(false);
  });
  it("verifies base before fencing, seals exact objects/WAL and binds independently retained catalog/audit evidence", async () => {
    const executor = new NativeBackupCaptureAdapter(runtime, native, {
      start: () =>
        Promise.resolve({
          checkpoint: () => Promise.resolve([]),
          snapshot: () => [],
          stop: () => Promise.resolve(),
        }),
      stop: () => Promise.resolve(),
    });
    const result = await executor.capture(request, context);
    await executor.stop();
    await executor.reconcileAbandoned(request, new AbortController().signal);
    expect(result.objectCount).toBe(1);
    expect(result.certificate.checkpoint.restorePoint).toMatch(/^cra_backup_/);
    expect(result.certificate.parts.map((p) => p.kind)).toEqual([
      "base",
      "objects",
      "wal",
      "inventory",
    ]);
    expect(
      native.calls.some((args) => args.includes("--wal-method=stream")),
    ).toBe(true);
    expect(native.calls.some((args) => args.includes("pg_verifybackup"))).toBe(
      true,
    );
    expect(native.calls.some((args) => args.includes("python3"))).toBe(true);
    expect(native.calls.at(-1)?.includes("psql")).toBe(true);
  });
  it.each([
    ["version", "incompatible_runtime"],
    ["tablespace", "unsupported_tablespace"],
    ["capacity", "insufficient_staging"],
    ["missing", "object_missing"],
    ["wal", "wal_gap"],
    ["gap", "wal_gap"],
    ["fence", "write_fence_expired"],
    ["base", "native_tool_failed"],
    ["external", "external_key_unavailable"],
  ])("fails safely for %s and never certifies", async (failure, expected) => {
    native.fail = failure;
    await expect(
      new NativeBackupCaptureAdapter(runtime, native, {
        start: () =>
          Promise.resolve({
            checkpoint: () => Promise.resolve([]),
            snapshot: () => [],
            stop: () => Promise.resolve(),
          }),
        stop: () => Promise.resolve(),
      }).capture(request, context),
    ).rejects.toThrow(expected);
  });
  it("refuses changed object sizes and lost execution authority", async () => {
    native.objects = [
      { bucket_id: "evidence", name: "file.bin", version: "v1", bytes: 5 },
    ];
    await expect(
      new NativeBackupCaptureAdapter(runtime, native, {
        start: () =>
          Promise.resolve({
            checkpoint: () => Promise.resolve([]),
            snapshot: () => [],
            stop: () => Promise.resolve(),
          }),
        stop: () => Promise.resolve(),
      }).capture(request, context),
    ).rejects.toThrow("object_integrity");
    context.assertAuthority = async () => {
      await Promise.resolve();
      throw Error("revoked");
    };
    await expect(
      new NativeBackupCaptureAdapter(runtime, native, {
        start: () =>
          Promise.resolve({
            checkpoint: () => Promise.resolve([]),
            snapshot: () => [],
            stop: () => Promise.resolve(),
          }),
        stop: () => Promise.resolve(),
      }).capture(request, context),
    ).rejects.toThrow("revoked");
  });
  it("uses only tmpfs when encrypted staging was not selected", async () => {
    runtime = {
      ...runtime,
      staging: { staging: { kind: "tmpfs", maximumBytes: 1e9 } },
    };
    native.objects = [];
    const result = await new NativeBackupCaptureAdapter(runtime, native, {
      start: () =>
        Promise.resolve({
          checkpoint: () => Promise.resolve([]),
          snapshot: () => [],
          stop: () => Promise.resolve(),
        }),
      stop: () => Promise.resolve(),
    }).capture(request, context);
    expect(result.objectCount).toBe(0);
    expect(native.calls.some((args) => args.includes("--tmpfs"))).toBe(true);
  });
  it("seals recovery key availability canaries without recording key material", async () => {
    runtime = {
      ...runtime,
      sources: {
        source: {
          ...runtime.sources.source!,
          externalRecoveryKeys: {
            pgsodium: { containerPath: "/run/root.key" },
          },
        },
      },
    };
    const result = await new NativeBackupCaptureAdapter(runtime, native, {
      start: () =>
        Promise.resolve({
          checkpoint: () => Promise.resolve([]),
          snapshot: () => [],
          stop: () => Promise.resolve(),
        }),
      stop: () => Promise.resolve(),
    }).capture(request, context);
    expect(
      result.certificate.parts.some((part) => part.kind === "recovery-key"),
    ).toBe(true);
  });
  it("reuses an authenticated daily base while certifying a new consistent object and WAL cut", async () => {
    let archived: import("../../application/backup-execution.port").BackupEncryptedPart[] =
      [];
    const executor = new NativeBackupCaptureAdapter(runtime, native, {
      start: () =>
        Promise.resolve({
          checkpoint: () => Promise.resolve(archived),
          snapshot: () => archived,
          stop: () => Promise.resolve(),
        }),
      stop: () => Promise.resolve(),
    });
    const first = await executor.capture(request, context);
    archived = first.certificate.parts.filter((part) => part.kind === "wal");
    native.walName = "000000010000000000000002";
    archived = [...archived, { ...archived[0]!, name: native.walName }];
    const nativeBaseCalls = native.calls.filter((args) =>
      args.includes("pg_basebackup"),
    ).length;
    const second = await executor.capture(
      { ...request, runId: "33333333-3333-4333-8333-333333333333" },
      context,
    );
    expect(
      native.calls.filter((args) => args.includes("pg_basebackup")),
    ).toHaveLength(nativeBaseCalls);
    expect(
      second.certificate.parts.find((part) => part.kind === "base")?.id,
    ).toBe(first.certificate.parts.find((part) => part.kind === "base")?.id);
    expect(second.certificate.baseCapturedAt).toBe(
      first.certificate.baseCapturedAt,
    );
    await executor.stop();
  });
  it("honours cancellation occurring exactly between write admission and fence creation", async () => {
    const controller = new AbortController();
    context = {
      ...context,
      signal: controller.signal,
      checkpoint: async (stage) => {
        await Promise.resolve();
        if (stage === "write_pause") controller.abort();
      },
    };
    const executor = new NativeBackupCaptureAdapter(runtime, native, {
      start: () =>
        Promise.resolve({
          checkpoint: () => Promise.resolve([]),
          snapshot: () => [],
          stop: () => Promise.resolve(),
        }),
      stop: () => Promise.resolve(),
    });
    await expect(executor.capture(request, context)).rejects.toThrow();
  });
});
