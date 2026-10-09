import {
  WebhookDeliveryWorker,
  type WebhookTransportPort,
} from "./webhook-delivery-worker";
import {
  fixtureWebhookDelivery,
  webhookFixtureIds as ids,
} from "../application/webhook-test-fixtures";
import type {
  ClaimedWebhookDelivery,
  WebhookRepositoryPort,
} from "../application/webhook-repository.port";
import type { WebhookVaultPort } from "../application/webhook-vault.port";
function fixture() {
  const delivery = fixtureWebhookDelivery();
  const claim: ClaimedWebhookDelivery = {
    delivery,
    productIds: [ids.product],
    sourceKind: "product_event",
    sourceId: ids.source,
    destinationRevision: 1,
    scopeRevision: 1,
    destinationUrl: "https://receiver.example/events",
    endpoint: {
      id: ids.endpoint,
      url: "https://receiver.example/events",
      secretRevision: 1,
      active: {
        keyId: ids.key,
        secretId: ids.key,
        revision: 1,
        envelope: {
          format: "aes-256-gcm-v1",
          keyId: "master",
          ciphertext: "cipher",
          nonce: "nonce",
          authTag: "tag",
        },
      },
      previous: null,
    },
    authorizationActorId: ids.actor,
    endpointAuthorizationActorId: ids.actor,
    permissionVersion: 1,
    payloadBytes: null,
    leaseGeneration: 2,
    workerId: "worker",
  };
  const repo = {
    dueOrganizations: jest.fn().mockResolvedValue([ids.org]),
    claim: jest.fn().mockResolvedValue(claim),
    sourceScope: jest.fn().mockResolvedValue({
      productIds: [ids.product],
      resource: delivery.resource,
    }),
    validateProducts: jest.fn(),
    permit: jest.fn(),
    complete: jest.fn(),
    fail: jest.fn(),
  };
  const authorization = {
    authorize: jest.fn().mockResolvedValue({
      actorId: ids.actor,
      organizationId: ids.org,
      permissionVersion: 1,
      role: "owner",
    }),
  };
  const vault = {
    decrypt: jest.fn().mockReturnValue(Buffer.alloc(32, 1).toString("base64")),
  };
  const transport = {
    post: jest
      .fn<
        ReturnType<WebhookTransportPort["post"]>,
        Parameters<WebhookTransportPort["post"]>
      >()
      .mockImplementation(
        async (input: Parameters<WebhookTransportPort["post"]>[0]) => {
          await input.beforeSend?.();
          return {
            outcome: "succeeded",
            status: 204,
            durationMs: 5,
            responseBytes: 0,
          };
        },
      ),
  };
  const worker = new WebhookDeliveryWorker(
    repo as unknown as WebhookRepositoryPort,
    vault as unknown as WebhookVaultPort,
    transport,
    authorization,
    "worker",
  );
  return { worker, repo, authorization, vault, transport, claim };
}
describe("WebhookDeliveryWorker security fences", () => {
  it("revalidates both replay operator and subscription principal", async () => {
    const f = fixture();
    f.claim = { ...f.claim, endpointAuthorizationActorId: ids.source };
    f.repo.claim.mockResolvedValue(f.claim);
    await f.worker.tick();
    expect(f.authorization.authorize).toHaveBeenCalledWith(
      ids.org,
      ids.source,
      ["can_edit_connectors", "can_view_products"],
    );
    expect(f.repo.complete).toHaveBeenCalled();
    f.authorization.authorize
      .mockResolvedValueOnce({
        actorId: ids.actor,
        organizationId: ids.org,
        permissionVersion: 1,
        role: "owner",
      })
      .mockResolvedValueOnce({
        actorId: ids.source,
        organizationId: ids.org,
        permissionVersion: 2,
        role: "owner",
      });
    await f.worker.tick();
    expect(f.repo.fail).toHaveBeenCalledWith(
      ids.org,
      ids.delivery,
      "worker",
      2,
      expect.objectContaining({ category: "authorization" }),
    );
  });

  it("sends minimal exact bytes with recorded actor and immediate SQL permit", async () => {
    const f = fixture();
    expect(await f.worker.tick()).toBe(1);
    expect(f.authorization.authorize).toHaveBeenCalledWith(ids.org, ids.actor, [
      "can_edit_connectors",
      "can_view_products",
    ]);
    expect(f.repo.permit).toHaveBeenCalledWith(
      ids.org,
      f.claim,
      expect.anything(),
      expect.anything(),
      expect.stringContaining('"schemaVersion":1'),
    );
    expect(f.repo.complete).toHaveBeenCalledWith(
      ids.org,
      ids.delivery,
      "worker",
      2,
      expect.objectContaining({ status: 204 }),
    );
    expect(f.transport.post.mock.calls[0]![0].headers).toHaveProperty(
      "Cra-Webhook-Signatures",
    );
  });
  it.each(["scope", "access", "vault", "retained"])(
    "never transmits invalid %s",
    async (kind) => {
      const f = fixture();
      if (kind === "scope")
        f.repo.sourceScope.mockResolvedValue({
          productIds: [],
          resource: f.claim.delivery.resource,
        });
      if (kind === "access")
        f.authorization.authorize.mockRejectedValue(new Error("revoked"));
      if (kind === "vault")
        f.vault.decrypt.mockImplementation(() => {
          throw new Error("secret-canary");
        });
      if (kind === "retained")
        f.claim = { ...f.claim, payloadBytes: '{"secret":"canary"}' };
      if (kind === "retained") f.repo.claim.mockResolvedValue(f.claim);
      await f.worker.tick();
      expect(f.transport.post).not.toHaveBeenCalled();
      expect(f.repo.fail).toHaveBeenCalledWith(
        ids.org,
        ids.delivery,
        "worker",
        2,
        expect.objectContaining({
          category: kind === "vault" ? "vault_unavailable" : "authorization",
        }),
      );
      expect(JSON.stringify(f.repo.fail.mock.calls)).not.toContain("canary");
    },
  );
  it("rechecks source and permission revocation immediately before send", async () => {
    const f = fixture();
    f.transport.post.mockImplementation(
      async (input: Parameters<WebhookTransportPort["post"]>[0]) => {
        f.authorization.authorize.mockRejectedValue(new Error("revoked"));
        await expect(input.beforeSend?.()).rejects.toThrow();
        return {
          outcome: "failed",
          category: "authorization",
          code: "authorization",
          status: null,
          durationMs: 0,
          responseBytes: 0,
          retryAfterSeconds: null,
        };
      },
    );
    await f.worker.tick();
    expect(f.repo.complete).not.toHaveBeenCalled();
    expect(f.repo.fail).toHaveBeenCalled();
  });
  it("reuses transmitted bytes and includes unexpired old signing key only", async () => {
    const f = fixture();
    f.claim = {
      ...f.claim,
      payloadBytes: JSON.stringify({
        schemaVersion: 1,
        eventId: f.claim.delivery.eventId,
        deliveryId: ids.delivery,
        occurredAt: f.claim.delivery.occurredAt,
        eventType: f.claim.delivery.eventType,
        organizationId: ids.org,
        resource: f.claim.delivery.resource,
      }),
      endpoint: {
        ...f.claim.endpoint,
        previous: {
          ...f.claim.endpoint.active,
          keyId: ids.source,
          expiresAt: "2099-01-01T00:00:00Z",
        },
      },
    };
    f.repo.claim.mockResolvedValue(f.claim);
    await f.worker.tick();
    expect(f.transport.post.mock.calls[0]![0].body.toString()).toBe(
      f.claim.payloadBytes,
    );
    expect(f.vault.decrypt).toHaveBeenCalledTimes(2);
    f.vault.decrypt.mockClear();
    f.claim = {
      ...f.claim,
      endpoint: {
        ...f.claim.endpoint,
        previous: {
          ...f.claim.endpoint.active,
          expiresAt: "2000-01-01T00:00:00Z",
        },
      },
    };
    f.repo.claim.mockResolvedValue(f.claim);
    await f.worker.tick();
    expect(f.vault.decrypt).toHaveBeenCalledTimes(1);
  });
  it("does not let one tenant's outage starve the next tenant", async () => {
    const f = fixture();
    f.repo.dueOrganizations.mockResolvedValue(["failed-org", ids.org]);
    f.repo.claim.mockRejectedValueOnce(new Error("database outage"));
    expect(await f.worker.tick(100)).toBe(1);
    expect(f.repo.dueOrganizations).toHaveBeenCalledWith(50);
  });
  it("handles empty claims", async () => {
    const f = fixture();
    f.repo.claim.mockResolvedValue(null);
    expect(await f.worker.tick(0)).toBe(0);
    expect(f.repo.dueOrganizations).toHaveBeenCalledWith(1);
  });
});
