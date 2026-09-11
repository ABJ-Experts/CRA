import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { SbomCompositeWorker } from "./sboms/worker/sbom-composite-worker";

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: false,
  });
  const worker = app.get(SbomCompositeWorker);
  const logger = new Logger("SbomCompositeWorker");
  const once = process.argv.includes("--once");
  try {
    do {
      try {
        await worker.runOnce();
      } catch {
        logger.error("SBOM composite worker cycle failed safely");
      }
      if (!once) await delay(30_000);
    } while (!once);
  } finally {
    await app.close();
  }
}

void bootstrap();
