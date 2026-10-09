import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { TenantLifecycleWorker } from "./organizations/tenant-administration/worker/tenant-lifecycle-worker";

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: false,
  });
  const logger = new Logger("TenantLifecycleWorker");
  const worker = app.get(TenantLifecycleWorker);
  const once = process.argv.includes("--once");

  try {
    do {
      try {
        await worker.runOnce();
      } catch {
        // Individual jobs persist their own safe code. A scheduler outage gets
        // no provider payload in logs and simply retries on the next cycle.
        logger.error("Tenant lifecycle worker cycle failed safely");
      }
      if (!once) await delay(30_000);
    } while (!once);
  } finally {
    await app.close();
  }
}

void bootstrap();
