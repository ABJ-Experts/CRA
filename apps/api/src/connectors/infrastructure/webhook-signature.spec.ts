import { createHmac } from "node:crypto";
import { signWebhookBytes, verifyWebhookBytes } from "./webhook-signature";

const eventId = `evt_${"a".repeat(64)}`;
const deliveryId = "11111111-1111-4111-8111-111111111111";
const keyId = "22222222-2222-4222-8222-222222222222";
const secondId = "33333333-3333-4333-8333-333333333333";
const secret = Buffer.alloc(32, 7).toString("base64");
const now = new Date("2026-09-29T12:00:00Z");
const body = Buffer.from(
  JSON.stringify({
    schemaVersion: 1,
    eventId,
    deliveryId,
    occurredAt: now.toISOString(),
    eventType: "connector.sync_completed",
    organizationId: deliveryId,
    resource: {
      type: "sync_run",
      id: deliveryId,
      url: "/connectors/" + deliveryId,
    },
  }),
);
const keys = [{ keyId, secret }];
const sign = () => signWebhookBytes({ body, eventId, deliveryId, keys, now });
const verify = (
  overrides: Partial<Parameters<typeof verifyWebhookBytes>[0]> = {},
) => {
  const headers = sign();
  return verifyWebhookBytes({
    body,
    eventId,
    deliveryId,
    keys,
    timestamp: headers["Cra-Webhook-Timestamp"],
    signatures: headers["Cra-Webhook-Signatures"],
    now,
    ...overrides,
  });
};

describe("webhook exact-byte signatures", () => {
  it("binds the exact bytes, version, public key and event/delivery identities", () => {
    const headers = sign();
    const timestamp = String(now.getTime() / 1000);
    const expected = createHmac("sha256", Buffer.from(secret, "base64"))
      .update(`v1\n${timestamp}\n${keyId}\n${eventId}\n${deliveryId}\n`)
      .update(body)
      .digest("hex");
    expect(headers).toEqual({
      "Cra-Webhook-Timestamp": timestamp,
      "Cra-Webhook-Event-Id": eventId,
      "Cra-Webhook-Delivery-Id": deliveryId,
      "Cra-Webhook-Signatures": `kid=${keyId};v1=${expected}`,
    });
    expect(verify()).toBe(true);
  });
  it("rejects whitespace/non-ASCII body tampering and different identities", () => {
    expect(verify({ body: Buffer.concat([body, Buffer.from(" ")]) })).toBe(
      false,
    );
    expect(
      verify({ body: Buffer.from(body.toString().replace("sync_run", "é")) }),
    ).toBe(false);
    expect(verify({ eventId: `evt_${"b".repeat(64)}` })).toBe(false);
    expect(verify({ deliveryId: secondId })).toBe(false);
    expect(verify({ keys: [{ keyId: secondId, secret }] })).toBe(false);
    expect(
      verify({
        keys: [{ keyId, secret: Buffer.alloc(32, 8).toString("base64") }],
      }),
    ).toBe(false);
  });
  it("supports two independently verifiable signatures during rotation", () => {
    const old = {
      keyId: secondId,
      secret: Buffer.alloc(32, 9).toString("base64"),
    };
    const headers = signWebhookBytes({
      body,
      eventId,
      deliveryId,
      keys: [...keys, old],
      now,
    });
    expect(
      verify({ signatures: headers["Cra-Webhook-Signatures"], keys: [old] }),
    ).toBe(true);
    expect(
      verify({ signatures: headers["Cra-Webhook-Signatures"], keys }),
    ).toBe(true);
    expect(
      verify({
        signatures: headers["Cra-Webhook-Signatures"],
        keys: [{ keyId: secondId, secret }],
      }),
    ).toBe(false);
  });
  it("uses a strict five-minute window in either direction", () => {
    expect(verify({ now: new Date(now.getTime() + 300_000) })).toBe(true);
    expect(verify({ now: new Date(now.getTime() - 300_000) })).toBe(true);
    expect(verify({ now: new Date(now.getTime() + 301_000) })).toBe(false);
    expect(verify({ now: new Date(now.getTime() - 301_000) })).toBe(false);
    for (const timestamp of [
      "",
      " 1",
      "1.0",
      "1e3",
      "-1",
      "NaN",
      "9999999999999999999999",
    ])
      expect(verify({ timestamp })).toBe(false);
    expect(verify({ now: new Date("invalid") })).toBe(false);
  });
  it("rejects malformed, duplicate, overlong and invalid-hex headers", () => {
    for (const signatures of [
      "",
      "v1=bad",
      `kid=${keyId};v1=${"g".repeat(64)}`,
      `${sign()["Cra-Webhook-Signatures"]},${sign()["Cra-Webhook-Signatures"]}`,
      "x".repeat(1025),
    ])
      expect(verify({ signatures })).toBe(false);
  });
  it("rejects unknown or malformed envelopes and invalid signing input", () => {
    expect(verify({ body: Buffer.from("not json") })).toBe(false);
    expect(
      verify({ body: Buffer.from(JSON.stringify({ eventId, deliveryId })) }),
    ).toBe(false);
    for (const keys of [
      [],
      [{ keyId, secret: "not-base64" }],
      [{ keyId, secret: Buffer.alloc(31).toString("base64") }],
      [{ keyId: "bad", secret }],
      [
        { keyId, secret },
        { keyId, secret },
      ],
      Array.from({ length: 3 }, (_, i) => ({
        keyId: [keyId, secondId, deliveryId][i]!,
        secret,
      })),
    ])
      expect(() =>
        signWebhookBytes({ body, eventId, deliveryId, keys, now }),
      ).toThrow();
    expect(() =>
      signWebhookBytes({
        body: Buffer.alloc(8193),
        eventId,
        deliveryId,
        keys,
        now,
      }),
    ).toThrow();
    expect(() =>
      signWebhookBytes({
        body,
        eventId,
        deliveryId,
        keys,
        now: new Date("invalid"),
      }),
    ).toThrow();
  });
});
