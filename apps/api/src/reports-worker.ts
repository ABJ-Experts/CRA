import {
  maintenanceRun,
  maintenanceStart,
} from "./upgrades/maintenance/maintenance-gate";
import { LicensingService } from "./licensing/application/licensing.service";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { randomUUID } from "node:crypto";
import { AppModule } from "./app.module";
import { SupabaseService } from "./supabase/supabase.service";
import { ExportSourceContextAdapter } from "./exports/infrastructure/export-source-context.adapter";
import { SupabaseExportWorkerStorage } from "./exports/infrastructure/export-worker-storage.adapter";
import { ExportWorker } from "./exports/worker/export-worker";
import {
  ReportsWorker,
  safeReportWorkerFailure,
} from "./reports/worker/reports-worker";
import {
  SupabaseReportsWorkerRepository,
  ScheduledExportWorkerRepository,
} from "./reports/infrastructure/supabase-reports-worker.repository";

type WorkerContext = Readonly<{
  get(token: unknown): unknown;
  close(): Promise<void>;
}>;
export async function bootstrapReportsWorker(
  options: Readonly<{
    argv: readonly string[];
    context: () => Promise<WorkerContext>;
    worker: (context: WorkerContext) => Pick<ReportsWorker, "runOnce">;
    sleep: (milliseconds: number) => Promise<void>;
    logger: Pick<Logger, "error">;
  }>,
): Promise<void> {
  const context = await maintenanceStart(() => options.context());
  try {
    const worker = options.worker(context);
    do {
      try {
        await maintenanceRun(() => worker.runOnce());
      } catch (error) {
        options.logger.error(
          `Scheduled reports worker failed code=${safeReportWorkerFailure(error)}`,
        );
      }
      if (!options.argv.includes("--once")) await options.sleep(1000);
    } while (!options.argv.includes("--once"));
  } finally {
    await context.close();
  }
}
export function reportsWorkerFromContext(
  context: WorkerContext,
): ReportsWorker {
  const supabase = context.get(SupabaseService) as SupabaseService;
  const sourceContexts = context.get(
    ExportSourceContextAdapter,
  ) as ExportSourceContextAdapter;
  const workerId = randomUUID();
  return new ReportsWorker(
    new SupabaseReportsWorkerRepository(supabase),
    new ExportWorker({
      workerId,
      repository: new ScheduledExportWorkerRepository(supabase),
      storage: new SupabaseExportWorkerStorage(supabase),
    }),
    sourceContexts,
    workerId,
    context.get(LicensingService) as LicensingService,
  );
}
/* istanbul ignore next -- runtime entry guard. */
if (require.main === module)
  void bootstrapReportsWorker({
    argv: process.argv,
    context: () => NestFactory.createApplicationContext(AppModule),
    worker: reportsWorkerFromContext,
    sleep: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    logger: new Logger("ReportsWorker"),
  });
