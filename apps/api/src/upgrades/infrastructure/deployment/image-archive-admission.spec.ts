import {
  mkdtemp,
  open,
  writeFile,
  rm,
  type FileHandle,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { admitDockerSaveArchive } from "./image-archive-admission";
import { dockerSave, tar, sha } from "./__fixtures__/docker-save";
const limits = {
  maxLayerBytes: 1024 * 1024,
  maxLayerEntries: 100,
  maxOuterEntries: 100,
};
describe("streamed offline image archive admission", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "image-admission-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  async function admit(
    archive: Buffer,
    digest = dockerSave().digest,
    override: Partial<typeof limits> & {
      signal?: AbortSignal;
      deadline?: number;
    } = {},
  ) {
    const path = join(root, "image.tar");
    await writeFile(path, archive);
    const file = await open(path, "r");
    try {
      return await admitDockerSaveArchive(
        file,
        archive.length,
        { digest, platform: "linux/amd64" },
        { ...limits, ...override },
      );
    } finally {
      await file.close();
    }
  }
  it("admits exact singleimage config+rootfs hashes without extracting", async () => {
    const f = dockerSave();
    expect(await admit(f.archive, f.digest)).toEqual({
      layerBytes: f.layer.length,
      layerEntries: 2,
    });
  });
  it("rejects an otherwise signed gzip bomb named .tar before decoding", async () => {
    await expect(admit(gzipSync(Buffer.alloc(1024 * 1024)))).rejects.toThrow();
  });
  it("rejects compressed layer blobs even when their hash is signed", async () => {
    const f = dockerSave({ layer: gzipSync(Buffer.alloc(1024 * 1024)) });
    await expect(admit(f.archive, f.digest)).rejects.toThrow();
  });
  it("rejects wrongconfig/platform and multipleimages", async () => {
    const f = dockerSave();
    await expect(
      admit(f.archive, `sha256:${"0".repeat(64)}`),
    ).rejects.toThrow();
    const arm = dockerSave({ arch: "arm64" });
    await expect(admit(arm.archive, arm.digest)).rejects.toThrow();
    const multi = dockerSave({ multiple: true });
    await expect(admit(multi.archive, multi.digest)).rejects.toThrow();
  });
  it.each(["../outside", "/absolute", "a/../../escape"])(
    "rejects rootfs traversal %s",
    async (name) => {
      const f = dockerSave({ layer: tar([{ name, body: Buffer.from("x") }]) });
      await expect(admit(f.archive, f.digest)).rejects.toThrow();
    },
  );
  it.each(["1", "2", "3", "4", "6", "S", "x", "g"])(
    "rejects outer link/special/unsupportedheader %s",
    async (kind) => {
      const f = dockerSave({
        extra: [{ name: "extra", kind, link: "/etc/passwd" }],
      });
      await expect(admit(f.archive, f.digest)).rejects.toThrow();
    },
  );
  it("allows ordinary container-root symbolic/hardlinks without following them", async () => {
    const f = dockerSave({
      layer: tar([
        { name: "usr", kind: "5" },
        { name: "usr/bin", kind: "5" },
        { name: "usr/bin/tool", body: Buffer.from("ok") },
        { name: "bin", kind: "2", link: "usr/bin" },
        { name: "tool", kind: "1", link: "usr/bin/tool" },
        { name: "mounts", kind: "2", link: "/proc/mounts" },
      ]),
    });
    expect((await admit(f.archive, f.digest)).layerEntries).toBe(6);
  });
  it("rejects inner specials, escaping hardlinks and duplicate paths", async () => {
    for (const layer of [
      tar([{ name: "dev", kind: "3" }]),
      tar([{ name: "x", kind: "1", link: "../escape" }]),
      tar([{ name: "x" }, { name: "x" }]),
    ]) {
      const f = dockerSave({ layer });
      await expect(admit(f.archive, f.digest)).rejects.toThrow();
    }
  });
  it("rejects unrelated outer payload, truncation, wrongchecksum and decoded budgets", async () => {
    const f = dockerSave();
    await expect(
      admit(f.archive.subarray(0, -512), f.digest),
    ).rejects.toThrow();
    const damaged = Buffer.from(f.archive);
    damaged[0] = 100;
    await expect(admit(damaged, f.digest)).rejects.toThrow();
    const extra = dockerSave({
      extra: [{ name: "unlisted", body: Buffer.from("x") }],
    });
    await expect(admit(extra.archive, extra.digest)).rejects.toThrow();
    await expect(
      admit(f.archive, f.digest, { maxLayerBytes: 100 }),
    ).rejects.toThrow();
    await expect(
      admit(f.archive, f.digest, { maxLayerEntries: 1 }),
    ).rejects.toThrow();
  });
  it("honors cancellation and deadlines on parser reads", async () => {
    const f = dockerSave();
    const controller = new AbortController();
    controller.abort();
    await expect(
      admit(f.archive, f.digest, { signal: controller.signal }),
    ).rejects.toThrow("cancelled");
    await expect(admit(f.archive, f.digest, { deadline: 0 })).rejects.toThrow(
      "timeout",
    );
  });
  it("admits exact OCI-compatible uncompressed Docker-save inventory", async () => {
    const f = dockerSave();
    const configName = `blobs/sha256/${sha(f.config)}`,
      layerName = `blobs/sha256/${sha(f.layer)}`;
    const manifest = Buffer.from(
      JSON.stringify({
        schemaVersion: 2,
        mediaType: "application/vnd.oci.image.manifest.v1+json",
        config: {
          mediaType: "application/vnd.oci.image.config.v1+json",
          digest: f.digest,
          size: f.config.length,
        },
        layers: [
          {
            mediaType: "application/vnd.oci.image.layer.v1.tar",
            digest: `sha256:${sha(f.layer)}`,
            size: f.layer.length,
          },
        ],
      }),
    );
    const archive = tar([
      {
        name: "manifest.json",
        body: Buffer.from(
          JSON.stringify([
            { Config: configName, RepoTags: [], Layers: [layerName] },
          ]),
        ),
      },
      { name: configName, body: f.config },
      { name: layerName, body: f.layer },
      { name: `blobs/sha256/${sha(manifest)}`, body: manifest },
      {
        name: "oci-layout",
        body: Buffer.from('{"imageLayoutVersion":"1.0.0"}'),
      },
      {
        name: "index.json",
        body: Buffer.from(
          JSON.stringify({
            schemaVersion: 2,
            manifests: [
              {
                mediaType: "application/vnd.oci.image.manifest.v1+json",
                digest: `sha256:${sha(manifest)}`,
                size: manifest.length,
              },
            ],
          }),
        ),
      },
    ]);
    expect((await admit(archive, f.digest)).layerBytes).toBe(f.layer.length);
  });
  it("stops on authority loss during a chunk read, not merely at entry", async () => {
    const fixture = dockerSave();
    const path = join(root, "cancel.tar");
    await writeFile(path, fixture.archive);
    const file = await open(path, "r");
    const controller = new AbortController();
    let reads = 0;
    const watched = {
      read: async (
        buffer: Buffer,
        offset: number,
        length: number,
        position: number,
      ) => {
        const result = await file.read(buffer, offset, length, position);
        reads += 1;
        if (reads === 3) controller.abort();
        return result;
      },
    } as unknown as FileHandle;
    try {
      await expect(
        admitDockerSaveArchive(
          watched,
          fixture.archive.length,
          { digest: fixture.digest, platform: "linux/amd64" },
          { ...limits, signal: controller.signal },
        ),
      ).rejects.toThrow("cancelled");
      expect(reads).toBe(3);
    } finally {
      await file.close();
    }
  });
  it("validates legacy layer metadata and exact repository tag inventory", async () => {
    const f = dockerSave();
    const archive = (version: string, repository: string) =>
      tar([
        {
          name: "manifest.json",
          body: Buffer.from(
            JSON.stringify([
              {
                Config: f.configName,
                RepoTags: ["repo:tag"],
                Layers: ["layer/layer.tar"],
              },
            ]),
          ),
        },
        { name: f.configName, body: f.config },
        { name: "layer/layer.tar", body: f.layer },
        { name: "layer/VERSION", body: Buffer.from(version) },
        { name: "layer/json", body: Buffer.from("{}") },
        { name: "repositories", body: Buffer.from(repository) },
      ]);
    expect(
      (await admit(archive("1.0", '{"repo":{"tag":"layer"}}'), f.digest))
        .layerEntries,
    ).toBe(2);
    await expect(
      admit(archive("2.0", '{"repo":{"tag":"layer"}}'), f.digest),
    ).rejects.toThrow();
    await expect(
      admit(archive("1.0", '{"repo":{"tag":"other"}}'), f.digest),
    ).rejects.toThrow();
    await expect(admit(archive("1.0", "{}"), f.digest)).rejects.toThrow();
  });
  it("rejects nonzero trailing tar data and malformed link payloads", async () => {
    const f = dockerSave();
    await expect(
      admit(Buffer.concat([f.archive, Buffer.alloc(512, 1)]), f.digest),
    ).rejects.toThrow();
    for (const entry of [
      { name: "x", kind: "2", link: "../../escape" },
      { name: "x", kind: "2", link: "target", body: Buffer.from("unexpected") },
      { name: "x", kind: "1", link: "/absolute" },
    ]) {
      const invalid = dockerSave({ layer: tar([entry]) });
      await expect(admit(invalid.archive, invalid.digest)).rejects.toThrow();
    }
  });
});
