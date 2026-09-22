import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { randomUUID } from "node:crypto";

import { AppModule } from "./app.module";
import { SupabaseSupplierEvidenceReminderQueue } from "./supplier-evidence/infrastructure/supabase-supplier-evidence-reminder-queue";
import { MailSupplierEvidenceReminderNotifierAdapter } from "./supplier-evidence/infrastructure/mail-supplier-evidence-reminder-notifier.adapter";
import { SupplierEvidenceReminderWorker } from "./supplier-evidence/worker/supplier-evidence-reminder-worker";
import { MailService } from "./mail/mail.service";
import { SupabaseService } from "./supabase/supabase.service";

export const sleepForSupplierEvidenceReminderWorkerCycle = (
  milliseconds: number,
): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

type WorkerApplicationContext = Readonly<{
  get(typeOrToken: unknown): unknown;
  close(): Promise<void>;
}>;

export async function bootstrapSupplierEvidenceReminderWorker(
  options: Readonly<{
    argv: readonly string[];
    createApplicationContext: () => Promise<WorkerApplicationContext>;
    createWorker: (
      context: WorkerApplicationContext,
    ) => SupplierEvidenceReminderWorker;
    logger: Pick<Logger, "error">;
    sleep: (milliseconds: number) => Promise<void>;
  }>,
): Promise<void> {
  const context = await options.createApplicationContext();
  const worker = options.createWorker(context);
  const once = options.argv.includes("--once");
  try {
    do {
      try {
        await worker.runOnce();
      } catch {
        options.logger.error(
          "Supplier evidence reminder worker cycle failed safely",
        );
      }
      if (!once) await options.sleep(30_000);
    } while (!once);
  } finally {
    await context.close();
  }
}

function workerFromContext(
  context: WorkerApplicationContext,
): SupplierEvidenceReminderWorker {
  const config = context.get(ConfigService) as ConfigService;
  const queue = new SupabaseSupplierEvidenceReminderQueue(
    context.get(SupabaseService) as SupabaseService,
  );
  const notifier = new MailSupplierEvidenceReminderNotifierAdapter(
    context.get(MailService) as MailService,
  );
  return new SupplierEvidenceReminderWorker({
    workerId: randomUUID(),
    leaseSeconds:
      config.get<number>("SUPPLIER_EVIDENCE_REMINDER_LEASE_SECONDS") ?? 120,
    queue,
    notifier,
  });
}

/* istanbul ignore next -- the process entry guard is exercised by the runtime, not Jest. */
if (require.main === module) {
  void bootstrapSupplierEvidenceReminderWorker({
    argv: process.argv,
    createApplicationContext: () =>
      NestFactory.createApplicationContext(AppModule, { bufferLogs: false }),
    createWorker: workerFromContext,
    logger: new Logger("SupplierEvidenceReminderWorker"),
    sleep: sleepForSupplierEvidenceReminderWorkerCycle,
  });
}
