import * as filesystem from "node:fs/promises";
import {
  mkdtemp,
  writeFile,
  rm,
  symlink,
  chmod,
  realpath,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dockerSave, sha } from "./__fixtures__/docker-save";
import { gzipSync } from "node:zlib";
import {
  loadVerifiedUpgradeImages,
  verifyImportedUpgradeImages,
} from "./load-verified-upgrade-images";
import type { VerifiedUpgradeBundle } from "../media/mounted-upgrade-media";
describe("load only private verified offline image bytes", () => {
  let root: string;
  let bundle: VerifiedUpgradeBundle;
  const fixture = dockerSave();
  const digest = fixture.digest;
  const run = jest.fn<Promise<string>, [string, readonly string[], unknown]>();
  const config = {
    dockerExecutable: "/usr/bin/docker",
    cwd: "/private",
    environment: {},
  };
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "upgrade-image-"));
    await writeFile(join(root, "api.tar"), fixture.archive, { mode: 0o400 });
    bundle = {
      extractedRoot: root,
      manifest: {
        platform: { os: "linux", architecture: "amd64" },
        requirements: { diskBytes: 1024 * 1024 },
        images: [
          {
            service: "api",
            digest,
            archive: {
              name: "api.tar",
              bytes: fixture.archive.length,
              sha256: sha(fixture.archive),
            },
          },
        ],
      },
    } as unknown as VerifiedUpgradeBundle;
    run
      .mockReset()
      .mockImplementation((_executable, args) =>
        Promise.resolve(
          args[0] === "context"
            ? JSON.stringify("unix:///var/run/docker.sock")
            : args[0] === "info"
              ? JSON.stringify({ DockerRootDir: root, OSType: "linux" })
              : JSON.stringify([
                  { Id: digest, Os: "linux", Architecture: "amd64" },
                ]),
        ),
      );
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });
  it("loads exact private archive then verifies signed config image ID and platform", async () => {
    await loadVerifiedUpgradeImages(bundle, { run }, config);
    expect(run).toHaveBeenCalledWith(
      config.dockerExecutable,
      ["load", "--input", join(await realpath(root), "api.tar")],
      expect.any(Object),
    );
  });
  it("blocks substitutions before loading Docker", async () => {
    await chmod(join(root, "api.tar"), 0o600);
    const changed = Buffer.from(fixture.archive);
    changed[600] = 1;
    await writeFile(join(root, "api.tar"), changed);
    await expect(
      loadVerifiedUpgradeImages(bundle, { run }, config),
    ).rejects.toThrow("digest");
    expect(run).not.toHaveBeenCalled();
  });
  it("rejects wrong loaded architecture and digest", async () => {
    run.mockImplementation((_executable, args) =>
      Promise.resolve(
        args[0] === "context"
          ? JSON.stringify("unix:///var/run/docker.sock")
          : args[0] === "info"
            ? JSON.stringify({ DockerRootDir: root, OSType: "linux" })
            : JSON.stringify([
                { Id: digest, Os: "linux", Architecture: "arm64" },
              ]),
      ),
    );
    await expect(
      loadVerifiedUpgradeImages(bundle, { run }, config),
    ).rejects.toThrow("substitution");
  });
  it("rejects archive symlinks and changed sizes", async () => {
    await chmod(join(root, "api.tar"), 0o600);
    await writeFile(join(root, "api.tar"), "longer archive");
    await expect(
      loadVerifiedUpgradeImages(bundle, { run }, config),
    ).rejects.toThrow("metadata");
    await rm(join(root, "api.tar"));
    await symlink("elsewhere", join(root, "api.tar"));
    await expect(
      loadVerifiedUpgradeImages(bundle, { run }, config),
    ).rejects.toThrow();
  });
  it("rejects valid-hash gzip and ZIP archives named tar without invoking Docker", async () => {
    for (const bytes of [
      gzipSync(Buffer.alloc(4 * 1024 * 1024)),
      Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.alloc(4092)]),
    ]) {
      await chmod(join(root, "api.tar"), 0o600);
      await writeFile(join(root, "api.tar"), bytes);
      const signed = {
        ...bundle,
        manifest: {
          ...bundle.manifest,
          images: bundle.manifest.images.map((image) => ({
            ...image,
            archive: {
              ...image.archive,
              bytes: bytes.length,
              sha256: sha(bytes),
            },
          })),
        },
      };
      await expect(
        loadVerifiedUpgradeImages(signed, { run }, config),
      ).rejects.toThrow();
      expect(run).not.toHaveBeenCalled();
    }
  });
  it("rejects remote Docker endpoints and exhausted Docker-root reserve before load", async () => {
    run.mockResolvedValue(JSON.stringify("tcp://remote:2375"));
    await expect(
      loadVerifiedUpgradeImages(bundle, { run }, config),
    ).rejects.toThrow("remote_daemon");
    run.mockImplementation((_exe, args) =>
      Promise.resolve(
        args[0] === "context"
          ? JSON.stringify("unix:///var/run/docker.sock")
          : JSON.stringify({ DockerRootDir: root, OSType: "linux" }),
      ),
    );
    await expect(
      loadVerifiedUpgradeImages(
        bundle,
        { run },
        { ...config, reserveBytes: Number.MAX_SAFE_INTEGER },
      ),
    ).rejects.toThrow("capacity");
    expect(run.mock.calls.some(([, args]) => args[0] === "load")).toBe(false);
  });
  it("honors revoked execution authority before inspecting or loading", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      loadVerifiedUpgradeImages(
        bundle,
        { run, signal: controller.signal },
        config,
      ),
    ).rejects.toThrow("cancelled");
    expect(run).not.toHaveBeenCalled();
  });
  it("blocks unknown or exhausted inode capacity before importing any image", async () => {
    const space = await filesystem.statfs(root, { bigint: true });
    jest
      .spyOn(
        jest.requireActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        ),
        "statfs",
      )
      .mockResolvedValue({ ...space, ffree: 0n });
    await expect(
      loadVerifiedUpgradeImages(bundle, { run }, config),
    ).rejects.toThrow("inode_capacity");
    expect(run.mock.calls.some(([, args]) => args[0] === "load")).toBe(false);
  });
  it("reserves filesystem block allocation for tiny layer entries before import", async () => {
    const space = await filesystem.statfs(root, { bigint: true });
    jest
      .spyOn(
        jest.requireActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        ),
        "statfs",
      )
      .mockResolvedValue({
        ...space,
        bsize: 4096n,
        bavail: 2n,
        ffree: 1000000n,
      });
    await expect(
      loadVerifiedUpgradeImages(
        bundle,
        { run },
        { ...config, reserveBytes: 0 },
      ),
    ).rejects.toThrow("docker_capacity");
    expect(run.mock.calls.some(([, args]) => args[0] === "load")).toBe(false);
  });
  it("checks remaining capacity after import without reserving import space twice", async () => {
    const space = await filesystem.statfs(root, { bigint: true });
    jest
      .spyOn(
        jest.requireActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        ),
        "statfs",
      )
      .mockResolvedValue({ ...space, bsize: 4096n, bavail: 3n, ffree: 1024n });
    bundle = {
      ...bundle,
      manifest: {
        ...bundle.manifest,
        requirements: { ...bundle.manifest.requirements, diskBytes: 16000 },
      },
    };
    await expect(
      loadVerifiedUpgradeImages(
        bundle,
        { run },
        { ...config, reserveBytes: 4096 },
      ),
    ).rejects.toThrow("capacity");
    run.mockClear();
    expect(
      await verifyImportedUpgradeImages(
        bundle,
        { run },
        { ...config, reserveBytes: 4096 },
      ),
    ).toEqual({ requiredRemainingBytes: 4096 });
    expect(run.mock.calls.some(([, args]) => args[0] === "load")).toBe(false);
  });
  it("retains signed non-import disk requirements in post-import verification", async () => {
    const space = await filesystem.statfs(root, { bigint: true });
    jest
      .spyOn(
        jest.requireActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        ),
        "statfs",
      )
      .mockResolvedValue({ ...space, bsize: 4096n, bavail: 3n, ffree: 1024n });
    await expect(
      verifyImportedUpgradeImages(
        bundle,
        { run },
        { ...config, reserveBytes: 4096 },
      ),
    ).rejects.toThrow("docker_capacity");
    expect(run.mock.calls.some(([, args]) => args[0] === "load")).toBe(false);
  });
});
