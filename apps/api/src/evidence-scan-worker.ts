import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { AppModule } from "./app.module";
import { SupabaseService } from "./supabase/supabase.service";
import { SupabaseEvidenceStorageAdapter } from "./evidence/infrastructure/supabase-evidence-storage.adapter";
import { ClamAvScannerAdapter } from "./evidence/infrastructure/clamav-scanner.adapter";
import { EvidenceScanWorker } from "./evidence/worker/evidence-scan-worker";
import { MailService } from "./mail/mail.service";

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: false,
  });
  const config = app.get(ConfigService);
  const worker = new EvidenceScanWorker({
    supabase: app.get(SupabaseService),
    storage: app.get(SupabaseEvidenceStorageAdapter),
    scanner: new ClamAvScannerAdapter({
      host: config.get<string>("EVIDENCE_CLAMAV_HOST"),
      port: config.get<number>("EVIDENCE_CLAMAV_PORT"),
      connectTimeoutMs:
        config.get<number>("EVIDENCE_CLAMAV_CONNECT_TIMEOUT_MS") ?? 3_000,
      scanTimeoutMs:
        config.get<number>("EVIDENCE_CLAMAV_SCAN_TIMEOUT_MS") ?? 120_000,
    }),
    mail: app.get(MailService),
    leaseSeconds: 120,
  });
  const once = process.argv.includes("--once");
  const logger = new Logger("EvidenceScanWorker");
  try {
    do {
      try {
        await worker.runOnce();
      } catch {
        logger.error("Evidence scan cycle failed safely");
      }
      if (!once) await delay(30_000);
    } while (!once);
  } finally {
    await app.close();
  }
}
void bootstrap();
