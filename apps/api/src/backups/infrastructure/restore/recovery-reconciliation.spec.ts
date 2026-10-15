/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method -- Asynchronous native port test doubles. */
import { hostname } from "node:os";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  reconcileStaleRecoveryTargets,
  recoveryOwnershipLabels,
  recordRecoveryStagingOwnership,
} from "./recovery-reconciliation";
import type { BackupMountedRuntime } from "../capture/backup-mounted-runtime";
import type { NativeBackupProcess } from "../capture/native-backup-process";
const instance = "11111111-1111-4111-8111-111111111111",
  run = "22222222-2222-4222-8222-222222222222",
  name = "cra-backup-restore-33333333-3333-4333-8333-333333333333";
describe("interrupted clean-target reconciliation", () => {
  let root: string;
  let runtime: BackupMountedRuntime;
  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "m15-05-reconcile-")));
    runtime = {
      sources: {},
      repositories: {},
      keys: {},
      gpgBinary: "gpg",
      staging: {
        stage: {
          kind: "encrypted",
          path: root,
          attestedMount: true,
          mountDevice: (await lstat(root)).dev,
          maximumBytes: 1024 ** 3,
        },
      },
    };
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  function setup(changes: Record<string, string> = {}) {
    const directory = `${name}-abcdef`;
    const labels = {
      ...recoveryOwnershipLabels(instance, run, name, directory),
      "cra.backup.owner-pid": "2147483647",
      ...changes,
    };
    const calls: string[][] = [];
    const process = {
      run: jest.fn(async (_binary: string, args: readonly string[]) => {
        calls.push([...args]);
        if (args[0] === "ps") return name;
        if (args[0] === "network" && args[1] === "ls") return `${name}-network`;
        if (args.includes("{{json .Containers}}")) return "{}";
        if (
          args.includes("{{json .Config.Labels}}") ||
          args.includes("{{json .Labels}}")
        )
          return JSON.stringify(labels);
        if (args[0] === "inspect" && args.includes("{{json .Mounts}}"))
          return JSON.stringify([
            {
              Source: join(root, directory, "pgdata"),
              Destination: "/var/lib/postgresql/data",
            },
            {
              Source: join(root, directory, "wal"),
              Destination: "/restore-wal",
            },
          ]);
        return "";
      }),
    } as unknown as NativeBackupProcess;
    return { directory, labels, calls, process };
  }
  it("removes only feature-owned dead-worker resources after fresh terminal SQL authority", async () => {
    const f = setup();
    await mkdir(join(root, f.directory), { mode: 0o700 });
    const authorize = jest.fn(() => Promise.resolve(true));
    const result = await reconcileStaleRecoveryTargets(
      runtime,
      instance,
      authorize,
      AbortSignal.timeout(1000),
      f.process,
    );
    expect(result.removed).toBe(1);
    expect(authorize).toHaveBeenCalledWith(run);
    expect(f.calls.some((args) => args[0] === "rm")).toBe(true);
    expect(await readdir(root)).toEqual([]);
  });
  it.each([true, false])(
    "reconciles a volume-only orphan only with fresh terminal authority %s",
    async (eligible) => {
      const f = setup();
      await mkdir(join(root, f.directory), { mode: 0o700 });
      const original = jest.mocked(f.process.run).getMockImplementation()!;
      jest
        .mocked(f.process.run)
        .mockImplementation((binary, args, signal, input, max) => {
          if (args[0] === "ps" || args[0] === "network")
            return Promise.resolve("");
          if (args[0] === "volume" && args[1] === "ls")
            return Promise.resolve(`${name}-objects`);
          if (args[0] === "volume" && args[1] === "inspect")
            return Promise.resolve(
              args.includes("{{json .Labels}}")
                ? JSON.stringify(f.labels)
                : JSON.stringify({
                    Name: `${name}-objects`,
                    Driver: "local",
                    Scope: "local",
                    Options: null,
                    Labels: f.labels,
                  }),
            );
          return original(binary, args, signal, input, max);
        });
      const authorize = jest.fn(() => Promise.resolve(eligible));
      const result = await reconcileStaleRecoveryTargets(
        runtime,
        instance,
        authorize,
        AbortSignal.timeout(1000),
        f.process,
      );
      expect(result.removed).toBe(eligible ? 1 : 0);
      expect(
        jest
          .mocked(f.process.run)
          .mock.calls.some(
            ([, args]) => args[0] === "volume" && args[1] === "rm",
          ),
      ).toBe(eligible);
    },
  );
  it.each<Readonly<Record<string, string>>>([
    { "cra.backup.owner-pid": String(process.pid) },
    { "cra.backup.owner-pid": "0" },
    { "cra.backup.instance": "other" },
    { "cra.backup.feature": "other" },
    { "cra.backup.owner-host": "other" },
    { "cra.backup.staging": "../../source" },
  ])("preserves active, foreign or malformed ownership %#", async (change) => {
    const f = setup(change);
    const authorize = jest.fn(() => Promise.resolve(true));
    expect(
      (
        await reconcileStaleRecoveryTargets(
          runtime,
          instance,
          authorize,
          AbortSignal.timeout(1000),
          f.process,
        )
      ).removed,
    ).toBe(0);
    expect(authorize).not.toHaveBeenCalled();
    expect(f.calls.some((args) => args[0] === "rm")).toBe(false);
  });
  it("preserves resources when SQL refuses, fails or cannot prove current authority", async () => {
    for (const authorize of [
      () => Promise.resolve(false),
      () => Promise.reject(new Error("database unavailable")),
    ]) {
      const f = setup();
      await mkdir(join(root, f.directory), { mode: 0o700, recursive: true });
      expect(
        (
          await reconcileStaleRecoveryTargets(
            runtime,
            instance,
            authorize,
            AbortSignal.timeout(1000),
            f.process,
          )
        ).removed,
      ).toBe(0);
      expect(f.calls.some((args) => args[0] === "rm")).toBe(false);
    }
  });
  it("rejects ownership claims outside the generated namespace", () => {
    expect(() =>
      recoveryOwnershipLabels(instance, run, "supabase_db_cra", "../../source"),
    ).toThrow("recovery_cleanup_unsafe");
    expect(createHash("sha256").update(hostname()).digest("hex")).toHaveLength(
      64,
    );
  });
  it("reconciles an orphaned network after the container has already gone", async () => {
    const f = setup();
    await mkdir(join(root, f.directory), { mode: 0o700 });
    const original = jest.mocked(f.process.run).getMockImplementation()!;
    jest
      .mocked(f.process.run)
      .mockImplementation((binary, args, signal, input, max) =>
        args[0] === "ps"
          ? Promise.resolve("")
          : original(binary, args, signal, input, max),
      );
    expect(
      (
        await reconcileStaleRecoveryTargets(
          runtime,
          instance,
          () => Promise.resolve(true),
          AbortSignal.timeout(1000),
          f.process,
        )
      ).removed,
    ).toBe(1);
  });
  it("preserves directories and containers when mounts or network ownership disagree", async () => {
    for (const wrong of ["mounts", "network", "labels"]) {
      const f = setup();
      await mkdir(join(root, f.directory), { mode: 0o700, recursive: true });
      const original = jest.mocked(f.process.run).getMockImplementation()!;
      jest
        .mocked(f.process.run)
        .mockImplementation((binary, args, signal, input, max) =>
          wrong === "mounts" && args.includes("{{json .Mounts}}")
            ? Promise.resolve(
                '[{"Source":"/original","Destination":"/var/lib/postgresql/data"}]',
              )
            : wrong === "network" &&
                args[0] === "network" &&
                args[1] === "inspect"
              ? Promise.resolve(
                  JSON.stringify({
                    ...f.labels,
                    "cra.backup.verification-run": "other",
                  }),
                )
              : wrong === "labels" && args.includes("{{json .Config.Labels}}")
                ? Promise.resolve("[]")
                : original(binary, args, signal, input, max),
        );
      const authorize = jest.fn(() => Promise.resolve(true));
      expect(
        (
          await reconcileStaleRecoveryTargets(
            runtime,
            instance,
            authorize,
            AbortSignal.timeout(1000),
            f.process,
          )
        ).removed,
      ).toBe(0);
      expect(authorize).not.toHaveBeenCalled();
    }
  });
  it("cleans matching orphaned probe endpoints before removing their target network", async () => {
    const f = setup();
    await mkdir(join(root, f.directory), { mode: 0o700 });
    const probe = "cra-backup-probe-44444444-4444-4444-8444-444444444444-auth";
    const original = jest.mocked(f.process.run).getMockImplementation()!;
    jest
      .mocked(f.process.run)
      .mockImplementation((binary, args, signal, input, max) =>
        args.includes("{{json .Containers}}")
          ? Promise.resolve(JSON.stringify({ probe: { Name: probe } }))
          : args.includes(probe) && args.includes("{{json .Config.Labels}}")
            ? Promise.resolve(
                JSON.stringify({
                  ...f.labels,
                  "cra.backup.probe": probe.slice(0, -5),
                }),
              )
            : original(binary, args, signal, input, max),
      );
    expect(
      (
        await reconcileStaleRecoveryTargets(
          runtime,
          instance,
          () => Promise.resolve(true),
          AbortSignal.timeout(1000),
          f.process,
        )
      ).removed,
    ).toBe(1);
    expect(
      f.calls.some((args) => args[0] === "rm" && args.includes(probe)),
    ).toBe(true);
  });
  it("does not touch a source-volume or an incompatible cleanup runtime", async () => {
    const f = setup();
    await mkdir(join(root, f.directory), { mode: 0o700 });
    const source = {
      databaseContainer: "source-db",
      storageContainer: "source-storage",
      postgresImage: "postgres:latest",
    } as BackupMountedRuntime["sources"][string];
    expect(
      (
        await reconcileStaleRecoveryTargets(
          { ...runtime, sources: { source } },
          instance,
          () => Promise.resolve(true),
          AbortSignal.timeout(1000),
          f.process,
        )
      ).removed,
    ).toBe(0);
    expect(f.calls.some((args) => args[0] === "rm")).toBe(false);
  });
  it("reconciles marked pre-target scratch after a hard worker interruption", async () => {
    const f = setup();
    const directory = join(root, f.directory);
    await mkdir(directory, { mode: 0o700 });
    await recordRecoveryStagingOwnership(
      instance,
      run,
      name,
      directory,
      2147483647,
    );
    const original = jest.mocked(f.process.run).getMockImplementation()!;
    jest
      .mocked(f.process.run)
      .mockImplementation((binary, args, signal, input, max) =>
        args[0] === "ps" || (args[0] === "network" && args[1] === "ls")
          ? Promise.resolve("")
          : original(binary, args, signal, input, max),
      );
    expect(
      (
        await reconcileStaleRecoveryTargets(
          runtime,
          instance,
          () => Promise.resolve(true),
          AbortSignal.timeout(1000),
          f.process,
        )
      ).removed,
    ).toBe(1);
    expect(await readdir(root)).toEqual([]);
  });
  it("preserves marked scratch for an active owner or absent SQL authority", async () => {
    for (const pid of [process.pid, 2147483647]) {
      const f = setup();
      const directory = join(root, f.directory);
      await mkdir(directory, { mode: 0o700, recursive: true });
      await recordRecoveryStagingOwnership(instance, run, name, directory, pid);
      const original = jest.mocked(f.process.run).getMockImplementation()!;
      jest
        .mocked(f.process.run)
        .mockImplementation((binary, args, signal, input, max) =>
          args[0] === "ps" || (args[0] === "network" && args[1] === "ls")
            ? Promise.resolve("")
            : original(binary, args, signal, input, max),
        );
      expect(
        (
          await reconcileStaleRecoveryTargets(
            runtime,
            instance,
            () => Promise.resolve(false),
            AbortSignal.timeout(1000),
            f.process,
          )
        ).removed,
      ).toBe(0);
      await rm(directory, { recursive: true, force: true });
    }
    await expect(
      recordRecoveryStagingOwnership(
        instance,
        run,
        name,
        join(root, `${name}-abcdef`),
        0,
      ),
    ).rejects.toThrow("recovery_cleanup_unsafe");
  });
  it("checks configured source mounts before removing both Docker targets and pre-target scratch", async () => {
    for (const scratch of [false, true]) {
      const f = setup();
      const directory = join(root, f.directory);
      await mkdir(directory, { mode: 0o700 });
      if (scratch)
        await recordRecoveryStagingOwnership(
          instance,
          run,
          name,
          directory,
          2147483647,
        );
      const original = jest.mocked(f.process.run).getMockImplementation()!;
      jest
        .mocked(f.process.run)
        .mockImplementation((binary, args, signal, input, max) =>
          scratch &&
          (args[0] === "ps" || (args[0] === "network" && args[1] === "ls"))
            ? Promise.resolve("")
            : args.includes("source-db") && args.includes("{{json .Mounts}}")
              ? Promise.resolve("[]\n[]")
              : original(binary, args, signal, input, max),
        );
      const source = {
        databaseContainer: "source-db",
        storageContainer: "source-storage",
        postgresImage: "public.ecr.aws/supabase/postgres:17.6.1.156",
      } as BackupMountedRuntime["sources"][string];
      expect(
        (
          await reconcileStaleRecoveryTargets(
            { ...runtime, sources: { source } },
            instance,
            () => Promise.resolve(true),
            AbortSignal.timeout(1000),
            f.process,
          )
        ).removed,
      ).toBe(1);
    }
  });
});
