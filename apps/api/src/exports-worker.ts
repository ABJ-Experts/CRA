import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { randomUUID } from "node:crypto";
import { AppModule } from "./app.module";
import { SupabaseService } from "./supabase/supabase.service";
import { SupabaseExportWorkerRepository } from "./exports/infrastructure/export-worker.repository";
import { SupabaseExportWorkerStorage } from "./exports/infrastructure/export-worker-storage.adapter";
import {
  ExportWorker,
  safeExportWorkerFailure,
} from "./exports/worker/export-worker";
type WorkerContext = Readonly<{
  get(token: unknown): unknown;
  close(): Promise<void>;
}>;
export async function bootstrapExportsWorker(
  options: Readonly<{
    argv: readonly string[];
    context: () => Promise<WorkerContext>;
    worker: (context: WorkerContext) => Pick<ExportWorker, "runOnce">;
    sleep: (milliseconds: number) => Promise<void>;
    logger: Pick<Logger, "error">;
  }>,
): Promise<void> {
  const context = await options.context();
  try {
    const worker = options.worker(context);
    do {
      try {
        await worker.runOnce();
      } catch (error) {
        options.logger.error(
          `Filtered export worker failed code=${safeExportWorkerFailure(error)}`,
        );
      }
      if (!options.argv.includes("--once")) await options.sleep(1000);
    } while (!options.argv.includes("--once"));
  } finally {
    await context.close();
  }
}
export function exportsWorkerFromContext(context: WorkerContext): ExportWorker {
  const supabase = context.get(SupabaseService) as SupabaseService;
  return new ExportWorker({
    workerId: randomUUID(),
    repository: new SupabaseExportWorkerRepository(supabase),
    storage: new SupabaseExportWorkerStorage(supabase),
  });
}
/* istanbul ignore next -- runtime entry guard. */
if (require.main === module)
  void bootstrapExportsWorker({
    argv: process.argv,
    context: () => NestFactory.createApplicationContext(AppModule),
    worker: exportsWorkerFromContext,
    sleep: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    logger: new Logger("ExportsWorker"),
  });
