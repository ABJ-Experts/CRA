import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { ConnectorSyncWorker } from "./connectors/worker/connector-sync-worker";

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: false,
  });
  const logger = new Logger("ConnectorSyncWorker");
  const worker = app.get(ConnectorSyncWorker);
  const once = process.argv.includes("--once");

  try {
    do {
      try {
        await worker.runOnce();
      } catch {
        logger.error("Connector sync worker cycle failed safely");
      }
      if (!once) await delay(15_000);
    } while (!once);
  } finally {
    await app.close();
  }
}

void bootstrap();
