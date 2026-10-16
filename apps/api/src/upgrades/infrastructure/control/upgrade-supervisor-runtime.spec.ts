import {
  loadUpgradeSupervisorRuntime,
  readPrivateUpgradeJson,
} from "./upgrade-supervisor-runtime";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
describe("supervisor mounts", () => {
  it("defaults disabled without reading mounts", async () =>
    expect(await loadUpgradeSupervisorRuntime({})).toBeNull());
  it("requires Linux and explicit config", async () => {
    await expect(
      loadUpgradeSupervisorRuntime(
        { UPGRADE_SUPERVISOR_ENABLED: "true" },
        "darwin",
      ),
    ).rejects.toThrow("linux");
    await expect(
      loadUpgradeSupervisorRuntime(
        { UPGRADE_SUPERVISOR_ENABLED: "true" },
        "linux",
      ),
    ).rejects.toThrow();
  });
  it("requires a bounded private regular file", async () => {
    const root = await mkdtemp(join(tmpdir(), "supervisor-config-"));
    try {
      const file = join(root, "config");
      await writeFile(file, '{"value":1}', { mode: 0o600 });
      expect(await readPrivateUpgradeJson(file)).toEqual({ value: 1 });
      await chmod(file, 0o644);
      await expect(readPrivateUpgradeJson(file)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
import { mkdir, symlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { SupervisorMountedMedia } from "./upgrade-supervisor-runtime";
import { MountedUpgradeMediaVerifier } from "../media/mounted-upgrade-media";
async function mountedFixture() {
  const root = await mkdtemp(join(tmpdir(), "supervisor-mounts-"));
  const paths = Object.fromEntries(
    ["journal", "stage", "inbox", "source"].map((name) => [
      name,
      join(root, name),
    ]),
  );
  await Promise.all(
    Object.values(paths).map((value) => mkdir(value, { mode: 0o700 })),
  );
  const key = join(root, "key");
  await writeFile(key, Buffer.alloc(32, 1), { mode: 0o600 });
  const trustPath = join(root, "trust");
  await writeFile(
    trustPath,
    JSON.stringify({ version: 1, minimumVersion: 1, keys: [] }),
    { mode: 0o600 },
  );
  const config = {
    instanceId: randomUUID(),
    socketPath: join(root, "socket"),
    controlKeyPath: key,
    journalKeyPath: key,
    journalRoot: paths.journal,
    minimumJournalSequence: 0,
    grantsPath: join(root, "grants"),
    inboxRoot: paths.inbox,
    stagingRoot: paths.stage,
    trustPath,
    protectedRoots: [paths.source],
    runtime: {},
  };
  const file = join(root, "config");
  await writeFile(file, JSON.stringify(config), { mode: 0o600 });
  return {
    root,
    config,
    file,
    env: {
      UPGRADE_SUPERVISOR_ENABLED: "true",
      UPGRADE_SUPERVISOR_CONFIG_PATH: file,
    },
  };
}
describe("private runtime and media", () => {
  afterEach(() => jest.restoreAllMocks());
  it("loads complete separated mounts and rejects overlaps", async () => {
    const f = await mountedFixture();
    try {
      expect(await loadUpgradeSupervisorRuntime(f.env, "linux")).toMatchObject({
        config: f.config,
      });
      for (const patch of [
        { journalRoot: f.config.protectedRoots[0] },
        { stagingRoot: f.config.journalRoot },
        { inboxRoot: f.config.journalRoot },
      ]) {
        await writeFile(f.file, JSON.stringify({ ...f.config, ...patch }));
        await expect(
          loadUpgradeSupervisorRuntime(f.env, "linux"),
        ).rejects.toThrow();
      }
      await writeFile(f.file, JSON.stringify(f.config));
      await chmod(f.config.journalRoot!, 0o755);
      await expect(
        loadUpgradeSupervisorRuntime(f.env, "linux"),
      ).rejects.toThrow();
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });
  it("maps aliases to stable opaque IDs and delegates only known media", async () => {
    const f = await mountedFixture();
    try {
      const alias = join(f.config.inboxRoot!, "release-1");
      await mkdir(alias);
      await writeFile(join(alias, "payload.tar"), "payload");
      const media = new SupervisorMountedMedia(
        f.config as never,
        Buffer.alloc(32, 1),
      );
      const listed = await media.list();
      expect(listed.items).toHaveLength(1);
      expect(
        (
          await new SupervisorMountedMedia(
            f.config as never,
            Buffer.alloc(32, 1),
          ).list()
        ).items[0]!.id,
      ).toBe(listed.items[0]!.id);
      const verify = jest
        .spyOn(MountedUpgradeMediaVerifier.prototype, "verify")
        .mockResolvedValue({} as never);
      await media.verify(listed.items[0]!.id);
      expect(verify).toHaveBeenCalledWith("release-1");
      await expect(media.verify(randomUUID())).rejects.toThrow();
      await rm(join(alias, "payload.tar"));
      await symlink(f.file, join(alias, "payload.tar"));
      await expect(media.list()).rejects.toThrow();
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });
});
