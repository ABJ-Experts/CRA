import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import { constants } from "node:fs";
import { open, mkdir, lstat, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  upgradeJwsHeaderSchema,
  upgradeManifestSchema,
} from "@repo/contracts/upgrades/schemas";
import type { UpgradeManifest } from "@repo/contracts/upgrades/types";
import { extractRecoveryTar } from "../../../backups/infrastructure/restore/safe-tar-extractor";

export interface ReleaseTrust {
  readonly version: number;
  readonly minimumVersion: number;
  readonly keys: readonly {
    readonly kid: string;
    readonly issuer: string;
    readonly publicKey: string;
    readonly notBefore: string;
    readonly notAfter: string;
    readonly revoked: boolean;
  }[];
}
export interface VerifiedUpgradeBundle {
  readonly manifest: UpgradeManifest;
  readonly manifestDigest: string;
  readonly stagingId: string;
  /** Private executor paths. Never serialize through operator API. */
  readonly archivePath: string;
  readonly extractedRoot: string;
}
interface Configuration {
  readonly inboxRoot: string;
  readonly stagingRoot: string;
  readonly trust: ReleaseTrust;
  readonly now?: () => number;
  readonly maxArchiveBytes?: number;
  readonly maxExpandedBytes?: number;
}
const fail = (): never => {
  throw new Error("upgrade_media_invalid");
};
const digest = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");
const MAX_JWS = 256 * 1024;
const DEFAULT_LIMIT = 8 * 1024 ** 3;

async function directory(path: string, privateOnly = false): Promise<void> {
  const stat = await lstat(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (privateOnly && (stat.mode & 0o077) !== 0)
  )
    fail();
}
async function flushDirectory(path: string): Promise<void> {
  const fd = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY,
  );
  try {
    await fd.sync();
  } finally {
    await fd.close();
  }
}
async function boundedCopy(
  source: string,
  target: string,
  limit: number,
): Promise<{ bytes: number; sha256: string }> {
  const input = await open(
    source,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await input.stat();
    if (!stat.isFile() || stat.size > limit || stat.size === 0) fail();
    const output = await open(
      target,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    );
    let total = 0;
    const hash = createHash("sha256");
    try {
      for (;;) {
        const chunk = Buffer.alloc(Math.min(65536, limit - total + 1));
        const { bytesRead } = await input.read(chunk, 0, chunk.length, null);
        if (!bytesRead) break;
        total += bytesRead;
        if (total > limit) fail();
        const bytes = chunk.subarray(0, bytesRead);
        hash.update(bytes);
        await output.writeFile(bytes);
      }
      if (total !== stat.size) fail();
      await output.sync();
    } finally {
      await output.close();
    }
    return { bytes: total, sha256: hash.digest("hex") };
  } finally {
    await input.close();
  }
}
async function boundedRead(path: string, limit: number): Promise<Buffer> {
  const fd = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await fd.stat();
    if (!stat.isFile() || stat.size > limit) fail();
    const bytes = Buffer.alloc(limit + 1);
    const result = await fd.read(bytes, 0, bytes.length, 0);
    if (result.bytesRead !== stat.size || result.bytesRead > limit) fail();
    return bytes.subarray(0, result.bytesRead);
  } finally {
    await fd.close();
  }
}
async function hashFile(
  path: string,
  limit: number,
): Promise<{ sha256: string; bytes: number }> {
  const fd = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await fd.stat();
    if (!stat.isFile() || stat.size > limit) fail();
    const hash = createHash("sha256");
    let bytes = 0;
    for (;;) {
      const chunk = Buffer.alloc(65536);
      const result = await fd.read(chunk, 0, chunk.length, null);
      if (!result.bytesRead) break;
      bytes += result.bytesRead;
      if (bytes > limit) fail();
      hash.update(chunk.subarray(0, result.bytesRead));
    }
    if (bytes !== stat.size) fail();
    return { bytes, sha256: hash.digest("hex") };
  } finally {
    await fd.close();
  }
}
function decode(segment: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) fail();
  const bytes = Buffer.from(segment, "base64url");
  if (bytes.toString("base64url") !== segment) fail();
  return bytes;
}

export class MountedUpgradeMediaVerifier {
  constructor(private readonly config: Configuration) {}
  async listAliases(): Promise<readonly string[]> {
    await directory(this.config.inboxRoot);
    const entries = await readdir(this.config.inboxRoot, {
      withFileTypes: true,
    });
    if (entries.length > 100) fail();
    return entries
      .filter(
        (item) =>
          item.isDirectory() &&
          /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(item.name),
      )
      .map((item) => item.name)
      .sort();
  }
  private verifyManifest(compact: Buffer): {
    manifest: UpgradeManifest;
    manifestDigest: string;
  } {
    if (compact.length > MAX_JWS) fail();
    const parts = compact.toString("utf8").split(".");
    if (parts.length !== 3) fail();
    const [protectedHeader, payloadSegment, signature] = parts as [
      string,
      string,
      string,
    ];
    const header = upgradeJwsHeaderSchema.parse(
      JSON.parse(decode(protectedHeader).toString("utf8")),
    );
    const payload = decode(payloadSegment);
    const manifest = upgradeManifestSchema.parse(
      JSON.parse(payload.toString("utf8")),
    );
    const now = this.config.now?.() ?? Date.now();
    const trust = this.config.trust;
    if (
      !Number.isSafeInteger(trust.version) ||
      !Number.isSafeInteger(trust.minimumVersion) ||
      trust.minimumVersion < 1 ||
      trust.version < trust.minimumVersion ||
      trust.keys.length > 100
    )
      fail();
    const matches = trust.keys.filter(
      (key) => key.kid === header.kid && key.issuer === manifest.issuer,
    );
    if (matches.length !== 1) fail();
    const key = matches[0] ?? fail();
    const before = Date.parse(key.notBefore),
      after = Date.parse(key.notAfter);
    if (
      key.revoked ||
      !Number.isFinite(before) ||
      !Number.isFinite(after) ||
      now < before ||
      now >= after ||
      Date.parse(manifest.issuedAt) > now ||
      Date.parse(manifest.expiresAt) <= now ||
      Date.parse(manifest.issuedAt) < before ||
      Date.parse(manifest.expiresAt) > after
    )
      fail();
    const publicKey = createPublicKey(key.publicKey);
    if (
      publicKey.asymmetricKeyType !== "ed25519" ||
      !verify(
        null,
        Buffer.from(`${parts[0]}.${parts[1]}`),
        publicKey,
        decode(signature),
      )
    )
      fail();
    return { manifest, manifestDigest: digest(payload) };
  }
  private async verifyInventory(
    manifest: UpgradeManifest,
    extractedRoot: string,
  ): Promise<void> {
    await directory(extractedRoot, true);
    // Canonical release inventory is flat: image archives and migration SQL only.
    const expected = [
      ...manifest.artifacts,
      ...manifest.images.map((image) => ({
        name: image.archive.name,
        sha256: image.archive.sha256,
        bytes: image.archive.bytes,
      })),
      ...manifest.migrations.map((migration) => ({
        name: migration.name,
        sha256: migration.sha256,
        bytes: undefined,
      })),
    ];
    const names = await readdir(extractedRoot);
    if (
      names.length !== expected.length ||
      new Set(expected.map((item) => item.name)).size !== expected.length
    )
      fail();
    for (const item of expected) {
      if (!names.includes(item.name)) fail();
      const content = await hashFile(
        join(extractedRoot, item.name),
        item.bytes ?? 16 * 1024 * 1024,
      );
      if (
        content.sha256 !== item.sha256 ||
        (item.bytes !== undefined && content.bytes !== item.bytes)
      )
        fail();
    }
  }
  async revalidate(bundle: VerifiedUpgradeBundle): Promise<void> {
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        bundle.stagingId,
      )
    )
      fail();
    await directory(this.config.stagingRoot, true);
    const stage = join(this.config.stagingRoot, bundle.stagingId);
    await directory(stage, true);
    const archivePath = join(stage, "payload.tar");
    const extractedRoot = join(stage, "content");
    if (
      bundle.archivePath !== archivePath ||
      bundle.extractedRoot !== extractedRoot
    )
      fail();
    const verified = this.verifyManifest(
      await boundedRead(join(stage, "release.jws"), MAX_JWS),
    );
    if (
      verified.manifestDigest !== bundle.manifestDigest ||
      JSON.stringify(verified.manifest) !== JSON.stringify(bundle.manifest)
    )
      fail();
    const archive = await hashFile(
      archivePath,
      verified.manifest.archive.bytes,
    );
    if (
      archive.bytes !== verified.manifest.archive.bytes ||
      archive.sha256 !== verified.manifest.archive.sha256
    )
      fail();
    await this.verifyInventory(verified.manifest, extractedRoot);
  }
  async verify(alias: string): Promise<VerifiedUpgradeBundle> {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(alias)) fail();
    await directory(this.config.inboxRoot);
    await directory(this.config.stagingRoot, true);
    const source = await open(
      join(this.config.inboxRoot, alias),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY,
    );
    const stagingId = randomUUID();
    const stage = join(this.config.stagingRoot, stagingId);
    let created = false;
    try {
      await mkdir(stage, { mode: 0o700 });
      created = true;
      // Anchor all subsequent opens to the already-open directory inode.
      const anchored =
        process.platform === "linux"
          ? `/proc/self/fd/${source.fd}`
          : join(this.config.inboxRoot, alias);
      await boundedCopy(
        join(anchored, "release.jws"),
        join(stage, "release.jws"),
        MAX_JWS,
      );
      await flushDirectory(stage);
      const verified = this.verifyManifest(
        await boundedRead(join(stage, "release.jws"), MAX_JWS),
      );
      const { manifest } = verified;
      if (
        manifest.archive.bytes >
          (this.config.maxArchiveBytes ?? DEFAULT_LIMIT) ||
        manifest.archive.expandedBytes >
          (this.config.maxExpandedBytes ?? DEFAULT_LIMIT)
      )
        fail();
      const archivePath = join(stage, "payload.tar");
      const copied = await boundedCopy(
        join(anchored, "payload.tar"),
        archivePath,
        manifest.archive.bytes,
      );
      await flushDirectory(stage);
      if (
        copied.bytes !== manifest.archive.bytes ||
        copied.sha256 !== manifest.archive.sha256
      )
        fail();
      const extractedRoot = join(stage, "content");
      const extracted = await extractRecoveryTar(archivePath, extractedRoot, {
        maxEntries: manifest.archive.entryCount,
        maxExpandedBytes: manifest.archive.expandedBytes,
      });
      if (
        extracted.entries !== manifest.archive.entryCount ||
        extracted.bytes !== manifest.archive.expandedBytes
      )
        fail();
      await this.verifyInventory(manifest, extractedRoot);
      await flushDirectory(extractedRoot);
      await flushDirectory(stage);
      await flushDirectory(this.config.stagingRoot);
      const current = await lstat(join(this.config.inboxRoot, alias));
      const pinned = await source.stat();
      if (
        current.isSymbolicLink() ||
        current.ino !== pinned.ino ||
        current.dev !== pinned.dev
      )
        fail();
      return { ...verified, stagingId, archivePath, extractedRoot };
    } catch (error) {
      if (created) {
        await rm(stage, { recursive: true, force: true });
        await flushDirectory(this.config.stagingRoot);
      }
      throw error;
    } finally {
      await source.close();
    }
  }
}
