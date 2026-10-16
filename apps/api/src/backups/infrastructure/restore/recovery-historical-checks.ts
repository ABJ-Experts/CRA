import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { storageObjectPath } from "../capture/native-backup-capture.adapter";
import { BackupExecutionError } from "../../application/backup-execution.port";
import { backupDigest } from "../repository/encrypted-backup.repository";
import { recoveryCatalogMatches } from "./recovery-catalog";
import {
  RecoveryCheckFailure,
  type RecoveryCheckCode,
  type AuthenticatedRecovery,
} from "./isolated-backup-verifier";
import {
  RECOVERY_AUDIT_HEADS_SQL,
  RECOVERY_AUDIT_INTEGRITY_SQL,
  RECOVERY_CATALOG_SQL,
  RECOVERY_MIGRATIONS_SQL,
  RECOVERY_OBJECT_METADATA_SQL,
} from "./restore-inventory";
export interface RecoveryCatalog {
  readonly databaseName: string;
  readonly databases: Readonly<Record<string, unknown>>;
  readonly migrations: unknown;
}
export async function verifyRecoveryHistory(
  recovery: AuthenticatedRecovery,
  options: {
    readonly sql: (query: string, database?: string) => Promise<string>;
    readonly objectDirectory: string;
    readonly prefix: string;
    readonly verifyObjectVolume: () => Promise<void>;
    readonly externalKeyProbe: (alias: string) => Promise<boolean>;
    readonly signal: AbortSignal;
  },
): Promise<readonly RecoveryCheckCode[]> {
  let completed: readonly RecoveryCheckCode[] = [];
  let failed: RecoveryCheckCode = "schema_migrations";
  try {
    const expected = recovery.inventory.catalog as RecoveryCatalog;
    const actualDatabases = JSON.parse(
      await options.sql(
        "select json_agg(datname order by datname)::text from pg_database where datallowconn",
      ),
    ) as string[];
    if (
      backupDigest(actualDatabases) !==
      backupDigest(Object.keys(expected.databases).sort())
    )
      throw new BackupExecutionError("recovery_catalog_mismatch");
    for (const database of actualDatabases)
      if (
        !recoveryCatalogMatches(
          expected.databases[database],
          JSON.parse(await options.sql(RECOVERY_CATALOG_SQL, database)),
        )
      )
        throw new BackupExecutionError("recovery_catalog_mismatch");
    if (
      backupDigest(JSON.parse(await options.sql(RECOVERY_MIGRATIONS_SQL))) !==
      backupDigest(expected.migrations)
    )
      throw new BackupExecutionError("recovery_migration_mismatch");
    completed = [
      "schema_migrations",
      "extensions",
      "ownership_acl_rls",
      "sequences",
    ];
    failed = "audit_continuity";
    if (
      (await options.sql(RECOVERY_AUDIT_INTEGRITY_SQL)) !== "true" ||
      backupDigest(JSON.parse(await options.sql(RECOVERY_AUDIT_HEADS_SQL))) !==
        recovery.certificate.auditHeadsDigest ||
      backupDigest(recovery.inventory.auditHeads) !==
        recovery.certificate.auditHeadsDigest
    )
      throw new BackupExecutionError("recovery_audit_mismatch");
    completed = [...completed, "audit_continuity"];
    failed = "object_integrity";
    const metadata: unknown = JSON.parse(
      await options.sql(RECOVERY_OBJECT_METADATA_SQL),
    );
    const expectedObjects = recovery.inventory.objects
      .map(({ bucketId, name, version, bytes }) => ({
        bucketId,
        name,
        version,
        bytes,
      }))
      .sort((a, b) =>
        Buffer.compare(
          Buffer.from(`${a.bucketId}\0${a.name}\0${a.version ?? ""}`),
          Buffer.from(`${b.bucketId}\0${b.name}\0${b.version ?? ""}`),
        ),
      );
    if (backupDigest(metadata) !== backupDigest(expectedObjects))
      throw new BackupExecutionError("object_integrity");
    await options.verifyObjectVolume();
    for (const object of recovery.inventory.objects) {
      const file = storageObjectPath(
        options.objectDirectory,
        options.prefix,
        object.bucketId,
        object.name,
        object.version,
      );
      const hash = createHash("sha256");
      let bytes = 0;
      for await (const chunk of createReadStream(
        file,
      ) as AsyncIterable<Buffer>) {
        options.signal.throwIfAborted();
        hash.update(chunk);
        bytes += chunk.length;
      }
      if (hash.digest("hex") !== object.sha256 || bytes !== object.bytes)
        throw new BackupExecutionError("object_integrity");
    }
    completed = [...completed, "object_integrity"];
    failed = "external_keys";
    for (const check of recovery.inventory.externalKeyChecks)
      if (!(await options.externalKeyProbe(check.alias)))
        throw new BackupExecutionError("recovery_key_unavailable");
    return [...completed, "external_keys"];
  } catch {
    throw new RecoveryCheckFailure(failed, completed);
  }
}
