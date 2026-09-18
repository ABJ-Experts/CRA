import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { ProductImportWorker } from "./products/imports/product-import-worker";

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: false,
  });
  const logger = new Logger("ProductImportWorker");
  const worker = app.get(ProductImportWorker);
  const once = process.argv.includes("--once");

  try {
    do {
      try {
        await worker.runOnce();
      } catch {
        logger.error("Product import worker cycle failed safely");
      }
      if (!once) await delay(30_000);
    } while (!once);
  } finally {
    await app.close();
  }
}

void bootstrap();
