import "reflect-metadata";
import { ConnectorsWebhooksController } from "./connectors-webhooks.controller";
import { ConnectorsModule } from "./connectors.module";
import { WebhookUseCases } from "./application/webhook-use-cases";
import { ConnectorsService } from "./connectors.service";
import type { RequestUser } from "../auth/auth.types";
import {
  fixtureWebhookDelivery,
  fixtureWebhookEndpoint,
  webhookFixtureIds as ids,
} from "./application/webhook-test-fixtures";
import { webhookCatalogueResponseSchema } from "@repo/contracts/connectors/schemas";
import { MODULE_METADATA } from "@nestjs/common/constants";
function fixture() {
  const endpoint = fixtureWebhookEndpoint(),
    delivery = fixtureWebhookDelivery();
  const webhooks = {
    list: jest.fn().mockResolvedValue({ rows: [endpoint] }),
    get: jest.fn().mockResolvedValue(endpoint),
    create: jest.fn().mockResolvedValue(endpoint),
    update: jest.fn().mockResolvedValue(endpoint),
    rotateSecret: jest.fn().mockResolvedValue(endpoint),
    control: jest.fn().mockResolvedValue(endpoint),
    deliveries: jest.fn().mockResolvedValue({ rows: [delivery] }),
    delivery: jest.fn().mockResolvedValue({ delivery, attempts: { rows: [] } }),
    replayPreview: jest
      .fn()
      .mockResolvedValue({ previewDigest: "a".repeat(64) }),
    replay: jest.fn().mockResolvedValue(delivery),
  };
  const connectors = { run: jest.fn((promise: Promise<unknown>) => promise) };
  const controller = new ConnectorsWebhooksController(
    webhooks as unknown as WebhookUseCases,
    connectors as unknown as ConnectorsService,
  );
  const user = { id: ids.actor, organizationId: ids.org } as RequestUser;
  return { controller, webhooks, connectors, user, endpoint, delivery };
}
describe("ConnectorsWebhooksController thin validated routing", () => {
  it("does not register duplicate dependency providers", () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      ConnectorsModule,
    ) as unknown[];
    const tokens = providers.map((provider) =>
      typeof provider === "object" && provider !== null && "provide" in provider
        ? provider.provide
        : provider,
    );
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("registers static webhook routes before connector UUID routes", () => {
    expect(
      (
        Reflect.getMetadata(
          MODULE_METADATA.CONTROLLERS,
          ConnectorsModule,
        ) as unknown[]
      )[0],
    ).toBe(ConnectorsWebhooksController);
  });
  it("exposes precisely the approved catalogue and verification protocol", () => {
    const f = fixture();
    expect(
      webhookCatalogueResponseSchema.parse(f.controller.catalogue()).eventTypes,
    ).toHaveLength(15);
    expect(f.controller.verification().verification.algorithm).toBe(
      "HMAC-SHA-256",
    );
  });
  it("forwards organization-scoped reads", async () => {
    const f = fixture();
    expect(
      (await f.controller.list({ page: 1, pageSize: 15 }, f.user)).endpoints,
    ).toEqual({ rows: [f.endpoint] });
    expect(
      (await f.controller.get({ endpointId: ids.endpoint }, f.user)).endpoint,
    ).toBe(f.endpoint);
    await f.controller.deliveries(
      { endpointId: ids.endpoint },
      { page: 1, pageSize: 15 },
      f.user,
    );
    await f.controller.delivery(
      { endpointId: ids.endpoint, deliveryId: ids.delivery },
      { page: 1, pageSize: 15 },
      f.user,
    );
    expect(f.webhooks.delivery).toHaveBeenCalledWith(
      ids.org,
      ids.endpoint,
      ids.delivery,
      ids.actor,
      { page: 1, pageSize: 15 },
    );
  });
  it("forwards strictly parsed command values", async () => {
    const f = fixture();
    const input = {
      displayName: "Receiver",
      url: f.endpoint.url,
      eventTypes: f.endpoint.eventTypes,
      productIds: f.endpoint.productIds,
      retryPolicy: f.endpoint.retryPolicy,
      idempotencyKey: ids.idempotency,
    };
    await f.controller.create(input, f.user);
    await f.controller.update(
      { endpointId: ids.endpoint },
      { ...input, expectedVersion: 1 },
      f.user,
    );
    await f.controller.rotate(
      { endpointId: ids.endpoint },
      {
        secretValue: Buffer.alloc(32).toString("base64"),
        expectedVersion: 1,
        idempotencyKey: ids.idempotency,
        overlapSeconds: 3600,
      },
      f.user,
    );
    expect(f.webhooks.create).toHaveBeenCalledWith(ids.org, ids.actor, input);
    expect(f.webhooks.rotateSecret).toHaveBeenCalledWith(
      ids.org,
      ids.endpoint,
      ids.actor,
      expect.objectContaining({ overlapSeconds: 3600 }),
    );
  });
  it("forwards controls without storage calls", async () => {
    const f = fixture();
    const params = { endpointId: ids.endpoint };
    const input = {
      expectedVersion: 1,
      idempotencyKey: ids.idempotency,
      reason: "Reviewed",
    };
    await f.controller.enable(params, input, f.user);
    await f.controller.disable(params, input, f.user);
    await f.controller.revoke(params, input, f.user);
    await f.controller.test(params, input, f.user);
    expect(
      f.webhooks.control.mock.calls.map((call: unknown[]) => call[3]),
    ).toEqual(["enable", "disable", "revoke_secret", "test"]);
  });
  it("forwards preview and replay metadata", async () => {
    const f = fixture();
    const params = { endpointId: ids.endpoint, deliveryId: ids.delivery };
    const input = { expectedEndpointVersion: 1, expectedDeliveryVersion: 2 };
    await f.controller.replayPreview(params, input, f.user);
    await f.controller.replay(
      params,
      {
        ...input,
        previewDigest: "a".repeat(64),
        idempotencyKey: ids.idempotency,
        reason: "Recovered receiver",
        confirmDestinationChange: true,
      },
      f.user,
    );
    expect(f.webhooks.replay).toHaveBeenCalledWith(
      ids.org,
      ids.endpoint,
      ids.delivery,
      ids.actor,
      expect.objectContaining({ confirmDestinationChange: true }),
    );
  });
  it("denies missing tenant identity before application work", async () => {
    const f = fixture();
    await expect(
      f.controller.get({ endpointId: ids.endpoint }, {
        id: ids.actor,
      } as RequestUser),
    ).rejects.toThrow("Connector request could not be completed");
    expect(f.webhooks.get).not.toHaveBeenCalled();
  });
});
