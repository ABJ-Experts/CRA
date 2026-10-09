import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { randomUUID } from "node:crypto";
import { AppModule } from "./app.module";
import {
  EVIDENCE_WATERMARK_EXPORT_REPOSITORY,
  type EvidenceWatermarkExportRepository,
} from "./evidence/application/evidence-watermark-export-use-cases";
import { EvidenceWatermarkRenderer } from "./evidence/infrastructure/evidence-watermark-renderer";
import { SupabaseEvidenceStorageAdapter } from "./evidence/infrastructure/supabase-evidence-storage.adapter";
import { SupabaseEvidenceWatermarkExportStorageAdapter } from "./evidence/infrastructure/supabase-evidence-watermark-export-storage.adapter";
import { EvidenceWatermarkExportWorker } from "./evidence/worker/evidence-watermark-export-worker";

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: false,
  });
  try {
    const config = app.get(ConfigService);
    const worker = new EvidenceWatermarkExportWorker({
      repository: app.get<EvidenceWatermarkExportRepository>(
        EVIDENCE_WATERMARK_EXPORT_REPOSITORY,
      ),
      originals: app.get(SupabaseEvidenceStorageAdapter),
      derivatives: app.get(SupabaseEvidenceWatermarkExportStorageAdapter),
      renderer: app.get(EvidenceWatermarkRenderer),
      leaseSeconds:
        config.get<number>("EVIDENCE_WATERMARK_EXPORT_LEASE_SECONDS") ?? 120,
    });
    await worker.processOne(randomUUID());
  } finally {
    await app.close();
  }
}

void bootstrap();
