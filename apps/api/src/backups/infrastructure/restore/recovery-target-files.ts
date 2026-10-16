import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
export async function writeRecoveryConfiguration(
  pgdata: string,
  restorePoint: string,
  timeline: number,
  hasExternalKeys: boolean,
): Promise<void> {
  const config =
    [
      "data_directory='/var/lib/postgresql/data'",
      "hba_file='/var/lib/postgresql/data/recovery-hba.conf'",
      "ident_file='/var/lib/postgresql/data/recovery-ident.conf'",
      "listen_addresses='*'",
      "unix_socket_directories='/tmp'",
      "port=5432",
      hasExternalKeys
        ? "shared_preload_libraries='pgsodium,supabase_vault'"
        : "shared_preload_libraries=''",
      "pgsodium.getkey_script='/usr/lib/postgresql/bin/pgsodium_getkey.sh'",
      "vault.getkey_script='/usr/lib/postgresql/bin/pgsodium_getkey.sh'",
      "autovacuum=off",
      "archive_mode=off",
      "archive_command=''",
      "primary_conninfo=''",
      "primary_slot_name=''",
      "wal_level=replica",
      "max_wal_senders=100",
      "max_replication_slots=100",
      "max_connections=1000",
      "max_worker_processes=100",
      "max_logical_replication_workers=0",
      "max_sync_workers_per_subscription=0",
      "max_parallel_apply_workers_per_subscription=0",
      "max_prepared_transactions=100",
      "max_locks_per_transaction=256",
      "shared_buffers='16MB'",
      "jit=off",
      "ssl=off",
      "logging_collector=off",
      "log_statement='none'",
      "log_min_error_statement=panic",
      "restore_command='cp /restore-wal/%f %p'",
      `recovery_target_name='${restorePoint}'`,
      `recovery_target_timeline='${timeline}'`,
      "recovery_target_action='promote'",
    ].join("\n") + "\n";
  await Promise.all([
    writeFile(join(pgdata, "recovery-target.conf"), config, {
      mode: 0o600,
      flag: "wx",
    }),
    writeFile(
      join(pgdata, "recovery-hba.conf"),
      "local all all trust\nhost all all 0.0.0.0/0 reject\nhost all all ::/0 reject\n",
      { mode: 0o600, flag: "wx" },
    ),
    writeFile(join(pgdata, "recovery-ident.conf"), "", {
      mode: 0o600,
      flag: "wx",
    }),
    writeFile(join(pgdata, "postgresql.auto.conf"), "", { mode: 0o600 }),
    writeFile(join(pgdata, "recovery.signal"), "", {
      mode: 0o600,
      flag: "wx",
    }),
  ]);
  await rm(join(pgdata, "standby.signal"), { force: true });
}
