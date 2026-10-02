import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { ReportingDeadlineMonitorWorker } from "./reporting/worker/reporting-deadline-monitor-worker";

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: false,
  });
  const logger = new Logger("ReportingDeadlineMonitorWorker");
  const worker = app.get(ReportingDeadlineMonitorWorker);
  const once = process.argv.includes("--once");

  try {
    do {
      try {
        await worker.runOnce();
      } catch {
        // PostgreSQL retains all deadline transitions and delivery state. The
        // next database-time cycle safely catches up work after any outage.
        logger.error("Reporting deadline monitor cycle failed safely");
      }
      if (!once) await delay(30_000);
    } while (!once);
  } finally {
    await app.close();
  }
}

void bootstrap();
