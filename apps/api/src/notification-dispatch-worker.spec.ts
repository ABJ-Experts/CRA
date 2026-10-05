import {
  bootstrapNotificationDispatchWorker,
  digestWorkerFromContext,
  chatWorkerFromContext,
  sleep,
  workerFromContext,
} from "./notification-dispatch-worker";
import { MailService } from "./mail/mail.service";
import { MailNotificationDispatchDeliveryAdapter } from "./notifications/worker/mail-notification-dispatch-delivery.adapter";
import { DigestNotificationDispatchWorker } from "./notifications/worker/digest-notification-dispatch-worker";
import { ChatNotificationWorker } from "./notifications/worker/chat-notification-worker";
import { NotificationDispatchWorker } from "./notifications/worker/notification-dispatch-worker";
import { SupabaseNotificationDigestQueueAdapter } from "./notifications/worker/supabase-notification-digest-queue.adapter";
import { SupabaseNotificationDispatchQueueAdapter } from "./notifications/worker/supabase-notification-dispatch-queue.adapter";
import { SupabaseChatNotificationQueueAdapter } from "./notifications/worker/supabase-chat-notification-queue.adapter";
import { SupabaseService } from "./supabase/supabase.service";

describe("notification dispatch process", () => {
  it("waits for the requested interval before the next worker cycle", async () => {
    jest.useFakeTimers();
    try {
      const pending = sleep(30_000);
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await jest.advanceTimersByTimeAsync(29_999);
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toBeUndefined();
      expect(settled).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it("runs a single bounded cycle and closes the application context", async () => {
    const runOnce = jest.fn().mockResolvedValue(undefined);
    const close = jest.fn().mockResolvedValue(undefined);
    const sleep = jest.fn().mockResolvedValue(undefined);

    await bootstrapNotificationDispatchWorker({
      argv: ["--once"],
      createApplicationContext: () =>
        Promise.resolve({ get: jest.fn(), close }),
      createWorker: () => ({ runOnce }) as never,
      logger: { error: jest.fn() },
      sleep,
    });

    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("runs digest work even when optional immediate dispatch fails", async () => {
    const digestRunOnce = jest.fn().mockResolvedValue(undefined);
    const close = jest.fn().mockResolvedValue(undefined);
    const error = jest.fn();

    await bootstrapNotificationDispatchWorker({
      argv: ["--once"],
      createApplicationContext: () =>
        Promise.resolve({ get: jest.fn(), close }),
      createWorker: () =>
        ({
          runOnce: jest.fn().mockRejectedValue(new Error("outage")),
        }) as never,
      createDigestWorker: () => ({ runOnce: digestRunOnce }) as never,
      logger: { error },
      sleep: jest.fn(),
    });

    expect(digestRunOnce).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      "Notification dispatch cycle failed safely",
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("runs chat delivery when email dispatch fails, without blocking other delivery", async () => {
    const chatRunOnce = jest.fn().mockResolvedValue(undefined);
    const digestRunOnce = jest.fn().mockResolvedValue(undefined);
    const error = jest.fn();

    await bootstrapNotificationDispatchWorker({
      argv: ["--once"],
      createApplicationContext: () =>
        Promise.resolve({ get: jest.fn(), close: jest.fn() }),
      createWorker: () =>
        ({
          runOnce: jest.fn().mockRejectedValue(new Error("mail outage")),
        }) as never,
      createDigestWorker: () => ({ runOnce: digestRunOnce }) as never,
      createChatWorker: () => ({ runOnce: chatRunOnce }) as never,
      logger: { error },
      sleep: jest.fn(),
    });

    expect(chatRunOnce).toHaveBeenCalledTimes(1);
    expect(digestRunOnce).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      "Notification dispatch cycle failed safely",
    );
  });

  it("starts the next email cycle while a chat send is still pending", async () => {
    let finishChat: (() => void) | undefined;
    const pendingChat = new Promise<void>((resolve) => {
      finishChat = resolve;
    });
    const mailRunOnce = jest.fn().mockResolvedValue(undefined);
    const stopped = new Error("stop test loops");
    const sleep = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(stopped);
    const running = bootstrapNotificationDispatchWorker({
      argv: [],
      createApplicationContext: () =>
        Promise.resolve({ get: jest.fn(), close: jest.fn() }),
      createWorker: () => ({ runOnce: mailRunOnce }) as never,
      createChatWorker: () => ({ runOnce: () => pendingChat }) as never,
      logger: { error: jest.fn() },
      sleep,
    });
    const observed = expect(running).rejects.toBe(stopped);
    await new Promise((resolve) => setImmediate(resolve));
    expect(mailRunOnce).toHaveBeenCalledTimes(2);
    finishChat?.();
    await observed;
  });

  it("keeps email and digest work running if chat worker configuration is unavailable", async () => {
    const mailRunOnce = jest.fn().mockResolvedValue(undefined);
    const digestRunOnce = jest.fn().mockResolvedValue(undefined);
    const error = jest.fn();

    await bootstrapNotificationDispatchWorker({
      argv: ["--once"],
      createApplicationContext: () =>
        Promise.resolve({ get: jest.fn(), close: jest.fn() }),
      createWorker: () => ({ runOnce: mailRunOnce }) as never,
      createDigestWorker: () => ({ runOnce: digestRunOnce }) as never,
      createChatWorker: () => {
        throw new Error("bad chat origin");
      },
      logger: { error },
      sleep: jest.fn(),
    });

    expect(mailRunOnce).toHaveBeenCalledTimes(1);
    expect(digestRunOnce).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("Chat notification worker unavailable");
  });

  it("closes the context if worker construction fails", async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    await expect(
      bootstrapNotificationDispatchWorker({
        argv: ["--once"],
        createApplicationContext: () =>
          Promise.resolve({ get: jest.fn(), close }),
        createWorker: () => {
          throw new Error("invalid worker configuration");
        },
        logger: { error: jest.fn() },
        sleep: jest.fn(),
      }),
    ).rejects.toThrow("invalid worker configuration");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("starts digest work while immediate delivery is still pending", async () => {
    let finishImmediate: (() => void) | undefined;
    const immediate = new Promise<void>((resolve) => {
      finishImmediate = resolve;
    });
    const digestRunOnce = jest.fn().mockResolvedValue(undefined);
    const running = bootstrapNotificationDispatchWorker({
      argv: ["--once"],
      createApplicationContext: () =>
        Promise.resolve({ get: jest.fn(), close: jest.fn() }),
      createWorker: () => ({ runOnce: () => immediate }) as never,
      createDigestWorker: () => ({ runOnce: digestRunOnce }) as never,
      logger: { error: jest.fn() },
      sleep: jest.fn(),
    });
    await Promise.resolve();
    expect(digestRunOnce).toHaveBeenCalledTimes(1);
    finishImmediate?.();
    await running;
  });

  it("continues immediate work when the digest cycle fails and closes the context", async () => {
    const immediate = jest.fn().mockResolvedValue(undefined);
    const close = jest.fn().mockResolvedValue(undefined);
    const error = jest.fn();

    await bootstrapNotificationDispatchWorker({
      argv: ["--once"],
      createApplicationContext: () =>
        Promise.resolve({ get: jest.fn(), close }),
      createWorker: () => ({ runOnce: immediate }) as never,
      createDigestWorker: () =>
        ({
          runOnce: jest
            .fn()
            .mockRejectedValue(new Error("private relay failure")),
        }) as never,
      logger: { error },
      sleep: jest.fn(),
    });

    expect(immediate).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      "Notification digest cycle failed safely",
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("runs repeated bounded cycles until the process is stopped", async () => {
    const runOnce = jest.fn().mockResolvedValue(undefined);
    const close = jest.fn().mockResolvedValue(undefined);
    const stopped = new Error("stop requested");
    const sleep = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(stopped);

    await expect(
      bootstrapNotificationDispatchWorker({
        argv: [],
        createApplicationContext: () =>
          Promise.resolve({ get: jest.fn(), close }),
        createWorker: () => ({ runOnce }) as never,
        logger: { error: jest.fn() },
        sleep,
      }),
    ).rejects.toBe(stopped);

    expect(runOnce).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 30_000);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes the context when digest construction fails", async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    await expect(
      bootstrapNotificationDispatchWorker({
        argv: ["--once"],
        createApplicationContext: () =>
          Promise.resolve({ get: jest.fn(), close }),
        createWorker: () => ({ runOnce: jest.fn() }) as never,
        createDigestWorker: () => {
          throw new Error("invalid digest configuration");
        },
        logger: { error: jest.fn() },
        sleep: jest.fn(),
      }),
    ).rejects.toThrow("invalid digest configuration");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("wires separate immediate and digest queues to the shared mail service", async () => {
    const sendNotificationDigest = jest.fn().mockResolvedValue({
      status: "provider_accepted",
      providerMessageId: "<digest@relay.test>",
      acceptedRecipients: ["owner@cra.test"],
      rejectedRecipients: [],
      deliveryConfirmed: false,
    });
    const mail = { sendNotificationDigest } as unknown as MailService;
    const supabase = {} as SupabaseService;
    const get = jest.fn((token: unknown) =>
      token === MailService ? mail : supabase,
    );
    const context = { get, close: jest.fn().mockResolvedValue(undefined) };

    const immediate = workerFromContext(context);
    const digest = digestWorkerFromContext(context);
    const chat = chatWorkerFromContext(context);
    const immediateDependencies = (
      immediate as unknown as {
        dependencies: { queue: unknown; delivery: unknown };
      }
    ).dependencies;
    const digestDependencies = (
      digest as unknown as {
        dependencies: {
          queue: unknown;
          delivery: { send: (input: unknown) => Promise<unknown> };
        };
      }
    ).dependencies;

    expect(immediate).toBeInstanceOf(NotificationDispatchWorker);
    expect(immediateDependencies.queue).toBeInstanceOf(
      SupabaseNotificationDispatchQueueAdapter,
    );
    expect(immediateDependencies.delivery).toBeInstanceOf(
      MailNotificationDispatchDeliveryAdapter,
    );
    expect(digest).toBeInstanceOf(DigestNotificationDispatchWorker);
    expect(chat).toBeInstanceOf(ChatNotificationWorker);
    expect(
      (chat as unknown as { dependencies: { queue: unknown } }).dependencies
        .queue,
    ).toBeInstanceOf(SupabaseChatNotificationQueueAdapter);
    expect(digestDependencies.queue).toBeInstanceOf(
      SupabaseNotificationDigestQueueAdapter,
    );
    expect(get).toHaveBeenCalledWith(SupabaseService);
    expect(get).toHaveBeenCalledWith(MailService);

    await expect(
      digestDependencies.delivery.send({
        organizationId: "11111111-1111-4111-8111-111111111111",
        batchId: "22222222-2222-4222-8222-222222222222",
        recipient: {
          userId: "33333333-3333-4333-8333-333333333333",
          email: "owner@cra.test",
        },
        idempotencyKey: "digest:1",
        payload: { kind: "digest", items: [] },
      }),
    ).resolves.toMatchObject({ status: "provider_accepted" });
    expect(sendNotificationDigest).toHaveBeenCalledWith(
      "owner@cra.test",
      [],
      "digest:1",
    );
  });
});
