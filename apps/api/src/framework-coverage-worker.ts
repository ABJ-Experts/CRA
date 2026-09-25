import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { randomUUID } from "node:crypto";

import { AppModule } from "./app.module";
import { CoverageRecalculationWorker } from "./frameworks/application/coverage-recalculation-worker";
import { SupabaseCoverageWorkQueue } from "./frameworks/infrastructure/supabase-coverage-work.queue";

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: false,
  });
  const logger = new Logger("FrameworkCoverageWorker");
  const worker = new CoverageRecalculationWorker(
    app.get(SupabaseCoverageWorkQueue),
  );
  const workerId = randomUUID();
  const once = process.argv.includes("--once");
  try {
    do {
      try {
        for (let count = 0; count < 100; count += 1) {
          if (!(await worker.runOnce(workerId))) break;
        }
      } catch {
        logger.error("Framework coverage worker cycle failed safely");
      }
      if (!once) await sleep(30_000);
    } while (!once);
  } finally {
    await app.close();
  }
}

void bootstrap();
