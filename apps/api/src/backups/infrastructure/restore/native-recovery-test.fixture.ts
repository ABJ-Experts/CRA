/* eslint-disable @typescript-eslint/require-await -- Asynchronous native port test doubles. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { NativeBackupProcess } from "../capture/native-backup-process";
import { backupDigest } from "../repository/encrypted-backup.repository";
import type { BackupRecoveryProfile } from "./native-docker-recovery.adapter";
import type { AuthenticatedRecovery } from "./isolated-backup-verifier";
import {
  RECOVERY_AUDIT_HEADS_SQL,
  RECOVERY_AUDIT_INTEGRITY_SQL,
  RECOVERY_CATALOG_SQL,
  RECOVERY_MIGRATIONS_SQL,
  RECOVERY_OBJECT_METADATA_SQL,
} from "./restore-inventory";
export function tar(): Buffer {
  const header = Buffer.alloc(512);
  header.write("PG_VERSION");
  header.write("0000600\0", 100);
  header.write("0000000\0", 108);
  header.write("0000000\0", 116);
  header.write("00000000003\0", 124);
  header.fill(32, 148, 156);
  header.write("0", 156);
  header.write("ustar\0", 257);
  header.write(
    header
      .reduce((a, b) => a + b, 0)
      .toString(8)
      .padStart(6, "0") + "\0 ",
    148,
  );
  return Buffer.concat([header, Buffer.from("17\n"), Buffer.alloc(509 + 1024)]);
}
export const profile: BackupRecoveryProfile = {
  image: "public.ecr.aws/supabase/postgres:17.6.1.156",
  postgresVersion: "17.6",
  networkInternal: true,
  maxExpandedBytes: 1024 * 1024,
  maxEntries: 100,
  deadlineMs: 10000,
  stagingAlias: "stage",
  storageTenantPrefix: "stub/stub",
  objectVolumeBacking: {
    encryptedAtRest: true,
    daemonId: "daemon",
    maximumBytes: 1024 ** 2,
  },
};
export function fixture() {
  let name = "";
  let networkPresent = false;
  let containerPresent = false;
  let volumePresent = false;
  let labels: Readonly<Record<string, string>> = {};
  const calls: readonly string[][] = [];
  let observed: string[][] = [];
  const sql = jest.fn(async (query: string) => {
    if (query === RECOVERY_CATALOG_SQL)
      return JSON.stringify({
        sequences: [],
        roles: [{ rolname: "postgres", rolsuper: true, rolcanlogin: true }],
      });
    if (query === RECOVERY_MIGRATIONS_SQL) return "[]";
    if (query === RECOVERY_AUDIT_HEADS_SQL) return "[]";
    if (query === RECOVERY_OBJECT_METADATA_SQL) return "[]";
    if (query === RECOVERY_AUDIT_INTEGRITY_SQL) return "true";
    if (query.includes("json_agg(datname")) return '["postgres"]';
    if (query === "select pg_is_in_recovery()::text") return "false";
    if (query === "show server_version") return "17.6";
    if (query.includes("system_identifier::text")) return "123";
    return "true";
  });
  const process = {
    run: jest.fn(
      async (
        _binary: string,
        args: readonly string[],
        _signal: AbortSignal,
        input?: string,
      ) => {
        observed = [...observed, [...args]];
        if (args[0] === "info")
          return args.includes("{{.ID}}") ? "daemon" : "linux";
        if (args[0] === "volume" && args[1] === "create") volumePresent = true;
        if (args[0] === "volume" && args[1] === "ls")
          return volumePresent ? `${name}-objects` : "";
        if (args[0] === "volume" && args[1] === "rm") volumePresent = false;
        if (args[0] === "volume" && args[1] === "inspect")
          return JSON.stringify({
            Name: `${name}-objects`,
            Driver: "local",
            Scope: "local",
            Options: null,
            Labels: labels,
          });
        if (
          args[0] === "run" &&
          args.some((arg) => arg.endsWith("-objects-check"))
        ) {
          const mount = args.find((arg) =>
            arg.endsWith(",dst=/manifest.json,readonly"),
          )!;
          const path = mount.slice(
            "type=bind,src=".length,
            -",dst=/manifest.json,readonly".length,
          );
          const entries = JSON.parse(await readFile(path, "utf8")) as {
            bytes: number;
          }[];
          return JSON.stringify({
            ok: true,
            count: entries.length,
            bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
          });
        }
        if (args[0] === "network" && args[1] === "create") {
          name = args.at(-1)!.replace(/-network$/, "");
          networkPresent = true;
          labels = Object.fromEntries<string>(
            args.flatMap((arg, index) => {
              if (arg !== "--label") return [];
              const encoded = args[index + 1]!;
              const separator = encoded.indexOf("=");
              return [
                [
                  encoded.slice(0, separator),
                  encoded.slice(separator + 1),
                ] as const,
              ];
            }),
          );
          return "networkid";
        }
        if (args[0] === "network" && args[1] === "ls")
          return networkPresent ? `${name}-network` : "";
        if (args[0] === "ps") return containerPresent ? name : "";
        if (args[0] === "run" && args.includes("--detach"))
          containerPresent = true;
        if (args[0] === "rm") containerPresent = false;
        if (args[0] === "network" && args[1] === "rm") networkPresent = false;
        if (args[0] === "network" && args[1] === "inspect")
          if (args.includes("{{json .Labels}}")) return JSON.stringify(labels);
          else
            return args.includes(
              '{{.Internal}} {{index .Labels "cra.backup.restore"}}',
            )
              ? `true ${name}`
              : name;
        if (args[0] === "inspect")
          return args.includes("{{json .Config.Labels}}")
            ? JSON.stringify(labels)
            : name;
        if (args[0] === "exec" && args.includes("psql"))
          return sql(input ?? "");
        return "";
      },
    ),
  } as unknown as NativeBackupProcess;
  const bytes = tar();
  const base = {
    id: "base",
    kind: "base" as const,
    name: "base.tar",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    cipherSha256: "a".repeat(64),
    cipherBytes: bytes.length,
  };
  const recovery: AuthenticatedRecovery = {
    certificate: {
      formatVersion: 1,
      instanceId: "instance",
      runId: "capture",
      repositoryGeneration: "generation",
      configurationRevision: 1,
      keyId: "key",
      capturedAt: new Date().toISOString(),
      checkpoint: {
        systemIdentifier: "123",
        timeline: 1,
        lsn: "0/1000000",
        postgresVersion: "17.6",
        restorePoint: "cra_backup_" + "a".repeat(32),
      },
      parts: [base],
      inventoryDigest: "b".repeat(64),
      auditHeadsDigest: backupDigest([]),
      certificateDigest: "c".repeat(64),
    },
    inventory: {
      catalog: {
        databaseName: "postgres",
        databases: {
          postgres: {
            sequences: [],
            roles: [{ rolname: "postgres", rolsuper: true, rolcanlogin: true }],
          },
        },
        migrations: [],
      },
      auditHeads: [],
      objects: [],
      externalKeyChecks: [],
    },
    materialize: jest.fn(async (_part, destination) => {
      await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
    }),
  };
  return {
    process,
    recovery,
    sql,
    calls,
    get observed() {
      return observed;
    },
  };
}
