import { z } from "zod";
import type {
  BackupControlAction,
  BackupControlPort,
} from "../application/backup-control.port";
import { BackupExecutionError } from "../application/backup-execution.port";
import { NativeBackupProcess } from "./capture/native-backup-process";
import type { BackupMountedRuntime } from "./capture/backup-mounted-runtime";
const envelope = z.strictObject({
  outcome: z.enum([
    "ok",
    "empty",
    "not_found",
    "conflict",
    "blocked",
    "invalid",
  ]),
  result: z.unknown().optional(),
  execution: z.unknown().optional(),
});
const name = z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/);
const sourceSchema = z.object({
  databaseContainer: name,
  databaseName: name,
  databaseUser: name,
});
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
/** Executor-only source connection: control cannot be starved by pooled API readers awaiting frozen audit tables. */
export class NativeBackupWorkerControlClient implements BackupControlPort {
  private readonly source: z.output<typeof sourceSchema>;
  constructor(
    private readonly instanceId: string,
    source: unknown,
    private readonly process = new NativeBackupProcess(),
  ) {
    z.uuid().parse(instanceId);
    this.source = sourceSchema.parse(source);
  }
  async execute(
    instanceId: string,
    actor: string,
    action: BackupControlAction,
    input: Readonly<Record<string, unknown>> = {},
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (
      instanceId !== this.instanceId ||
      !/^[a-z0-9][a-z0-9:_/-]{0,199}$/.test(actor)
    )
      throw new BackupExecutionError("configuration_invalid");
    const encoded = JSON.stringify(input);
    if (Buffer.byteLength(encoded) > 65536)
      throw new BackupExecutionError("configuration_invalid");
    const timeout = action === "run/cancel" ? 40000 : 5000;
    const bounded = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
      : AbortSignal.timeout(timeout);
    let raw: unknown;
    try {
      const response = await this.process.run(
        "docker",
        [
          "exec",
          "-i",
          this.source.databaseContainer,
          "psql",
          "-XqAt",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          this.source.databaseUser,
          "-d",
          this.source.databaseName,
        ],
        bounded,
        `SET statement_timeout='${timeout - 250}ms'; SET lock_timeout='${timeout - 250}ms'; SET transaction_timeout='${timeout}ms'; BEGIN; SET LOCAL standard_conforming_strings=on; SET LOCAL ROLE cra_backup_control; SELECT public.m15_05_backup_control(${literal(instanceId)}::uuid,${literal(actor)},${literal(action)},${literal(encoded)}::jsonb)::text; COMMIT;`,
        1024 * 1024,
      );
      raw = JSON.parse(response) as unknown;
    } catch {
      throw new BackupExecutionError("source_unavailable");
    }
    const parsed = envelope.safeParse(raw);
    if (!parsed.success) throw new BackupExecutionError("source_unavailable");
    switch (parsed.data.outcome) {
      case "ok":
        return action === "run/claim"
          ? { run: parsed.data.result, execution: parsed.data.execution }
          : parsed.data.result;
      case "empty":
        return null;
      case "conflict":
        throw new BackupExecutionError("lease_lost");
      case "blocked":
        throw new BackupExecutionError("retention_authority_unavailable");
      case "not_found":
        throw new BackupExecutionError("authorization_changed");
      case "invalid":
        throw new BackupExecutionError("configuration_invalid");
    }
  }
}
export function backupWorkerControlSource(
  runtime: BackupMountedRuntime,
  alias?: string,
): BackupMountedRuntime["sources"][string] {
  const aliases = Object.keys(runtime.sources);
  const selected = alias ?? (aliases.length === 1 ? aliases[0] : undefined);
  const source = selected ? runtime.sources[selected] : undefined;
  if (!source) throw new BackupExecutionError("configuration_invalid");
  return source;
}
