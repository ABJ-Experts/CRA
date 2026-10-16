import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, mkdir, readdir, rm, rename } from "node:fs/promises";
import { join } from "node:path";
import type { BackupCertificate } from "../../../backups/application/backup-execution.port";
import { BackupExecutionError } from "../../../backups/application/backup-execution.port";

export interface UpgradeHold {
  readonly version: 1;
  readonly instanceId: string;
  readonly journalBinding: string;
  readonly upgradeRunId: string;
  readonly captureRunId: string;
  readonly verifiedChildRunId: string;
  readonly certificateDigest: string;
  readonly dependencyRunIds: readonly string[];
  readonly partIds: readonly string[];
  readonly keyIds: readonly string[];
}
export interface UpgradeHoldAuthority {
  readonly instanceId: string;
  readonly journalBinding: string;
  readonly hostKey: Buffer;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fail = (): never => {
  throw new BackupExecutionError("upgrade_hold_authority_unknown");
};
const mac = (hold: UpgradeHold, key: Buffer) =>
  createHmac("sha256", key)
    .update("CRA-UPGRADE-BACKUP-HOLD-V1\0")
    .update(JSON.stringify(hold))
    .digest("hex");
export async function readAuthenticatedUpgradeHolds(
  repositoryPath: string,
  authority?: UpgradeHoldAuthority,
): Promise<readonly UpgradeHold[]> {
  const directory = join(repositoryPath, "upgrade-holds");
  const names = await readdir(directory).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  if (names.length === 0) return [];
  if (!authority || authority.hostKey.length < 32 || names.length > 10000)
    return fail();
  const holds: UpgradeHold[] = [];
  for (const name of names) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) return fail();
    const file = await open(
      join(directory, name),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    let parsed: { hold: UpgradeHold; authentication: string };
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 1024 * 1024) return fail();
      parsed = JSON.parse(await file.readFile("utf8")) as typeof parsed;
    } finally {
      await file.close();
    }
    const { hold, authentication } = parsed;
    if (
      !hold ||
      hold.version !== 1 ||
      hold.instanceId !== authority.instanceId ||
      hold.journalBinding !== authority.journalBinding ||
      hold.upgradeRunId !== name.slice(0, -5) ||
      !uuid.test(hold.upgradeRunId) ||
      !uuid.test(hold.captureRunId) ||
      !uuid.test(hold.verifiedChildRunId) ||
      !/^[a-f0-9]{64}$/.test(hold.certificateDigest) ||
      !Array.isArray(hold.dependencyRunIds) ||
      !Array.isArray(hold.partIds) ||
      !Array.isArray(hold.keyIds) ||
      !hold.dependencyRunIds.every(
        (id: unknown) => typeof id === "string" && uuid.test(id),
      ) ||
      !hold.partIds.every(
        (id: unknown) => typeof id === "string" && uuid.test(id),
      ) ||
      !hold.keyIds.every(
        (id) => typeof id === "string" && id.length > 0 && id.length < 256,
      ) ||
      typeof authentication !== "string" ||
      !/^[a-f0-9]{64}$/.test(authentication)
    )
      return fail();
    if (
      !timingSafeEqual(
        Buffer.from(authentication, "hex"),
        Buffer.from(mac(hold, authority.hostKey), "hex"),
      )
    )
      return fail();
    holds.push(hold);
  }
  return holds;
}
export async function assertUpgradeCleanupAllowed(
  repositoryPath: string,
  runId: string,
  partIds: readonly string[],
  authority?: UpgradeHoldAuthority,
): Promise<void> {
  const holds = await readAuthenticatedUpgradeHolds(repositoryPath, authority);
  if (
    holds.some(
      (hold) =>
        hold.dependencyRunIds.includes(runId) ||
        hold.partIds.some((id) => partIds.includes(id)),
    )
  )
    throw new BackupExecutionError("required_dependency");
}

/** The publication lock covers validation plus durable pin publication, never the upgrade itself. */
export class AuthenticatedUpgradeBackupHold {
  constructor(
    private readonly configuration: UpgradeHoldAuthority & {
      readonly repositoryPath: string;
      readonly loadCertificate: (
        runId: string,
        signal: AbortSignal,
      ) => Promise<BackupCertificate>;
      readonly assertVerifiedChild: (
        captureRunId: string,
        childRunId: string,
        digest: string,
        signal: AbortSignal,
      ) => Promise<void>;
      readonly authenticateParts: (
        certificate: BackupCertificate,
        signal: AbortSignal,
      ) => Promise<void>;
    },
  ) {}
  async acquire(
    input: Pick<
      UpgradeHold,
      | "upgradeRunId"
      | "captureRunId"
      | "verifiedChildRunId"
      | "certificateDigest"
    >,
    signal: AbortSignal,
    replaceExisting = false,
  ): Promise<UpgradeHold> {
    for (const id of [
      input.upgradeRunId,
      input.captureRunId,
      input.verifiedChildRunId,
    ])
      if (!uuid.test(id)) return fail();
    if (this.configuration.hostKey.length < 32) return fail();
    // Stream potentially large material before taking the shared publication lock.
    // Re-load the authenticated immutable certificate under lock before pinning.
    const checked = await this.configuration.loadCertificate(
      input.captureRunId,
      signal,
    );
    if (
      checked.instanceId !== this.configuration.instanceId ||
      checked.runId !== input.captureRunId ||
      checked.certificateDigest !== input.certificateDigest
    )
      return fail();
    await this.configuration.authenticateParts(checked, signal);
    return this.withLock(async () => {
      signal.throwIfAborted();
      const existing = await readAuthenticatedUpgradeHolds(
        this.configuration.repositoryPath,
        this.configuration,
      );
      const prior = existing.find(
        (hold) => hold.upgradeRunId === input.upgradeRunId,
      );
      if (prior && !replaceExisting) {
        if (
          prior.captureRunId !== input.captureRunId ||
          prior.verifiedChildRunId !== input.verifiedChildRunId ||
          prior.certificateDigest !== input.certificateDigest
        )
          return fail();
        return prior;
      }
      const certificate = await this.configuration.loadCertificate(
        input.captureRunId,
        signal,
      );
      if (
        certificate.instanceId !== this.configuration.instanceId ||
        certificate.runId !== input.captureRunId ||
        certificate.certificateDigest !== input.certificateDigest
      )
        return fail();
      await this.configuration.assertVerifiedChild(
        input.captureRunId,
        input.verifiedChildRunId,
        input.certificateDigest,
        signal,
      );

      signal.throwIfAborted();
      const hold: UpgradeHold = {
        version: 1,
        instanceId: this.configuration.instanceId,
        journalBinding: this.configuration.journalBinding,
        ...input,
        dependencyRunIds: [
          ...new Set([
            input.captureRunId,
            input.verifiedChildRunId,
            certificate.baseRunId ?? input.captureRunId,
            ...(prior?.dependencyRunIds ?? []),
          ]),
        ],
        partIds: [
          ...new Set([
            ...certificate.parts.map((part) => part.id),
            ...(prior?.partIds ?? []),
          ]),
        ],
        keyIds: [
          ...new Set([
            certificate.keyId,
            ...certificate.parts.map((part) => part.keyId ?? certificate.keyId),
            ...(prior?.keyIds ?? []),
          ]),
        ],
      };
      const root = join(this.configuration.repositoryPath, "upgrade-holds");
      await mkdir(root, { recursive: true, mode: 0o700 });
      const finalPath = join(root, `${input.upgradeRunId}.json`);
      const writePath = prior
        ? join(root, `${randomUUID()}.pending`)
        : finalPath;
      const file = await open(writePath, "wx", 0o600);
      try {
        await file.writeFile(
          JSON.stringify({
            hold,
            authentication: mac(hold, this.configuration.hostKey),
          }),
        );
        await file.sync();
      } finally {
        await file.close();
      }
      if (prior) await rename(writePath, finalPath);
      await this.sync(root);
      await this.sync(this.configuration.repositoryPath);
      return hold;
    });
  }
  async assertHeld(
    upgradeRunId: string,
    signal: AbortSignal,
  ): Promise<UpgradeHold> {
    signal.throwIfAborted();
    const hold = (
      await readAuthenticatedUpgradeHolds(
        this.configuration.repositoryPath,
        this.configuration,
      )
    ).find((item) => item.upgradeRunId === upgradeRunId);
    if (!hold) return fail();
    return hold;
  }
  async release(upgradeRunId: string, signal: AbortSignal): Promise<void> {
    await this.withLock(async () => {
      await this.assertHeld(upgradeRunId, signal);
      await rm(
        join(
          this.configuration.repositoryPath,
          "upgrade-holds",
          `${upgradeRunId}.json`,
        ),
      );
      await this.sync(join(this.configuration.repositoryPath, "upgrade-holds"));
    });
  }
  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const path = join(this.configuration.repositoryPath, ".publication.lock");
    const lock = await open(path, "wx", 0o600).catch(() => {
      throw new BackupExecutionError("conflict");
    });
    try {
      await lock.writeFile(JSON.stringify({ kind: "upgrade-hold" }));
      await lock.sync();
      return await operation();
    } finally {
      await lock.close();
      await rm(path);
    }
  }
  private async sync(path: string): Promise<void> {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}
