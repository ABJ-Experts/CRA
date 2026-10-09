import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { randomUUID } from "node:crypto";

import { AppModule } from "./app.module";
import { AesGcmConnectorVault } from "./connectors/infrastructure/connector-vault";
import { MailService } from "./mail/mail.service";
import { BurstNotificationDispatchWorker } from "./notifications/worker/burst-notification-dispatch-worker";
import { ChatNotificationWorker } from "./notifications/worker/chat-notification-worker";
import { ChatProviderDeliveryAdapter } from "./notifications/worker/chat-provider-delivery.adapter";
import { MailNotificationDispatchDeliveryAdapter } from "./notifications/worker/mail-notification-dispatch-delivery.adapter";
import { DigestNotificationDispatchWorker } from "./notifications/worker/digest-notification-dispatch-worker";
import { NotificationDispatchWorker } from "./notifications/worker/notification-dispatch-worker";
import { SupabaseNotificationDigestQueueAdapter } from "./notifications/worker/supabase-notification-digest-queue.adapter";
import { SupabaseNotificationBurstQueueAdapter } from "./notifications/worker/supabase-notification-burst-queue.adapter";
import { SupabaseNotificationDispatchQueueAdapter } from "./notifications/worker/supabase-notification-dispatch-queue.adapter";
import { SupabaseChatNotificationQueueAdapter } from "./notifications/worker/supabase-chat-notification-queue.adapter";
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
    createBurstWorker?: (
      context: WorkerApplicationContext,
    ) => BurstNotificationDispatchWorker;
    createChatWorker?: (
      context: WorkerApplicationContext,
    ) => ChatNotificationWorker;
    logger: Pick<Logger, "error">;
    sleep: (milliseconds: number) => Promise<void>;
  }>,
): Promise<void> {
  const context = await options.createApplicationContext();
  const once = options.argv.includes("--once");
  try {
    const worker = options.createWorker(context);
    const digestWorker = options.createDigestWorker?.(context);
    let burstWorker: BurstNotificationDispatchWorker | undefined;
    try {
      burstWorker = options.createBurstWorker?.(context);
    } catch {
      options.logger.error("Notification burst worker unavailable");
    }
    let chatWorker: ChatNotificationWorker | undefined;
    try {
      chatWorker = options.createChatWorker?.(context);
    } catch {
      options.logger.error("Chat notification worker unavailable");
    }
    const runLoop = async (runOnce: () => Promise<void>, error: string) => {
      do {
        try {
          await runOnce();
        } catch {
          options.logger.error(error);
        }
        if (!once) await options.sleep(30_000);
      } while (!once);
    };
    await Promise.all([
      runLoop(
        () => worker.runOnce(),
        "Notification dispatch cycle failed safely",
      ),
      digestWorker
        ? runLoop(
            () => digestWorker.runOnce(),
            "Notification digest cycle failed safely",
          )
        : undefined,
      burstWorker
        ? runLoop(
            () => burstWorker.runOnce(),
            "Notification burst cycle failed safely",
          )
        : undefined,
      chatWorker
        ? runLoop(
            () => chatWorker.runOnce(),
            "Chat notification cycle failed safely",
          )
        : undefined,
    ]);
  } finally {
    await context.close();
  }
}

export function burstWorkerFromContext(
  context: WorkerApplicationContext,
): BurstNotificationDispatchWorker {
  const mail = new MailNotificationDispatchDeliveryAdapter(
    context.get(MailService) as MailService,
  );
  return new BurstNotificationDispatchWorker({
    workerId: randomUUID(),
    leaseSeconds: 120,
    queue: new SupabaseNotificationBurstQueueAdapter(
      context.get(SupabaseService) as SupabaseService,
    ),
    delivery: {
      send: (input) => mail.send({ ...input, dispatchId: input.batchId }),
    },
  });
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

export function chatWorkerFromContext(
  context: WorkerApplicationContext,
): ChatNotificationWorker {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  return new ChatNotificationWorker({
    workerId: randomUUID(),
    leaseSeconds: 120,
    queue: new SupabaseChatNotificationQueueAdapter(
      context.get(SupabaseService) as SupabaseService,
      new AesGcmConnectorVault(process.env.CONNECTOR_VAULT_KEYRING),
      appUrl,
    ),
    delivery: new ChatProviderDeliveryAdapter(undefined, appUrl),
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
    createBurstWorker: burstWorkerFromContext,
    createChatWorker: chatWorkerFromContext,
    logger: new Logger("NotificationDispatchWorker"),
    sleep,
  });
}
