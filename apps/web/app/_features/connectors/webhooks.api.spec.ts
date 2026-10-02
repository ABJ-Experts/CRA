import { afterEach, describe, expect, it, vi } from "vitest";
import { webhooksApi } from "./webhooks.api";
const id = "11111111-1111-4111-8111-111111111111";
describe("WebhooksApi", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("rejects invalid paths before transport", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(webhooksApi.get("invalid")).rejects.toThrow();
    await expect(webhooksApi.detail(id, "invalid")).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects invalid outgoing requests before transport", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(webhooksApi.create({} as never)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("runtime parses successful responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ endpoint: { id, secretValue: "canary" } }),
            { status: 200 },
          ),
      ),
    );
    await expect(webhooksApi.get(id)).rejects.toThrow();
  });
  it("uses the static webhook route with bounded paging", async () => {
    const endpoints = {
      rows: [],
      total: 0,
      page: 2,
      pageSize: 25,
      pageCount: 1,
    };
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ endpoints }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(webhooksApi.list({ page: 2, pageSize: 25 })).resolves.toEqual({
      endpoints,
    });
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\/api\/v1\/connectors\/webhooks\?page=2&pageSize=25/,
      ),
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });
});

import {
  endpoint,
  delivery,
  preview,
  page,
  secret,
} from "./test/webhook-fixtures";
import { webhookVerificationExampleSchema } from "@repo/contracts/connectors/schemas";
const metadata = {
  expectedVersion: 1,
  idempotencyKey: "99999999-9999-4999-8999-999999999999",
};
const config = {
  displayName: endpoint.displayName,
  url: endpoint.url,
  eventTypes: endpoint.eventTypes,
  productIds: endpoint.productIds,
  retryPolicy: endpoint.retryPolicy,
};
describe("WebhooksApi commands and schema boundaries", () => {
  afterEach(() => vi.unstubAllGlobals());
  const operations = [
    [
      "get",
      `/api/v1/connectors/webhooks/${id}`,
      "GET",
      () => webhooksApi.get(id),
      { endpoint },
    ],
    [
      "create",
      "/api/v1/connectors/webhooks",
      "POST",
      () =>
        webhooksApi.create({
          ...config,
          secretValue: secret,
          idempotencyKey: metadata.idempotencyKey,
        }),
      { endpoint },
    ],
    [
      "update",
      `/api/v1/connectors/webhooks/${id}`,
      "PATCH",
      () => webhooksApi.update(id, { ...config, ...metadata }),
      { endpoint },
    ],
    [
      "secret",
      `/api/v1/connectors/webhooks/${id}/secret`,
      "POST",
      () =>
        webhooksApi.rotateSecret(id, {
          ...metadata,
          secretValue: secret,
          overlapSeconds: 3600,
        }),
      { endpoint },
    ],
    [
      "revoke",
      `/api/v1/connectors/webhooks/${id}/secret/revoke`,
      "POST",
      () =>
        webhooksApi.revokeSecret(id, {
          ...metadata,
          reason: "Compromised receiver",
        }),
      { endpoint },
    ],
    [
      "enable",
      `/api/v1/connectors/webhooks/${id}/enable`,
      "POST",
      () => webhooksApi.enable(id, metadata),
      { endpoint },
    ],
    [
      "disable",
      `/api/v1/connectors/webhooks/${id}/disable`,
      "POST",
      () => webhooksApi.disable(id, { ...metadata, reason: "Maintenance" }),
      { endpoint },
    ],
    [
      "test",
      `/api/v1/connectors/webhooks/${id}/test`,
      "POST",
      () => webhooksApi.test(id, metadata),
      { delivery },
    ],
    [
      "deliveries",
      `/api/v1/connectors/webhooks/${id}/deliveries?page=1&pageSize=15`,
      "GET",
      () => webhooksApi.deliveries(id),
      { deliveries: page([delivery]) },
    ],
    [
      "detail",
      `/api/v1/connectors/webhooks/${id}/deliveries/${delivery.id}?page=1&pageSize=15`,
      "GET",
      () => webhooksApi.detail(id, delivery.id),
      { detail: { delivery, attempts: page([]) } },
    ],
    [
      "preview",
      `/api/v1/connectors/webhooks/${id}/deliveries/${delivery.id}/replay/preview`,
      "POST",
      () =>
        webhooksApi.previewReplay(id, delivery.id, {
          expectedEndpointVersion: 1,
          expectedDeliveryVersion: 1,
        }),
      { preview },
    ],
    [
      "replay",
      `/api/v1/connectors/webhooks/${id}/deliveries/${delivery.id}/replay`,
      "POST",
      () =>
        webhooksApi.replay(id, delivery.id, {
          expectedEndpointVersion: 1,
          expectedDeliveryVersion: 1,
          previewDigest: preview.previewDigest,
          idempotencyKey: metadata.idempotencyKey,
          reason: "Receiver restored",
          confirmDestinationChange: true,
        }),
      { delivery },
    ],
  ] as const;
  it.each(operations)(
    "parses %s and supplies required transport schemas",
    async (_name, path, method, action, response) => {
      const fetcher = vi.fn(
        async () => new Response(JSON.stringify(response), { status: 200 }),
      );
      vi.stubGlobal("fetch", fetcher);
      await expect(action()).resolves.toEqual(response);
      expect(fetcher).toHaveBeenCalledWith(
        path,
        expect.objectContaining({
          method,
          credentials: "same-origin",
          cache: "no-store",
        }),
      );
    },
  );
  it("reads the real event catalogue and verification protocol", async () => {
    const verification = webhookVerificationExampleSchema.parse({
      algorithm: "HMAC-SHA-256",
      timestampHeader: "Cra-Webhook-Timestamp",
      eventIdHeader: "Cra-Webhook-Event-Id",
      deliveryIdHeader: "Cra-Webhook-Delivery-Id",
      signatureHeader: "Cra-Webhook-Signatures",
      replayWindowSeconds: 300,
      signedContent:
        "v1\\n<timestamp>\\n<key-id>\\n<event-id>\\n<delivery-id>\\n<exact-body-bytes>",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ eventTypes: [], verification }), {
            status: 200,
          }),
      ),
    );
    await expect(webhooksApi.catalogue()).resolves.toEqual({
      eventTypes: [],
      verification,
    });
  });
  it("rejects unsupported query fields rather than forwarding them", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(webhooksApi.list({ page: 0 })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("never automatically replays a mutation after expired authentication", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "Unauthorized" }), {
          status: 401,
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(webhooksApi.enable(id, metadata)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
