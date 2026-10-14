import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { randomUUID } from "node:crypto";
import { AppModule } from "./app.module";
import { SupabaseService } from "./supabase/supabase.service";
import { SystemHealthUseCases } from "./system-health/application/system-health.use-cases";
import { DiagnosticArchive } from "./support-diagnostics/infrastructure/diagnostic-archive";
import { DiagnosticArtifactStore } from "./support-diagnostics/infrastructure/diagnostic-artifact.store";
import { DiagnosticWorkerRepositoryAdapter } from "./support-diagnostics/infrastructure/diagnostic-worker.repository";
import { DiagnosticSourcesAdapter } from "./support-diagnostics/infrastructure/diagnostic-sources.adapter";
import { DiagnosticWorker } from "./support-diagnostics/worker/diagnostic-worker";
type Context = Readonly<{
  get(type: unknown): unknown;
  close(): Promise<void>;
}>;
export async function bootstrapSupportDiagnosticsWorker(
  options: Readonly<{
    argv: readonly string[];
    createApplicationContext: () => Promise<Context>;
    createWorker: (context: Context) => { runOnce(): Promise<void> };
    logger: Pick<Logger, "error">;
    sleep: (ms: number) => Promise<void>;
  }>,
): Promise<void> {
  const context = await options.createApplicationContext();
  try {
    const worker = options.createWorker(context);
    do {
      try {
        await worker.runOnce();
      } catch (error) {
        options.logger.error(
          `Diagnostic worker cycle failed code=${safeDiagnosticWorkerCode(error)}`,
        );
      }
      if (!options.argv.includes("--once")) await options.sleep(30_000);
    } while (!options.argv.includes("--once"));
  } finally {
    await context.close();
  }
}
export function safeDiagnosticWorkerCode(error: unknown): string {
  return error instanceof Error &&
    [
      "access_changed",
      "bundle_limit",
      "generation_failed",
      "provider_unavailable",
      "storage_unavailable",
    ].includes(error.message)
    ? error.message
    : "unknown";
}
export function diagnosticWorkerFromContext(
  context: Context,
): DiagnosticWorker {
  const supabase = context.get(SupabaseService) as SupabaseService;
  const config = context.get(ConfigService) as ConfigService;
  const health = context.get(SystemHealthUseCases) as SystemHealthUseCases;
  const workerId = randomUUID();
  const repository = new DiagnosticWorkerRepositoryAdapter(supabase, workerId);
  return new DiagnosticWorker({
    workerId,
    repository,
    sources: new DiagnosticSourcesAdapter(repository, health, config),
    storage: new DiagnosticArtifactStore(supabase),
    archive: new DiagnosticArchive(),
  });
}
/* istanbul ignore next -- standalone process entry guard. */
if (require.main === module)
  void bootstrapSupportDiagnosticsWorker({
    argv: process.argv,
    createApplicationContext: () =>
      NestFactory.createApplicationContext(AppModule, { bufferLogs: false }),
    createWorker: diagnosticWorkerFromContext,
    logger: new Logger("SupportDiagnosticsWorker"),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
