import { createHmac } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { isAbsolute, relative, resolve, join } from "node:path";
import { z } from "zod";
import { upgradeMediaListSchema } from "@repo/contracts/upgrades/schemas";
import {
  MountedUpgradeMediaVerifier,
  type ReleaseTrust,
  type VerifiedUpgradeBundle,
} from "../media/mounted-upgrade-media";
import { readUpgradeControlKey } from "./local-upgrade-control";
const path = z.string().min(1).refine(isAbsolute);
export const upgradeSupervisorMountSchema = z.strictObject({
  instanceId: z.uuid(),
  socketPath: path.max(100),
  controlKeyPath: path,
  journalKeyPath: path,
  journalRoot: path,
  minimumJournalSequence: z.number().int().nonnegative(),
  grantsPath: path,
  inboxRoot: path,
  stagingRoot: path,
  trustPath: path,
  protectedRoots: z.array(path).min(1).max(100),
  runtime: z.record(z.string(), z.json()),
});
export type UpgradeSupervisorMount = z.output<
  typeof upgradeSupervisorMountSchema
>;
export async function readPrivateUpgradeJson(file: string): Promise<unknown> {
  const fd = await open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await fd.stat();
    if (!stat.isFile() || stat.size > 1024 * 1024 || (stat.mode & 0o077) !== 0)
      throw new Error("upgrade_private_mount_required");
    const bytes = await fd.readFile();
    if (bytes.length !== stat.size) throw new Error("upgrade_mount_changed");
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } finally {
    await fd.close();
  }
}
function overlaps(a: string, b: string) {
  const rel = relative(resolve(a), resolve(b));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
export async function loadUpgradeSupervisorRuntime(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
) {
  if (env.UPGRADE_SUPERVISOR_ENABLED !== "true") return null;
  if (platform !== "linux") throw new Error("upgrade_linux_required");
  const config = upgradeSupervisorMountSchema.parse(
    await readPrivateUpgradeJson(
      path.parse(env.UPGRADE_SUPERVISOR_CONFIG_PATH),
    ),
  );
  const privateRoots = [config.journalRoot, config.stagingRoot];
  for (const root of privateRoots) {
    const stat = await lstat(root);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o077) !== 0 ||
      config.protectedRoots.some(
        (other) => overlaps(other, root) || overlaps(root, other),
      )
    )
      throw new Error("upgrade_private_root_required");
  }
  if (
    overlaps(config.journalRoot, config.stagingRoot) ||
    overlaps(config.stagingRoot, config.journalRoot) ||
    overlaps(config.inboxRoot, config.journalRoot) ||
    overlaps(config.journalRoot, config.inboxRoot)
  )
    throw new Error("upgrade_root_overlap");
  const [controlKey, journalKey] = await Promise.all([
    readUpgradeControlKey(config.controlKeyPath),
    readUpgradeControlKey(config.journalKeyPath),
  ]);
  return { config, controlKey, journalKey };
}
const trustSchema = z.strictObject({
  version: z.number().int().positive(),
  minimumVersion: z.number().int().positive(),
  keys: z
    .array(
      z.strictObject({
        kid: z.string(),
        issuer: z.string(),
        publicKey: z.string(),
        notBefore: z.iso.datetime({ offset: true }),
        notAfter: z.iso.datetime({ offset: true }),
        revoked: z.boolean(),
      }),
    )
    .max(100),
});
/** Opaque IDs remain stable across supervisor restart; paths never cross the wire. */
export class SupervisorMountedMedia {
  constructor(
    private readonly config: Pick<
      UpgradeSupervisorMount,
      "instanceId" | "inboxRoot" | "stagingRoot" | "trustPath"
    >,
    private readonly key: Buffer,
  ) {}
  private id(alias: string) {
    const bytes = createHmac("sha256", this.key)
      .update(`CRA-UPGRADE-MEDIA-V1\0${this.config.instanceId}\0${alias}`)
      .digest()
      .subarray(0, 16);
    bytes[6] = (bytes[6]! & 15) | 64;
    bytes[8] = (bytes[8]! & 63) | 128;
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  private async verifier() {
    const trust: ReleaseTrust = trustSchema.parse(
      await readPrivateUpgradeJson(this.config.trustPath),
    );
    return new MountedUpgradeMediaVerifier({ ...this.config, trust });
  }
  async list() {
    const aliases = await (await this.verifier()).listAliases();
    const items = await Promise.all(
      aliases.map(async (alias) => {
        const stat = await lstat(
          join(this.config.inboxRoot, alias, "payload.tar"),
        );
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0)
          throw new Error("upgrade_media_invalid");
        return {
          id: this.id(alias),
          label: alias,
          discoveredAt: stat.mtime.toISOString(),
          bytes: stat.size,
        };
      }),
    );
    return upgradeMediaListSchema.parse({ items });
  }
  async revalidate(bundle: VerifiedUpgradeBundle) {
    return (await this.verifier()).revalidate(bundle);
  }
  async verify(id: string) {
    z.uuid().parse(id);
    const verifier = await this.verifier();
    const alias = (await verifier.listAliases()).find(
      (value) => this.id(value) === id,
    );
    if (!alias) throw new Error("upgrade_media_unknown");
    return verifier.verify(alias);
  }
}
