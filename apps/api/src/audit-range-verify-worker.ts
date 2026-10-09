import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { AuditRangeWorker } from "./audit/range/audit-range-worker";
import { SupabaseAuditRangeRepository } from "./audit/range/infrastructure/supabase-audit-range.repository";
import { SupabaseService } from "./supabase/supabase.service";
type Context = Readonly<{
  get(token: unknown): unknown;
  close(): Promise<void>;
}>;
export async function bootstrapAuditRangeWorker(
  options: Readonly<{
    argv: readonly string[];
    createContext: () => Promise<Context>;
    createWorker: (context: Context) => Pick<AuditRangeWorker, "runOnce">;
    logger: Pick<Logger, "error">;
    sleep: (ms: number) => Promise<void>;
  }>,
): Promise<void> {
  const context = await options.createContext();
  const once = options.argv.includes("--once");
  try {
    const worker = options.createWorker(context);
    do {
      let delay = 1000;
      try {
        const outcome = await worker.runOnce();
        delay = outcome === "processed" ? 0 : 1000;
      } catch {
        options.logger.error("Audit range worker cycle unavailable");
      }
      if (once) break;
      await options.sleep(delay);
    } while (!once);
  } finally {
    await context.close();
  }
}
export function auditRangeWorkerFromContext(
  context: Context,
): AuditRangeWorker {
  const supabase = context.get(SupabaseService) as SupabaseService;
  return new AuditRangeWorker({
    repository: new SupabaseAuditRangeRepository(supabase),
  });
}
/* istanbul ignore next -- runtime entry guard */
if (require.main === module)
  void bootstrapAuditRangeWorker({
    argv: process.argv,
    createContext: () =>
      NestFactory.createApplicationContext(AppModule, { bufferLogs: false }),
    createWorker: auditRangeWorkerFromContext,
    logger: new Logger("AuditRangeWorker"),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
