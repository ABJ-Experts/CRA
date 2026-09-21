import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { randomUUID } from "node:crypto";

import { AppModule } from "./app.module";
import { SupabaseEvidenceStorageAdapter } from "./evidence/infrastructure/supabase-evidence-storage.adapter";
import { SupabaseEvidenceDeletionCleanupQueue } from "./evidence/infrastructure/supabase-evidence-deletion-cleanup.queue";
import { EvidenceDeletionCleanupWorker } from "./evidence/worker/evidence-deletion-cleanup-worker";
import { SupabaseService } from "./supabase/supabase.service";

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: false,
  });
  const config = app.get(ConfigService);
  const worker = new EvidenceDeletionCleanupWorker({
    workerId: randomUUID(),
    leaseSeconds:
      config.get<number>("EVIDENCE_DELETION_CLEANUP_LEASE_SECONDS") ?? 120,
    queue: new SupabaseEvidenceDeletionCleanupQueue(app.get(SupabaseService)),
    storage: app.get(SupabaseEvidenceStorageAdapter),
  });
  const once = process.argv.includes("--once");
  const logger = new Logger("EvidenceDeletionCleanupWorker");
  try {
    do {
      try {
        await worker.runOnce();
      } catch {
        logger.error("Evidence deletion cleanup cycle failed safely");
      }
      if (!once) await delay(30_000);
    } while (!once);
  } finally {
    await app.close();
  }
}

void bootstrap();
