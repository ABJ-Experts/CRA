import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { WebhookDeliveryWorker } from "./connectors/worker/webhook-delivery-worker";
const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
export async function runWebhookWorker(
  arguments_: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: false,
  });
  const logger = new Logger("WebhookDeliveryWorker");
  const worker = app.get(WebhookDeliveryWorker);
  const once = arguments_.includes("--once");
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    do {
      try {
        await worker.tick();
      } catch {
        logger.error("Webhook delivery cycle failed safely");
      }
      if (!once && !stopping) await delay(1000);
    } while (!once && !stopping);
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    await app.close();
  }
}
export function failWebhookWorker(): void {
  new Logger("WebhookDeliveryWorker").error(
    "Webhook worker startup failed safely",
  );
  process.exitCode = 1;
}
if (require.main === module) void runWebhookWorker().catch(failWebhookWorker);
