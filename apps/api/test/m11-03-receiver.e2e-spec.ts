import { randomBytes, randomUUID } from "node:crypto";
import { signWebhookBytes } from "../src/connectors/infrastructure/webhook-signature";
import { M1103Receiver } from "./m11-03-receiver";

describe("M11-03 isolated HTTPS receiver", () => {
  it("verifies transmitted bytes and rejects tamper, stale time and unknown keys", async () => {
    const receiver = await M1103Receiver.start();
    try {
      const key = {
        keyId: randomUUID(),
        secret: randomBytes(32).toString("base64"),
      };
      receiver.setKeys([key]);
      const eventId = `evt_${"a".repeat(64)}`;
      const deliveryId = randomUUID();
      const body = Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          eventId,
          deliveryId,
          eventType: "webhook.test",
          organizationId: randomUUID(),
          occurredAt: new Date().toISOString(),
          resource: {
            type: "connector",
            id: randomUUID(),
            url: "/connectors/webhooks",
          },
        }),
      );
      const headers = signWebhookBytes({
        body,
        keys: [key],
        eventId,
        deliveryId,
      });
      expect(
        (await receiver.transport.post({ url: receiver.url, body, headers }))
          .outcome,
      ).toBe("succeeded");
      expect(receiver.captures[0]?.verifiedKeyIds).toEqual([key.keyId]);
      for (const input of [
        { body: Buffer.from(`${body.toString()} `), headers },
        {
          body,
          headers: signWebhookBytes({
            body,
            keys: [key],
            eventId,
            deliveryId,
            now: new Date(Date.now() - 301_000),
          }),
        },
        {
          body,
          headers: signWebhookBytes({
            body,
            keys: [{ ...key, keyId: randomUUID() }],
            eventId,
            deliveryId,
          }),
        },
      ]) {
        expect(
          await receiver.transport.post({ url: receiver.url, ...input }),
        ).toMatchObject({ outcome: "failed", status: 401 });
      }
      receiver.behavior = "rate_limit";
      expect(
        await receiver.transport.post({ url: receiver.url, body, headers }),
      ).toMatchObject({
        outcome: "failed",
        category: "rate_limit",
        retryAfterSeconds: 5,
      });
      receiver.behavior = "outage";
      expect(
        await receiver.transport.post({ url: receiver.url, body, headers }),
      ).toMatchObject({
        outcome: "failed",
        category: "receiver_unavailable",
        status: 503,
        responseBytes: 0,
      });
      receiver.behavior = "timeout";
      expect(
        await receiver.transport.post({ url: receiver.url, body, headers }),
      ).toMatchObject({
        outcome: "failed",
        category: "timeout",
        status: null,
        responseBytes: 0,
      });
      expect(receiver.captures.at(-1)?.verifiedKeyIds).toEqual([key.keyId]);
    } finally {
      await receiver.close();
    }
  });
});
