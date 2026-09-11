import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { FindingPropagationWorker } from "./findings/worker/finding-propagation-worker";

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: false,
  });
  const logger = new Logger("FindingPropagationWorker");
  const worker = app.get(FindingPropagationWorker);
  const once = process.argv.includes("--once");

  try {
    do {
      try {
        await worker.runOnce();
      } catch {
        // Job leases and graph-event leases remain durable. Keep logs free of
        // finding identifiers, evidence, and confidential product structure.
        logger.error("Finding propagation worker cycle failed safely");
      }
      if (!once) await delay(30_000);
    } while (!once);
  } finally {
    await app.close();
  }
}

void bootstrap();
