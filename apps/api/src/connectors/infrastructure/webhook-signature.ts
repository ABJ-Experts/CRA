import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  webhookEventEnvelopeSchema,
  webhookEventIdSchema,
  webhookSecretValueSchema,
} from "@repo/contracts/connectors/schemas";

const signingKeySchema = z
  .object({ keyId: z.uuid(), secret: webhookSecretValueSchema })
  .strict();
const signingKeysSchema = z
  .array(signingKeySchema)
  .min(1)
  .max(2)
  .refine((keys) => new Set(keys.map((key) => key.keyId)).size === keys.length);
type SigningKey = z.output<typeof signingKeySchema>;
type Identity = Readonly<{ eventId: string; deliveryId: string }>;
type SignatureInput = Identity &
  Readonly<{ body: Buffer; keys: readonly SigningKey[]; now?: Date }>;
export type WebhookSignatureHeaders = Readonly<{
  "Cra-Webhook-Timestamp": string;
  "Cra-Webhook-Event-Id": string;
  "Cra-Webhook-Delivery-Id": string;
  "Cra-Webhook-Signatures": string;
}>;

export function signWebhookBytes(
  input: SignatureInput,
): WebhookSignatureHeaders {
  validateBody(input.body, input);
  const keys = signingKeysSchema.parse(input.keys);
  const at = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (!Number.isSafeInteger(at) || at < 0)
    throw new Error("Invalid signing time");
  const timestamp = String(at);
  return Object.freeze({
    "Cra-Webhook-Timestamp": timestamp,
    "Cra-Webhook-Event-Id": input.eventId,
    "Cra-Webhook-Delivery-Id": input.deliveryId,
    "Cra-Webhook-Signatures": keys
      .map(
        (key) =>
          `kid=${key.keyId};v1=${signature(input.body, key, timestamp, input)}`,
      )
      .join(","),
  });
}

/** Receiver helper: persist event/delivery deduplication separately after verification. */
export function verifyWebhookBytes(
  input: SignatureInput & Readonly<{ timestamp: string; signatures: string }>,
): boolean {
  try {
    validateBody(input.body, input);
    const keys = signingKeysSchema.parse(input.keys);
    if (
      !/^(0|[1-9]\d{0,15})$/.test(input.timestamp) ||
      input.signatures.length > 1024
    )
      return false;
    const at = Number(input.timestamp);
    const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
    if (
      !Number.isSafeInteger(at) ||
      !Number.isSafeInteger(now) ||
      Math.abs(now - at) > 300
    )
      return false;
    const parts = input.signatures.split(",");
    if (parts.length < 1 || parts.length > 2) return false;
    const entries = parts.map((part) =>
      /^kid=([a-f0-9-]{36});v1=([a-f0-9]{64})$/.exec(part),
    );
    if (
      entries.some((entry) => !entry) ||
      new Set(entries.map((entry) => entry![1])).size !== entries.length
    )
      return false;
    return entries.some((entry) => {
      const key = keys.find((candidate) => candidate.keyId === entry![1]);
      if (!key) return false;
      const expected = Buffer.from(
        signature(input.body, key, input.timestamp, input),
        "hex",
      );
      const received = Buffer.from(entry![2]!, "hex");
      return timingSafeEqual(expected, received);
    });
  } catch {
    return false;
  }
}

function validateBody(body: Buffer, identity: Identity): void {
  if (!Buffer.isBuffer(body) || body.length < 1 || body.length > 8192)
    throw new Error("Invalid webhook bytes");
  webhookEventIdSchema.parse(identity.eventId);
  z.uuid().parse(identity.deliveryId);
  const envelope = webhookEventEnvelopeSchema.parse(
    JSON.parse(body.toString("utf8")) as unknown,
  );
  if (
    envelope.eventId !== identity.eventId ||
    envelope.deliveryId !== identity.deliveryId
  )
    throw new Error("Webhook identity mismatch");
}

function signature(
  body: Buffer,
  key: SigningKey,
  timestamp: string,
  identity: Identity,
): string {
  return createHmac("sha256", Buffer.from(key.secret, "base64"))
    .update(
      `v1\n${timestamp}\n${key.keyId}\n${identity.eventId}\n${identity.deliveryId}\n`,
    )
    .update(body)
    .digest("hex");
}

export const webhookVerificationExample = Object.freeze({
  algorithm: "HMAC-SHA-256" as const,
  timestampHeader: "Cra-Webhook-Timestamp" as const,
  eventIdHeader: "Cra-Webhook-Event-Id" as const,
  deliveryIdHeader: "Cra-Webhook-Delivery-Id" as const,
  signatureHeader: "Cra-Webhook-Signatures" as const,
  replayWindowSeconds: 300 as const,
  signedContent:
    "v1\\n<timestamp>\\n<key-id>\\n<event-id>\\n<delivery-id>\\n<exact-body-bytes>" as const,
});
