import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";

import { AiGateway } from "./ai/ai-gateway";
import { SupplierDocumentExtractionWorker } from "./ai/supplier-document-extraction.worker";
import { AppModule } from "./app.module";
import { LocalEvidenceTextExtractorAdapter } from "./evidence/infrastructure/local-evidence-text-extractor.adapter";
import { SupabaseEvidenceStorageAdapter } from "./evidence/infrastructure/supabase-evidence-storage.adapter";
import { SupabaseService } from "./supabase/supabase.service";

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: false,
  });
  const config = app.get(ConfigService);
  const worker = new SupplierDocumentExtractionWorker({
    supabase: app.get(SupabaseService),
    storage: app.get(SupabaseEvidenceStorageAdapter),
    extractor: new LocalEvidenceTextExtractorAdapter({
      pdftotextPath: config.get<string>("EVIDENCE_PDFTOTEXT_PATH"),
      pdftoppmPath: config.get<string>("EVIDENCE_PDFTOPPM_PATH"),
      tesseractPath: config.get<string>("EVIDENCE_TESSERACT_PATH"),
      ocrLanguage: config.get<string>("EVIDENCE_OCR_LANGUAGE") ?? "eng",
      commandTimeoutMs:
        config.get<number>("EVIDENCE_EXTRACTION_COMMAND_TIMEOUT_MS") ?? 30_000,
      overallTimeoutMs:
        config.get<number>("EVIDENCE_EXTRACTION_JOB_TIMEOUT_MS") ?? 120_000,
      maximumPixels:
        config.get<number>("EVIDENCE_OCR_MAX_PIXELS") ?? 40_000_000,
    }),
    gateway: new AiGateway(config),
  });
  const once = process.argv.includes("--once");
  const logger = new Logger("SupplierDocumentExtractionWorker");
  try {
    do {
      try {
        await worker.runOnce();
      } catch {
        logger.error("Supplier document extraction cycle failed safely");
      }
      if (!once) await delay(30_000);
    } while (!once);
  } finally {
    await app.close();
  }
}
void bootstrap();
