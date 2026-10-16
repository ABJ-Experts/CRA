import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, statfs } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { VerifiedUpgradeBundle } from "../media/mounted-upgrade-media";
import type { NativeCommandRunner } from "./linux-deployment.adapter";
import { admitDockerSaveArchive } from "./image-archive-admission";
export interface UpgradeImageAdmissionConfiguration {
  readonly dockerExecutable: string;
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly maxLayerBytes?: number;
  readonly maxLayerEntries?: number;
  readonly reserveBytes?: number;
  readonly admissionTimeoutMs?: number;
}
interface AdmittedImage {
  readonly path: string;
  readonly digest: string;
  readonly layerBytes: number;
  readonly layerEntries: number;
}
async function admittedImages(
  bundle: VerifiedUpgradeBundle,
  config: UpgradeImageAdmissionConfiguration,
  runner: NativeCommandRunner,
): Promise<readonly AdmittedImage[]> {
  const timeout = config.admissionTimeoutMs ?? 600_000;
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 900_000)
    throw new Error("upgrade_image_admission_budget");
  const deadline = Date.now() + timeout;
  const active = () => {
    runner.assertActive?.();
    if (runner.signal?.aborted)
      throw new Error("upgrade_image_admission_cancelled");
    if (Date.now() > deadline)
      throw new Error("upgrade_image_admission_timeout");
  };
  active();
  const root = await realpath(bundle.extractedRoot);
  const rootStat = await lstat(bundle.extractedRoot);
  if (
    !rootStat.isDirectory() ||
    rootStat.isSymbolicLink() ||
    (rootStat.mode & 0o077) !== 0
  )
    throw new Error("upgrade_image_staging_directory");
  const maxLayerBytes = Math.min(
    bundle.manifest.requirements.diskBytes,
    config.maxLayerBytes ?? 16 * 1024 ** 3,
  );
  const maxLayerEntries = config.maxLayerEntries ?? 250_000;
  const result: AdmittedImage[] = [];
  let bytes = 0;
  let entries = 0;
  for (const image of bundle.manifest.images) {
    if (!/^[a-zA-Z0-9._-]+$/.test(image.archive.name))
      throw new Error("upgrade_image_archive_name");
    const path = join(root, image.archive.name);
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (
        !stat.isFile() ||
        stat.size !== image.archive.bytes ||
        (stat.mode & 0o022) !== 0
      )
        throw new Error("upgrade_image_archive_metadata");
      const hash = createHash("sha256");
      for await (const chunk of file.createReadStream({ autoClose: false })) {
        active();
        hash.update(chunk as Buffer);
      }
      if (hash.digest("hex") !== image.archive.sha256)
        throw new Error("upgrade_image_archive_digest");
      const admitted = await admitDockerSaveArchive(
        file,
        stat.size,
        {
          digest: image.digest,
          platform: `${bundle.manifest.platform.os}/${bundle.manifest.platform.architecture}`,
        },
        {
          maxLayerBytes,
          maxLayerEntries,
          maxOuterEntries: 4096,
          signal: runner.signal,
          deadline,
        },
      );
      bytes += admitted.layerBytes;
      entries += admitted.layerEntries;
      if (bytes > maxLayerBytes || entries > maxLayerEntries)
        throw new Error("upgrade_image_expansion_budget");
      result.push({ path, digest: image.digest, ...admitted });
    } finally {
      await file.close();
    }
  }
  return result;
}
async function capacity(
  images: readonly AdmittedImage[],
  runner: NativeCommandRunner,
  config: UpgradeImageAdmissionConfiguration,
  importedRequirement?: number,
): Promise<number> {
  const environment = config.environment;
  if (
    (environment.DOCKER_HOST &&
      !environment.DOCKER_HOST.startsWith("unix:///")) ||
    environment.DOCKER_TLS_VERIFY ||
    environment.DOCKER_CERT_PATH
  )
    throw new Error("upgrade_image_remote_daemon");
  const options = { cwd: config.cwd, environment };
  const endpoint: unknown = JSON.parse(
    await runner.run(
      config.dockerExecutable,
      ["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"],
      options,
    ),
  );
  if (typeof endpoint !== "string" || !endpoint.startsWith("unix:///"))
    throw new Error("upgrade_image_remote_daemon");
  const info = z
    .object({
      DockerRootDir: z.string().startsWith("/"),
      OSType: z.literal("linux"),
    })
    .passthrough()
    .parse(
      JSON.parse(
        await runner.run(
          config.dockerExecutable,
          ["info", "--format", "{{json .}}"],
          options,
        ),
      ),
    );
  const root = await realpath(info.DockerRootDir);
  const stat = await lstat(info.DockerRootDir);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error("upgrade_image_docker_root");
  const space = await statfs(root, { bigint: true });
  const free = space.bavail * space.bsize;
  const reserve = config.reserveBytes ?? 256 * 1024 ** 2;
  if (!Number.isSafeInteger(reserve) || reserve < 0)
    throw new Error("upgrade_image_space_budget");
  // Reserve both import/storage copies and per-entry filesystem block allocation.
  const allocation = images.reduce(
    (sum, image) =>
      sum +
      2n * BigInt(image.layerBytes) +
      2n * BigInt(image.layerEntries) * space.bsize,
    0n,
  );
  const remaining =
    importedRequirement === undefined
      ? 0n
      : BigInt(importedRequirement) - allocation;
  const required =
    importedRequirement === undefined
      ? allocation + BigInt(reserve)
      : remaining > BigInt(reserve)
        ? remaining
        : BigInt(reserve);
  const requiredInodes =
    importedRequirement === undefined
      ? images.reduce(
          (sum, image) => sum + 2n * BigInt(image.layerEntries),
          1024n,
        )
      : 1024n;
  // Zero inode availability is unknown or exhausted: both block admission.
  if (space.ffree <= 0n || space.ffree < requiredInodes)
    throw new Error("upgrade_image_docker_inode_capacity");
  if (free < required) throw new Error("upgrade_image_docker_capacity");
  return Number(required);
}
/** Read-only admission used during review; no Docker mutation or extraction. */
export async function admitVerifiedUpgradeImages(
  bundle: VerifiedUpgradeBundle,
  runner: NativeCommandRunner,
  config: UpgradeImageAdmissionConfiguration,
): Promise<void> {
  const images = await admittedImages(bundle, config, runner);
  await capacity(images, runner, config);
}
/** Repeats admission and Docker-root capacity under admitted execution intent before the first load. */
export async function loadVerifiedUpgradeImages(
  bundle: VerifiedUpgradeBundle,
  runner: NativeCommandRunner,
  config: UpgradeImageAdmissionConfiguration,
): Promise<void> {
  const images = await admittedImages(bundle, config, runner);
  await capacity(images, runner, config);
  for (const image of images) {
    await runner.run(config.dockerExecutable, ["load", "--input", image.path], {
      cwd: config.cwd,
      environment: config.environment,
    });
    await verifyLoadedImage(image, bundle, runner, config);
  }
}
async function verifyLoadedImage(
  image: AdmittedImage,
  bundle: VerifiedUpgradeBundle,
  runner: NativeCommandRunner,
  config: UpgradeImageAdmissionConfiguration,
): Promise<void> {
  const loaded = z
    .array(
      z
        .object({ Id: z.string(), Os: z.string(), Architecture: z.string() })
        .passthrough(),
    )
    .length(1)
    .parse(
      JSON.parse(
        await runner.run(
          config.dockerExecutable,
          ["image", "inspect", image.digest],
          { cwd: config.cwd, environment: config.environment },
        ),
      ),
    )[0]!;
  if (
    loaded.Id !== image.digest ||
    `${loaded.Os}/${loaded.Architecture}` !==
      `${bundle.manifest.platform.os}/${bundle.manifest.platform.architecture}`
  )
    throw new Error("upgrade_loaded_image_substitution");
}
/** Revalidate imported identity and remaining resources; never reserves a second import. */
export async function verifyImportedUpgradeImages(
  bundle: VerifiedUpgradeBundle,
  runner: NativeCommandRunner,
  config: UpgradeImageAdmissionConfiguration,
): Promise<{ requiredRemainingBytes: number }> {
  const images = await admittedImages(bundle, config, runner);
  for (const image of images)
    await verifyLoadedImage(image, bundle, runner, config);
  const requiredRemainingBytes = await capacity(
    images,
    runner,
    config,
    bundle.manifest.requirements.diskBytes,
  );
  return { requiredRemainingBytes };
}
