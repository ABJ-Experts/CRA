import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  recordCaptureResourceOwnership,
  reconcileStaleCaptureResources,
  temporaryCaptureSlotNames,
} from "./capture-resource-reconciliation";
import { NativeBackupProcess } from "./native-backup-process";
import type { BackupMountedRuntime } from "./backup-mounted-runtime";

describe("capture crash resource ownership", () => {
  let directory: string;
  let runtime: BackupMountedRuntime;
  const instanceId = "11111111-1111-4111-8111-111111111111";
  const runId = "22222222-2222-4222-8222-222222222222";
  const token = "33333333-3333-4333-8333-333333333333";
  const tool = `cra-backup-${token}`;
  let marker: Awaited<ReturnType<typeof recordCaptureResourceOwnership>>;
  let native: NativeBackupProcess;
  let labels: Readonly<Record<string, string>>;
  let cluster: string;
  let container: string;
  let slots: string;
  let calls: readonly string[][];
  let queries: string[];
  beforeEach(async () => {
    directory = await realpath(
      await mkdtemp(join(tmpdir(), "m15-capture-owner-")),
    );
    for (const name of ["repo", "stage"])
      await mkdir(join(directory, name), { mode: 0o700 });
    runtime = {
      sources: {
        source: {
          databaseContainer: "db",
          storageContainer: "storage",
          databaseName: "postgres",
          databaseUser: "postgres",
          network: "source",
          host: "db",
          port: 5432,
          postgresImage: "image",
          pgpassFile: join(directory, "pgpass"),
          storageRoot: "/mnt",
          storageTenantPrefix: "stub/stub",
        },
      },
      repositories: {
        repo: {
          path: join(directory, "repo"),
          generation: runId,
          residency: "local",
          offHost: true,
        },
      },
      staging: {
        stage: {
          kind: "encrypted",
          path: join(directory, "stage"),
          maximumBytes: 1e9,
          attestedMount: true,
          mountDevice: (await stat(join(directory, "stage"))).dev,
        },
      },
      keys: {},
      gpgBinary: "gpg",
    };
    marker = await recordCaptureResourceOwnership(runtime, {
      instanceId,
      runId,
      sourceAlias: "source",
      repositoryAlias: "repo",
      stagingAlias: "stage",
      tool,
      sourceContainerId: "a".repeat(64),
      sourceSystemIdentifier: "123456",
      ownerPid: 2147483647,
    });
    labels = marker.labels;
    cluster = "123456";
    container = "a".repeat(64);
    slots = "0";
    const observed: string[][] = [];
    calls = observed;
    queries = [];
    native = {
      run: jest.fn(
        async (_binary, args: readonly string[], _signal, input?: string) => {
          await Promise.resolve();
          observed.push([...args]);
          if (input) queries.push(input);
          if (args[0] === "ps") return tool;
          if (args.includes("{{json .Config.Labels}}"))
            return JSON.stringify(labels);
          if (args.includes("{{.Id}}")) return container;
          if (args.includes("{{json .Mounts}}"))
            return args.at(-1) === tool ? "[]" : "[]\n[]";
          if (input?.includes("pg_control_system")) return cluster;
          if (input?.includes("pg_replication_slots")) return slots;
          return "";
        },
      ),
    } as unknown as NativeBackupProcess;
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const reconcile = (authorize = jest.fn(() => Promise.resolve(true))) =>
    reconcileStaleCaptureResources(
      runtime,
      instanceId,
      authorize,
      AbortSignal.timeout(3000),
      native,
    );
  it("durably records exact resource identity before creation and removes only an abandoned authorized capture", async () => {
    const content = JSON.parse(await readFile(marker.path, "utf8")) as Record<
      string,
      unknown
    >;
    expect(content.sourceContainerId).toBe(container);
    await mkdir(join(directory, "stage", tool), { mode: 0o700 });
    const authority = jest.fn(() => Promise.resolve(true));
    expect(await reconcile(authority)).toEqual({ removed: 1, retained: 0 });
    expect(authority.mock.calls.length).toBeGreaterThan(1);
    expect(calls.some((args) => args[0] === "rm" && args.at(-1) === tool)).toBe(
      true,
    );
    expect(await readdir(join(directory, "repo", "capture-owners"))).toEqual(
      [],
    );
  });
  it.each(["authority", "container", "cluster", "labels", "active-slot"])(
    "preserves resources when %s is unsafe",
    async (failure) => {
      if (failure === "container") container = "b".repeat(64);
      if (failure === "cluster") cluster = "999999";
      if (failure === "labels") labels = {};
      if (failure === "active-slot") slots = "1";
      expect(
        (
          await reconcile(
            jest.fn(() => Promise.resolve(failure !== "authority")),
          )
        ).retained,
      ).toBe(1);
      expect(await readFile(marker.path, "utf8")).toContain(runId);
      if (failure !== "active-slot")
        expect(calls.some((args) => args[0] === "rm")).toBe(false);
    },
  );
  it("preserves a live owner, unrelated records and unknown schema", async () => {
    await rm(marker.path);
    marker = await recordCaptureResourceOwnership(runtime, {
      instanceId,
      runId,
      sourceAlias: "source",
      repositoryAlias: "repo",
      stagingAlias: "stage",
      tool,
      sourceContainerId: container,
      sourceSystemIdentifier: cluster,
    });
    await writeFile(
      join(directory, "repo", "capture-owners", "unowned.json"),
      "{}",
    );
    expect(await reconcile()).toEqual({ removed: 0, retained: 1 });
    expect(calls).toEqual([]);
    await writeFile(marker.path, "{}");
    expect((await reconcile()).retained).toBe(1);
  });
  it("reauthorizes before source slot deletion when authority changes", async () => {
    let read = 0;
    const authority = jest.fn(() => Promise.resolve(++read < 3));
    expect((await reconcile(authority)).retained).toBe(1);
    expect(calls.some((args) => args[0] === "rm")).toBe(true);
    expect(
      queries.some((query) => query.includes("pg_drop_replication_slot")),
    ).toBe(false);
  });
  it.each([
    "foreign-host",
    "different-instance",
    "repository-generation",
    "unknown-source",
    "unknown-staging",
    "oversized",
    "permissions",
  ])("preserves %s ownership records", async (failure) => {
    const owner = JSON.parse(await readFile(marker.path, "utf8")) as Record<
      string,
      unknown
    >;
    const changed =
      failure === "foreign-host"
        ? { ownerHost: "b".repeat(64) }
        : failure === "different-instance"
          ? { instanceId: runId }
          : failure === "repository-generation"
            ? { repositoryGeneration: instanceId }
            : failure === "unknown-source"
              ? { sourceAlias: "missing" }
              : failure === "unknown-staging"
                ? { stagingAlias: "missing" }
                : {};
    await writeFile(
      marker.path,
      failure === "oversized"
        ? " ".repeat(16385)
        : JSON.stringify({ ...owner, ...changed }),
    );
    if (failure === "permissions") await chmod(marker.path, 0o644);
    expect((await reconcile()).retained).toBe(1);
    expect(calls).toEqual([]);
  });
  it("preserves source-overlapping stage and unavailable authorization", async () => {
    await mkdir(join(directory, "stage", tool), { mode: 0o700 });
    (native.run as jest.Mock).mockImplementation(
      async (_binary, args: string[], _signal, input?: string) => {
        await Promise.resolve();
        if (args.includes("{{.Id}}")) return container;
        if (args[0] === "ps") return "";
        if (args.includes("{{json .Mounts}}"))
          return (
            JSON.stringify([{ Source: join(directory, "stage") }]) + "\n[]"
          );
        return input?.includes("pg_control_system") ? cluster : "0";
      },
    );
    expect((await reconcile()).retained).toBe(1);
    await expect(readFile(marker.path, "utf8")).resolves.toContain(runId);
    expect(
      (await reconcile(jest.fn(() => Promise.reject(Error("unavailable")))))
        .retained,
    ).toBe(1);
  });
  it("reconciles absent resources, tmpfs and missing marker directories safely", async () => {
    runtime = {
      ...runtime,
      staging: { stage: { kind: "tmpfs", maximumBytes: 1e9 } },
    };
    (native.run as jest.Mock).mockImplementation(
      (_binary, args: string[], _signal, input?: string) =>
        Promise.resolve(
          args[0] === "ps"
            ? ""
            : args.includes("{{.Id}}")
              ? container
              : input?.includes("pg_control_system")
                ? cluster
                : "0",
        ),
    );
    expect(await reconcile()).toEqual({ removed: 1, retained: 0 });
    await rm(join(directory, "repo", "capture-owners"), { recursive: true });
    expect(await reconcile()).toEqual({ removed: 0, retained: 0 });
    expect(() => temporaryCaptureSlotNames("../other")).toThrow(
      "capture_cleanup_unsafe",
    );
    await expect(
      recordCaptureResourceOwnership(runtime, {
        instanceId,
        runId,
        sourceAlias: "missing",
        repositoryAlias: "repo",
        stagingAlias: "stage",
        tool,
        sourceContainerId: container,
        sourceSystemIdentifier: cluster,
      }),
    ).rejects.toThrow("capture_cleanup_unsafe");
  });
});
