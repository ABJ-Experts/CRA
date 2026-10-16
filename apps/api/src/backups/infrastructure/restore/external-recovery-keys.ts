import { constants } from "node:fs";
import { open, readFile, rm, writeFile } from "node:fs/promises";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import type {
  BackupEncryptedPart,
  BackupInventory,
} from "../../application/backup-execution.port";
import { BackupExecutionError } from "../../application/backup-execution.port";

export interface ExternalRecoveryKeyMount {
  readonly path: string;
  readonly targetPath: string;
}

/** Old certificates must not bypass key checks merely by omitting their canary list. */
export function assertRecoveryKeyDependencies(
  databases: Readonly<Record<string, unknown>>,
  checks: BackupInventory["externalKeyChecks"],
): void {
  const required = Object.values(databases).some((database) => {
    if (!database || typeof database !== "object") return false;
    const extensions = (database as Record<string, unknown>).extensions;
    return (
      Array.isArray(extensions) &&
      extensions.some(
        (extension: unknown) =>
          extension !== null &&
          typeof extension === "object" &&
          "name" in extension &&
          ["pgsodium", "supabase_vault"].includes(String(extension.name)),
      )
    );
  });
  if (required && !checks.some((check) => check.alias === "pgsodium"))
    throw new BackupExecutionError("recovery_key_unavailable");
}

/** The repository contains an authenticated canary, never an external recovery key. */
export async function prepareExternalRecoveryKeys(
  inventory: Pick<BackupInventory, "externalKeyChecks">,
  parts: readonly BackupEncryptedPart[],
  mounts: Readonly<Record<string, ExternalRecoveryKeyMount>>,
  directory: string,
  materialize: (
    part: BackupEncryptedPart,
    path: string,
    signal: AbortSignal,
  ) => Promise<void>,
  signal: AbortSignal,
): Promise<readonly ExternalRecoveryKeyMount[]> {
  const checks = inventory.externalKeyChecks;
  if (
    checks.length > 20 ||
    new Set(checks.map((check) => check.alias)).size !== checks.length
  )
    throw new BackupExecutionError("recovery_key_unavailable");
  const results: ExternalRecoveryKeyMount[] = [];
  for (const check of checks) {
    signal.throwIfAborted();
    const mount = mounts[check.alias];
    const matches = parts.filter(
      (part) => part.kind === "recovery-key" && part.id === check.canaryPartId,
    );
    if (
      !mount ||
      mount.targetPath !== "/etc/postgresql-custom/pgsodium_root.key" ||
      matches.length !== 1 ||
      matches[0]!.bytes > 1024 ||
      !/^[a-zA-Z0-9_.-]{1,64}$/.test(check.alias)
    )
      throw new BackupExecutionError("recovery_key_unavailable");
    const canary = join(directory, `key-check-${randomUUID()}.json`);
    try {
      await materialize(matches[0]!, canary, signal);
      const value = JSON.parse(await readFile(canary, "utf8")) as Record<
        string,
        unknown
      >;
      if (
        Object.keys(value).sort().join(",") !== "alias,sha256" ||
        value.alias !== check.alias ||
        typeof value.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(value.sha256)
      )
        throw new BackupExecutionError("recovery_key_unavailable");
      const key = await open(
        mount.path,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      let bytes: Buffer;
      try {
        const stat = await key.stat();
        if (
          !stat.isFile() ||
          (stat.mode & 0o077) !== 0 ||
          stat.size <= 0 ||
          stat.size > 1024 * 1024
        )
          throw new BackupExecutionError("recovery_key_unavailable");
        bytes = Buffer.alloc(stat.size);
        const result = await key.read(bytes, 0, bytes.length, 0);
        if (result.bytesRead !== bytes.length)
          throw new BackupExecutionError("recovery_key_unavailable");
      } finally {
        await key.close();
      }
      if (
        !timingSafeEqual(
          createHash("sha256").update(bytes).digest(),
          Buffer.from(value.sha256, "hex"),
        )
      )
        throw new BackupExecutionError("recovery_key_unavailable");
      const target = join(directory, `external-key-${randomUUID()}`);
      await writeFile(target, bytes, { mode: 0o600, flag: "wx" });
      bytes.fill(0);
      results.push({ path: target, targetPath: mount.targetPath });
    } finally {
      await rm(canary, { force: true });
    }
  }
  return results;
}
