import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { randomUUID } from "node:crypto";

import { AppModule } from "./app.module";
import { MailService } from "./mail/mail.service";
import { MailNotificationDispatchDeliveryAdapter } from "./notifications/worker/mail-notification-dispatch-delivery.adapter";
import { DigestNotificationDispatchWorker } from "./notifications/worker/digest-notification-dispatch-worker";
import { NotificationDispatchWorker } from "./notifications/worker/notification-dispatch-worker";
import { SupabaseNotificationDigestQueueAdapter } from "./notifications/worker/supabase-notification-digest-queue.adapter";
import { SupabaseNotificationDispatchQueueAdapter } from "./notifications/worker/supabase-notification-dispatch-queue.adapter";
import { SupabaseService } from "./supabase/supabase.service";

type WorkerApplicationContext = Readonly<{
  get(typeOrToken: unknown): unknown;
  close(): Promise<void>;
}>;

export const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function bootstrapNotificationDispatchWorker(
  options: Readonly<{
    argv: readonly string[];
    createApplicationContext: () => Promise<WorkerApplicationContext>;
    createWorker: (
      context: WorkerApplicationContext,
    ) => NotificationDispatchWorker;
    createDigestWorker?: (
      context: WorkerApplicationContext,
    ) => DigestNotificationDispatchWorker;
    logger: Pick<Logger, "error">;
    sleep: (milliseconds: number) => Promise<void>;
  }>,
): Promise<void> {
  const context = await options.createApplicationContext();
  const once = options.argv.includes("--once");
  try {
    const worker = options.createWorker(context);
    const digestWorker = options.createDigestWorker?.(context);
    do {
      await Promise.all([
        worker.runOnce().catch(() => {
          options.logger.error("Notification dispatch cycle failed safely");
        }),
        digestWorker?.runOnce().catch(() => {
          options.logger.error("Notification digest cycle failed safely");
        }),
      ]);
      if (!once) await options.sleep(30_000);
    } while (!once);
  } finally {
    await context.close();
  }
}

export function digestWorkerFromContext(
  context: WorkerApplicationContext,
): DigestNotificationDispatchWorker {
  const mail = new MailNotificationDispatchDeliveryAdapter(
    context.get(MailService) as MailService,
  );
  return new DigestNotificationDispatchWorker({
    workerId: randomUUID(),
    leaseSeconds: 120,
    queue: new SupabaseNotificationDigestQueueAdapter(
      context.get(SupabaseService) as SupabaseService,
    ),
    delivery: {
      send: (input) => mail.send({ ...input, dispatchId: input.batchId }),
    },
  });
}

export function workerFromContext(
  context: WorkerApplicationContext,
): NotificationDispatchWorker {
  return new NotificationDispatchWorker({
    workerId: randomUUID(),
    leaseSeconds: 120,
    queue: new SupabaseNotificationDispatchQueueAdapter(
      context.get(SupabaseService) as SupabaseService,
    ),
    delivery: new MailNotificationDispatchDeliveryAdapter(
      context.get(MailService) as MailService,
    ),
  });
}

/* istanbul ignore next -- the process entry guard is exercised by the runtime. */
if (require.main === module) {
  void bootstrapNotificationDispatchWorker({
    argv: process.argv,
    createApplicationContext: () =>
      NestFactory.createApplicationContext(AppModule, { bufferLogs: false }),
    createWorker: workerFromContext,
    createDigestWorker: digestWorkerFromContext,
    logger: new Logger("NotificationDispatchWorker"),
    sleep,
  });
}
