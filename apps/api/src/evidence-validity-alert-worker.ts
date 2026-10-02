import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { randomUUID } from "node:crypto";

import { AppModule } from "./app.module";
import { EvidenceValidityAlertWorker } from "./evidence/worker/evidence-validity-alert-worker";
import { MailEvidenceValidityAlertNotifierAdapter } from "./evidence/infrastructure/mail-evidence-validity-alert-notifier.adapter";
import { SupabaseEvidenceValidityAlertQueue } from "./evidence/infrastructure/supabase-evidence-validity-alert-queue";
import { MailService } from "./mail/mail.service";
import { SupabaseService } from "./supabase/supabase.service";

export const sleepForEvidenceValidityAlertWorkerCycle = (
  milliseconds: number,
): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: false,
  });
  const config = app.get(ConfigService);
  const queue = new SupabaseEvidenceValidityAlertQueue(
    app.get(SupabaseService),
  );
  const notifier = new MailEvidenceValidityAlertNotifierAdapter(
    app.get(MailService),
  );
  const worker = new EvidenceValidityAlertWorker({
    workerId: randomUUID(),
    leaseSeconds:
      config.get<number>("EVIDENCE_VALIDITY_ALERT_LEASE_SECONDS") ?? 120,
    queue,
    notifier,
  });
  const once = process.argv.includes("--once");
  const logger = new Logger("EvidenceValidityAlertWorker");
  try {
    do {
      try {
        await worker.runOnce();
      } catch {
        logger.error("Evidence validity alert worker cycle failed safely");
      }
      if (!once) await sleepForEvidenceValidityAlertWorkerCycle(30_000);
    } while (!once);
  } finally {
    await app.close();
  }
}

void bootstrap();
