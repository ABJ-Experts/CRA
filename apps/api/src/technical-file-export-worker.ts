import {
  maintenanceRun,
  maintenanceStart,
} from "./upgrades/maintenance/maintenance-gate";
import { NestFactory } from "@nestjs/core";
import { randomUUID } from "node:crypto";
import { AppModule } from "./app.module";
import { TechnicalFileSnapshotExportWorker } from "./technical-files/worker/technical-file-snapshot-export-worker";

async function bootstrap() {
  const app = await maintenanceStart(() =>
    NestFactory.createApplicationContext(AppModule, {
      bufferLogs: false,
    }),
  );
  try {
    await maintenanceRun(() =>
      app.get(TechnicalFileSnapshotExportWorker).processOne(randomUUID()),
    );
  } finally {
    await app.close();
  }
}
void bootstrap();
