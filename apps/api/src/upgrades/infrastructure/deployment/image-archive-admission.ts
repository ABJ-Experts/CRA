/* eslint-disable no-control-regex -- Archive names and link targets must reject literal control bytes. */
import { createHash } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { posix } from "node:path";
import { z } from "zod";

interface TarEntry {
  readonly name: string;
  readonly size: number;
  readonly offset: number;
  readonly kind: string;
  readonly digest: string;
}
export interface ImageArchiveLimits {
  readonly maxLayerBytes: number;
  readonly maxLayerEntries: number;
  readonly maxOuterEntries: number;
  readonly signal?: AbortSignal;
  readonly deadline?: number;
}
interface Reader {
  readonly file: FileHandle;
  readonly signal?: AbortSignal;
  readonly deadline: number;
}
const alive = (reader: Reader) => {
  if (reader.signal?.aborted)
    throw new Error("upgrade_image_admission_cancelled");
  if (Date.now() > reader.deadline)
    throw new Error("upgrade_image_admission_timeout");
};
function fail(): never {
  throw new Error("upgrade_image_archive_unsupported_or_unsafe");
}
const compressed = (b: Buffer) =>
  b.subarray(0, 2).equals(Buffer.from([31, 139])) ||
  b.subarray(0, 3).toString() === "BZh" ||
  b.subarray(0, 6).equals(Buffer.from([253, 55, 122, 88, 90, 0])) ||
  b.subarray(0, 4).equals(Buffer.from([40, 181, 47, 253]));
const octal = (b: Buffer): number => {
  const text = b.toString("ascii").replace(/^[\0 ]+|[\0 ]+$/g, "");
  if (!/^[0-7]+$/.test(text)) fail();
  const value = parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
};
const field = (b: Buffer): string => {
  const end = b.indexOf(0);
  const bytes = end < 0 ? b : b.subarray(0, end);
  const text = bytes.toString("utf8");
  if (!Buffer.from(text).equals(bytes)) fail();
  return text;
};
function pathName(name: string): string {
  if (
    !name ||
    name.startsWith("/") ||
    name.includes("\\") ||
    /[\x00-\x1f\x7f]/.test(name) ||
    name.split("/").includes("..")
  )
    fail();
  const normalized = posix.normalize(name).replace(/\/$/, "");
  if (!normalized || normalized.startsWith("../")) fail();
  return normalized;
}
async function read(
  file: Reader,
  offset: number,
  length: number,
): Promise<Buffer> {
  const b = Buffer.alloc(length);
  let count = 0;
  while (count < length) {
    alive(file);
    const r = await file.file.read(b, count, length - count, offset + count);
    alive(file);
    if (!r.bytesRead) fail();
    count += r.bytesRead;
  }
  return b;
}
async function payloadHash(
  file: Reader,
  offset: number,
  size: number,
): Promise<string> {
  const hash = createHash("sha256");
  for (let n = 0; n < size; n += 65536)
    hash.update(await read(file, offset + n, Math.min(65536, size - n)));
  return hash.digest("hex");
}
/** Parses headers and meters payload without extracting or following a single path/link. */
async function scanTar(
  file: Reader,
  start: number,
  length: number,
  maxEntries: number,
  inner: boolean,
): Promise<readonly TarEntry[]> {
  if (
    length < 1024 ||
    length % 512 ||
    compressed(await read(file, start, Math.min(length, 8)))
  )
    fail();
  let position = 0;
  const entries: TarEntry[] = [];
  const seen = new Set<string>();
  let terminated = false;
  while (position < length) {
    const header = await read(file, start + position, 512);
    if (header.every((byte) => byte === 0)) {
      if (
        position + 1024 > length ||
        !(await read(file, start + position + 512, 512)).every(
          (byte) => byte === 0,
        )
      )
        fail();
      for (let tail = position + 1024; tail < length; tail += 65536)
        if (
          !(
            await read(file, start + tail, Math.min(65536, length - tail))
          ).every((byte) => byte === 0)
        )
          fail();
      terminated = true;
      break;
    }
    const checksum = octal(header.subarray(148, 156));
    const sum = header.reduce(
      (total, byte, index) => total + (index >= 148 && index < 156 ? 32 : byte),
      0,
    );
    if (checksum !== sum) fail();
    const magic = field(header.subarray(257, 263));
    if (magic && magic !== "ustar") fail();
    const prefix = field(header.subarray(345, 500));
    const name = pathName(
      `${prefix ? `${prefix}/` : ""}${field(header.subarray(0, 100))}`,
    );
    const size = octal(header.subarray(124, 136));
    const kind = String.fromCharCode(header[156] ?? 0);
    if (
      !["0", "\0", "5", ...(inner ? ["1", "2"] : [])].includes(kind) ||
      seen.has(name) ||
      entries.length >= maxEntries
    )
      fail();
    if (kind !== "0" && kind !== "\0" && size !== 0) fail();
    if (kind === "1" || kind === "2") {
      const target = field(header.subarray(157, 257));
      if (!target || target.includes("\\") || /[\x00-\x1f\x7f]/.test(target))
        fail();
      const resolved = posix.normalize(
        kind === "1" ? target : posix.join(posix.dirname(name), target),
      );
      if (
        (kind === "1" && target.startsWith("/")) ||
        (!target.startsWith("/") &&
          (resolved === ".." || resolved.startsWith("../")))
      )
        fail();
    }
    const padded = Math.ceil(size / 512) * 512;
    if (!Number.isSafeInteger(padded) || position + 512 + padded > length)
      fail();
    if (
      padded > size &&
      !(await read(file, start + position + 512 + size, padded - size)).every(
        (byte) => byte === 0,
      )
    )
      fail();
    seen.add(name);
    entries.push({
      name,
      size,
      kind,
      offset: start + position + 512,
      digest: await payloadHash(file, start + position + 512, size),
    });
    position += 512 + padded;
  }
  if (!terminated) fail();
  return entries;
}
const regular = (entry: TarEntry) => entry.kind === "0" || entry.kind === "\0";
async function json(
  file: Reader,
  entry: TarEntry | undefined,
): Promise<unknown> {
  if (!entry || !regular(entry) || entry.size > 1024 * 1024) fail();
  try {
    return JSON.parse(
      (await read(file, entry.offset, entry.size)).toString("utf8"),
    ) as unknown;
  } catch {
    return fail();
  }
}
const descriptor = z
  .object({
    mediaType: z.string(),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    size: z.number().int().nonnegative(),
  })
  .passthrough();

/** Classic Docker save and Docker-save OCI-compatible uncompressed layouts only. */
export async function admitDockerSaveArchive(
  handle: FileHandle,
  size: number,
  expected: { readonly digest: string; readonly platform: string },
  limits: ImageArchiveLimits,
): Promise<{ readonly layerBytes: number; readonly layerEntries: number }> {
  if (
    ![
      limits.maxLayerBytes,
      limits.maxLayerEntries,
      limits.maxOuterEntries,
    ].every((value) => Number.isSafeInteger(value) && value > 0)
  )
    fail();
  const file: Reader = {
    file: handle,
    signal: limits.signal,
    deadline: limits.deadline ?? Date.now() + 600_000,
  };
  const entries = await scanTar(file, 0, size, limits.maxOuterEntries, false);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const manifests = z
    .array(
      z
        .object({
          Config: z.string(),
          RepoTags: z.array(z.string()).nullable().optional(),
          Layers: z.array(z.string()).max(256),
        })
        .strict(),
    )
    .length(1)
    .parse(await json(file, byName.get("manifest.json")));
  const manifest = manifests[0]!;
  const configEntry = byName.get(pathName(manifest.Config));
  if (!configEntry || `sha256:${configEntry.digest}` !== expected.digest)
    fail();
  const config = z
    .object({
      os: z.literal("linux"),
      architecture: z.enum(["amd64", "arm64"]),
      rootfs: z
        .object({
          type: z.literal("layers"),
          diff_ids: z.array(z.string().regex(/^sha256:[a-f0-9]{64}$/)),
        })
        .passthrough(),
    })
    .passthrough()
    .parse(await json(file, configEntry));
  if (
    `${config.os}/${config.architecture}` !== expected.platform ||
    config.rootfs.diff_ids.length !== manifest.Layers.length ||
    new Set(manifest.Layers).size !== manifest.Layers.length
  )
    fail();
  const allowed = new Set(["manifest.json", configEntry.name]);
  let layerBytes = 0;
  let layerEntries = 0;
  for (const [index, name] of manifest.Layers.entries()) {
    const layer = byName.get(pathName(name));
    if (
      !layer ||
      !regular(layer) ||
      `sha256:${layer.digest}` !== config.rootfs.diff_ids[index]
    )
      fail();
    if (
      layer.size &&
      compressed(await read(file, layer.offset, Math.min(8, layer.size)))
    )
      fail();
    layerBytes += layer.size;
    if (layerBytes > limits.maxLayerBytes) fail();
    const contents = await scanTar(
      file,
      layer.offset,
      layer.size,
      limits.maxLayerEntries - layerEntries,
      true,
    );
    layerEntries += contents.length;
    allowed.add(layer.name);
    if (layer.name.endsWith("/layer.tar"))
      for (const metadata of ["VERSION", "json"]) {
        const path = `${posix.dirname(layer.name)}/${metadata}`;
        const entry = byName.get(path);
        if (entry) {
          if (!regular(entry) || entry.size > 1024 * 1024) fail();
          if (
            metadata === "VERSION" &&
            (await read(file, entry.offset, entry.size)).toString().trim() !==
              "1.0"
          )
            fail();
          if (metadata === "json") await json(file, entry);
          allowed.add(path);
        }
      }
  }
  if (byName.has("repositories")) {
    const repositories = z
      .record(z.string(), z.record(z.string(), z.string()))
      .parse(await json(file, byName.get("repositories")));
    const tags = Object.entries(repositories).flatMap(([repo, values]) =>
      Object.entries(values).map(([tag, id]) => ({
        tag: `${repo}:${tag}`,
        id,
      })),
    );
    const expectedTags = manifest.RepoTags ?? [];
    const last = manifest.Layers.at(-1);
    if (
      tags.length !== expectedTags.length ||
      tags.some(
        (tag) =>
          !expectedTags.includes(tag.tag) ||
          !last ||
          tag.id !== posix.dirname(last),
      )
    )
      fail();
    allowed.add("repositories");
  }
  if (byName.has("index.json") || byName.has("oci-layout")) {
    const layout = z
      .object({ imageLayoutVersion: z.literal("1.0.0") })
      .strict()
      .parse(await json(file, byName.get("oci-layout")));
    void layout;
    const index = z
      .object({
        schemaVersion: z.literal(2),
        manifests: z.array(descriptor).length(1),
      })
      .passthrough()
      .parse(await json(file, byName.get("index.json")));
    const md = index.manifests[0]!;
    if (
      md.mediaType !== "application/vnd.oci.image.manifest.v1+json" &&
      md.mediaType !== "application/vnd.docker.distribution.manifest.v2+json"
    )
      fail();
    const name = `blobs/sha256/${md.digest.slice(7)}`;
    const entry = byName.get(name);
    if (!entry || entry.size !== md.size || entry.digest !== md.digest.slice(7))
      fail();
    const document = z
      .object({
        schemaVersion: z.literal(2),
        config: descriptor,
        layers: z.array(descriptor),
      })
      .passthrough()
      .parse(await json(file, entry));
    if (
      ![
        "application/vnd.oci.image.config.v1+json",
        "application/vnd.docker.container.image.v1+json",
      ].includes(document.config.mediaType) ||
      configEntry.name !== `blobs/sha256/${document.config.digest.slice(7)}` ||
      document.config.digest !== expected.digest ||
      document.config.size !== configEntry.size ||
      document.layers.length !== manifest.Layers.length
    )
      fail();
    document.layers.forEach((layer, i) => {
      const blob = byName.get(manifest.Layers[i]!);
      if (
        ![
          "application/vnd.oci.image.layer.v1.tar",
          "application/vnd.docker.image.rootfs.diff.tar",
        ].includes(layer.mediaType) ||
        !blob ||
        blob.name !== `blobs/sha256/${layer.digest.slice(7)}` ||
        layer.size !== blob.size ||
        layer.digest !== `sha256:${blob.digest}`
      )
        fail();
    });
    allowed.add("index.json");
    allowed.add("oci-layout");
    allowed.add(name);
  }
  for (const entry of entries)
    if (
      !allowed.has(entry.name) &&
      !(
        entry.kind === "5" &&
        (entry.name === "." ||
          [...allowed].some((name) => name.startsWith(`${entry.name}/`)))
      )
    )
      fail();
  return { layerBytes, layerEntries };
}
