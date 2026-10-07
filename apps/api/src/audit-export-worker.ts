import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { randomUUID } from "node:crypto";

import { AppModule } from "./app.module";
import { SupabaseAuditExportStorageAdapter } from "./audit/infrastructure/audit-export-storage.adapter";
import { SupabaseAuditExportJobRepository } from "./audit/infrastructure/supabase-audit-export-job.repository";
import { AuditExportWorker } from "./audit/worker/audit-export-worker";
import { SupabaseService } from "./supabase/supabase.service";

export const sleepForAuditExportWorkerCycle = (
  milliseconds: number,
): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

type WorkerApplicationContext = Readonly<{
  get(typeOrToken: unknown): unknown;
  close(): Promise<void>;
}>;

export async function bootstrapAuditExportWorker(
  options: Readonly<{
    argv: readonly string[];
    createApplicationContext: () => Promise<WorkerApplicationContext>;
    createWorker: (context: WorkerApplicationContext) => AuditExportWorker;
    logger: Pick<Logger, "error">;
    sleep: (milliseconds: number) => Promise<void>;
  }>,
): Promise<void> {
  const context = await options.createApplicationContext();
  const worker = options.createWorker(context);
  const once = options.argv.includes("--once");
  try {
    do {
      try {
        await worker.runOnce();
      } catch (error) {
        options.logger.error(
          `Audit export worker cycle failed safely code=${safeWorkerErrorCode(error)}`,
        );
      }
      if (!once) await options.sleep(30_000);
    } while (!once);
  } finally {
    await context.close();
  }
}

const safeErrorCodes = new Set([
  "access_changed",
  "audit_export_conflict",
  "export_limit",
  "generation_failed",
  "integrity_break",
  "malformed_provider",
  "provider_unavailable",
  "snapshot_expired",
  "storage_unavailable",
]);

export function safeWorkerErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  const code = error.message.trim();
  return safeErrorCodes.has(code) ? code : "unknown";
}

export function workerFromContext(
  context: WorkerApplicationContext,
): AuditExportWorker {
  const supabase = context.get(SupabaseService) as SupabaseService;
  return new AuditExportWorker({
    workerId: randomUUID(),
    repository: new SupabaseAuditExportJobRepository(supabase),
    storage: new SupabaseAuditExportStorageAdapter(supabase),
  });
}

/* istanbul ignore next -- runtime entry guard. */
if (require.main === module) {
  void bootstrapAuditExportWorker({
    argv: process.argv,
    createApplicationContext: () =>
      NestFactory.createApplicationContext(AppModule, { bufferLogs: false }),
    createWorker: workerFromContext,
    logger: new Logger("AuditExportWorker"),
    sleep: sleepForAuditExportWorkerCycle,
  });
}
