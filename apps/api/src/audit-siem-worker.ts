import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { SupabaseSiemRepository } from "./audit/siem/infrastructure/supabase-siem.repository";
import { SiemVault } from "./audit/siem/infrastructure/siem-vault";
import { NodeSiemTransport } from "./audit/siem/infrastructure/node-siem-transport";
import { SiemWorker } from "./audit/siem/worker/siem-worker";
type Context = Readonly<{
  get(token: unknown): unknown;
  close(): Promise<void>;
}>;
export async function bootstrapSiemWorker(
  options: Readonly<{
    argv: readonly string[];
    createContext: () => Promise<Context>;
    createWorker: (context: Context) => Pick<SiemWorker, "runOnce">;
    logger: Pick<Logger, "error">;
    sleep: (milliseconds: number) => Promise<void>;
  }>,
) {
  const context = await options.createContext();
  try {
    const worker = options.createWorker(context);
    const once = options.argv.includes("--once");
    do {
      let delay = 1000;
      try {
        delay = (await worker.runOnce()) === "processed" ? 0 : 1000;
      } catch {
        options.logger.error("SIEM worker cycle unavailable");
      }
      if (options.argv.includes("--once")) break;
      await options.sleep(delay);
    } while (!once);
  } finally {
    await context.close();
  }
}
/* istanbul ignore next -- runtime entry */
if (require.main === module)
  void bootstrapSiemWorker({
    argv: process.argv,
    createContext: () =>
      NestFactory.createApplicationContext(AppModule, { bufferLogs: false }),
    createWorker: (context) =>
      new SiemWorker(
        context.get(SupabaseSiemRepository) as SupabaseSiemRepository,
        context.get(NodeSiemTransport) as NodeSiemTransport,
        context.get(SiemVault) as SiemVault,
      ),
    logger: new Logger("SiemWorker"),
    sleep: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  });
