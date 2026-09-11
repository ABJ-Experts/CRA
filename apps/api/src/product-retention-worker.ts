import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { ProductRetentionWorker } from "./products/worker/product-retention-worker";

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: false,
  });
  const logger = new Logger("ProductRetentionWorker");
  const worker = app.get(ProductRetentionWorker);
  const once = process.argv.includes("--once");

  try {
    do {
      try {
        await worker.runOnce();
      } catch {
        // Alert attempts persist their safe error/state through the durable
        // queue. The next database-time cycle safely retries any outstanding
        // catch-up alert without logging sensitive recipient or payload data.
        logger.error("Product retention worker cycle failed safely");
      }
      if (!once) await delay(30_000);
    } while (!once);
  } finally {
    await app.close();
  }
}

void bootstrap();
