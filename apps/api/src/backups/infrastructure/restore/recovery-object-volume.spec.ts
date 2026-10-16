import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  symlink,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RECOVERY_OBJECT_VOLUME_SCRIPT,
  prepareRecoveryObjectVolume,
  assertOwnedRecoveryObjectVolume,
  checkRecoveryObjectVolume,
  removeOwnedRecoveryObjectVolume,
} from "./recovery-object-volume";

describe("complete Linux-native recovery object inventory", () => {
  let root: string;
  const execute = promisify(execFile);
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "m15-05-volume-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  function dockerFixture() {
    const name =
      "cra-backup-restore-11111111-1111-4111-8111-111111111111-objects";
    const ownership = { feature: "m15-05", instance: "instance" };
    let present = false;
    const run = jest.fn((args: readonly string[]) =>
      Promise.resolve(
        args[0] === "info"
          ? args.includes("{{.ID}}")
            ? "daemon"
            : "linux"
          : args[0] === "volume" && args[1] === "ls"
            ? present
              ? name
              : ""
            : args[0] === "volume" && args[1] === "create"
              ? ((present = true), name)
              : args[0] === "volume" && args[1] === "inspect"
                ? JSON.stringify({
                    Name: name,
                    Driver: "local",
                    Scope: "local",
                    Options: null,
                    Labels: ownership,
                  })
                : args[0] === "run"
                  ? JSON.stringify({ ok: true, count: 1, bytes: 1 })
                  : "",
      ),
    );
    const options = {
      name,
      ownership,
      backing: {
        encryptedAtRest: true as const,
        daemonId: "daemon",
        maximumBytes: 1024,
      },
      inventory: [
        {
          bucketId: "bucket",
          name: "file",
          version: null,
          entry: "objects/1",
          sha256: "a".repeat(64),
          bytes: 1,
        },
      ],
      directory: root,
      objectDirectory: join(root, "source"),
      prefix: "stub/stub",
      maximumEntries: 100,
      onAttempt: jest.fn(),
    };
    return { name, ownership, run, options };
  }
  it("creates only a fresh attested-daemon local volume and checks complete exact results", async () => {
    const f = dockerFixture();
    await prepareRecoveryObjectVolume(f.options, f.run);
    expect(f.options.onAttempt).toHaveBeenCalledTimes(1);
    expect(
      f.run.mock.calls.some(([args]) =>
        args.includes(`type=volume,src=${f.name},dst=/objects`),
      ),
    ).toBe(true);
    await expect(prepareRecoveryObjectVolume(f.options, f.run)).rejects.toThrow(
      "recovery_target_unsafe",
    );
    await checkRecoveryObjectVolume(
      { ...f.options, maximumBytes: 1024, expectedCount: 1, expectedBytes: 1 },
      "verify",
      f.run,
    );
    expect(
      f.run.mock.calls.some(([args]) =>
        args.includes(`type=volume,src=${f.name},dst=/objects,readonly`),
      ),
    ).toBe(true);
    await expect(
      checkRecoveryObjectVolume(
        {
          ...f.options,
          maximumBytes: 1024,
          expectedCount: 2,
          expectedBytes: 1,
        },
        "verify",
        f.run,
      ),
    ).rejects.toThrow("object_integrity");
  });
  it("refuses absent encryption, mismatched daemon, capacity and unsafe volume authority", async () => {
    for (const backing of [
      undefined,
      { encryptedAtRest: false, daemonId: "daemon", maximumBytes: 100 },
      { encryptedAtRest: true, daemonId: "other", maximumBytes: 100 },
      { encryptedAtRest: true, daemonId: "daemon", maximumBytes: 0 },
      { encryptedAtRest: true, daemonId: "daemon", maximumBytes: 0.5 },
    ]) {
      const f = dockerFixture();
      await expect(
        prepareRecoveryObjectVolume(
          { ...f.options, backing: backing as typeof f.options.backing },
          f.run,
        ),
      ).rejects.toThrow();
      expect(f.options.onAttempt).not.toHaveBeenCalled();
    }
    const f = dockerFixture();
    await expect(
      prepareRecoveryObjectVolume({ ...f.options, maximumEntries: 0 }, f.run),
    ).rejects.toThrow();
    for (const changed of [
      { Driver: "nfs" },
      { Scope: "global" },
      { Options: { device: "/source" } },
      { Labels: {} },
      { Name: "foreign" },
    ])
      await expect(
        assertOwnedRecoveryObjectVolume(f.name, f.ownership, () =>
          Promise.resolve(
            JSON.stringify({
              Name: f.name,
              Driver: "local",
              Scope: "local",
              Options: null,
              Labels: f.ownership,
              ...changed,
            }),
          ),
        ),
      ).rejects.toThrow("recovery_cleanup_unsafe");
  });
  it("cleans lost-ack helper and volume only with matching ownership and never forces in-use volumes", async () => {
    const f = dockerFixture();
    await prepareRecoveryObjectVolume(f.options, f.run);
    const original = f.run.getMockImplementation()!;
    f.run.mockImplementation((args) =>
      args[0] === "ps"
        ? Promise.resolve(`${f.name}-check`)
        : args[0] === "inspect"
          ? Promise.resolve(JSON.stringify(f.ownership))
          : original(args),
    );
    await removeOwnedRecoveryObjectVolume(f.name, f.ownership, f.run);
    expect(f.run).toHaveBeenCalledWith(["rm", "--force", `${f.name}-check`]);
    expect(f.run).toHaveBeenCalledWith(["volume", "rm", f.name]);
    f.run.mockImplementation((args) =>
      args[0] === "ps"
        ? Promise.resolve(`${f.name}-check`)
        : Promise.resolve("{}"),
    );
    await expect(
      removeOwnedRecoveryObjectVolume(f.name, f.ownership, f.run),
    ).rejects.toThrow("recovery_cleanup_unsafe");
    await expect(
      removeOwnedRecoveryObjectVolume("foreign", f.ownership, f.run),
    ).rejects.toThrow("recovery_cleanup_unsafe");
    await removeOwnedRecoveryObjectVolume(f.name, f.ownership, () =>
      Promise.resolve(""),
    );
  });
  it("copies the complete exact inventory exclusively and verifies every restored byte", async () => {
    await mkdir(join(root, "source"));
    await mkdir(join(root, "target"));
    const entries = ["a", "b"].map((name) => ({
      path: `stub/stub/bucket/${name}`,
      bytes: 1,
      sha256: createHash("sha256").update(name).digest("hex"),
    }));
    for (const entry of entries) {
      await mkdir(join(root, "source", entry.path, ".."), { recursive: true });
      await writeFile(join(root, "source", entry.path), entry.path.at(-1)!);
    }
    await writeFile(join(root, "manifest"), JSON.stringify(entries));
    const args = [
      "-e",
      RECOVERY_OBJECT_VOLUME_SCRIPT,
      join(root, "source"),
      join(root, "target"),
      join(root, "manifest"),
      "copy",
      "1024",
      "100",
    ];
    await execute(process.execPath, args);
    expect(await readFile(join(root, "target", entries[1]!.path), "utf8")).toBe(
      "b",
    );
    await execute(process.execPath, [
      ...args.slice(0, -3),
      "verify",
      "1024",
      "100",
    ]);
    await expect(execute(process.execPath, args)).rejects.toThrow();
    await writeFile(join(root, "target", entries[0]!.path), "corrupt");
    await expect(
      execute(process.execPath, [
        ...args.slice(0, -3),
        "verify",
        "1024",
        "100",
      ]),
    ).rejects.toThrow();
  });
  it("rejects traversal, links, unexpected files and capacity overflow", async () => {
    await mkdir(join(root, "source"));
    await mkdir(join(root, "target"));
    const valid = {
      path: "file",
      bytes: 1,
      sha256: createHash("sha256").update("x").digest("hex"),
    };
    await writeFile(join(root, "source/file"), "x");
    const run = async (entries: unknown, mode = "copy", limit = "1024") => {
      await writeFile(join(root, "manifest"), JSON.stringify(entries));
      return execute(process.execPath, [
        "-e",
        RECOVERY_OBJECT_VOLUME_SCRIPT,
        join(root, "source"),
        join(root, "target"),
        join(root, "manifest"),
        mode,
        limit,
        "100",
      ]);
    };
    for (const path of ["../outside", "/absolute", "a/../file", "a\\file"])
      await expect(run([{ ...valid, path }])).rejects.toThrow();
    await expect(run([valid], "copy", "0")).rejects.toThrow();
    await symlink(join(root, "source/file"), join(root, "source/link"));
    await expect(run([{ ...valid, path: "link" }])).rejects.toThrow();
    await run([valid]);
    await writeFile(join(root, "target/unknown"), "x");
    await expect(run([valid], "verify")).rejects.toThrow();
  });
});
