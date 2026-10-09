import {
  assertSafeWebhookMetadata,
  assertWebhookScope,
  webhookPayload,
  webhookReadPermissions,
} from "./webhook-policy";
import type { WebhookDelivery } from "@repo/contracts/connectors/types";
describe("webhook disclosure policy", () => {
  it("rejects retained canonical signing tokens in public operational metadata", () => {
    const secret = Buffer.alloc(32, 5).toString("base64");
    expect(() =>
      assertSafeWebhookMetadata({ reason: `Recovered ${secret}` }),
    ).toThrow();
    expect(() =>
      assertSafeWebhookMetadata({
        url: `https://receiver.example/${encodeURIComponent(secret)}`,
      }),
    ).toThrow();
    expect(() =>
      assertSafeWebhookMetadata({ reason: "Provider is available again" }),
    ).not.toThrow();
    expect(() =>
      assertSafeWebhookMetadata({ reason: "50% complete" }),
    ).not.toThrow();
    expect(() =>
      assertSafeWebhookMetadata({
        reason: `50% complete ${encodeURIComponent(secret)}`,
      }),
    ).toThrow();
  });

  it("requires owning-module permission for findings/reporting", () => {
    expect(webhookReadPermissions(["reporting.filing_recorded"])).toEqual([
      "can_view_products",
      "can_view_findings",
    ]);
    expect(webhookReadPermissions(["release.lifecycle_changed"])).toEqual([
      "can_view_products",
    ]);
    expect(
      webhookReadPermissions(["vulnerability.assessment.approved"]),
    ).toContain("can_view_findings");
  });
  it("rejects unknown, substituted or excessive product scope", () => {
    expect(() => assertWebhookScope(["p"], [])).toThrow();
    expect(() => assertWebhookScope(["p"], ["other"])).toThrow();
    expect(() => assertWebhookScope(["p"], Array(101).fill("p"))).toThrow();
    expect(() => assertWebhookScope(["p", "q"], ["p", "q"])).not.toThrow();
  });
  it("only emits approved resource references", () => {
    const body = webhookPayload(
      "org",
      {
        eventId: "event",
        deliveryId: "delivery",
        occurredAt: "time",
        eventType: "connector.sync_completed",
        secret: "secret-canary",
      } as unknown as WebhookDelivery,
      {
        productIds: ["p"],
        resource: { type: "product", id: "p", url: "/products/p" },
      },
    );
    expect(body).not.toContain("canary");
    expect(JSON.parse(body)).toMatchObject({
      schemaVersion: 1,
      organizationId: "org",
    });
    expect(() =>
      webhookPayload("org", { eventId: "a".repeat(9000) } as WebhookDelivery, {
        productIds: ["p"],
        resource: { type: "product", id: "p", url: "/products/p" },
      }),
    ).toThrow();
  });
});
