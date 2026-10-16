import { randomBytes } from "node:crypto";
import { WebhookUseCases } from "./webhook-use-cases";
import type { WebhookRepositoryPort } from "./webhook-repository.port";
import type { WebhookVaultPort } from "./webhook-vault.port";
import {
  fixtureWebhookDelivery,
  fixtureWebhookEndpoint,
  webhookFixtureIds as ids,
} from "./webhook-test-fixtures";
const secret = randomBytes(32).toString("base64");
function fixture() {
  const endpoint = fixtureWebhookEndpoint();
  const delivery = fixtureWebhookDelivery();
  const context = {
    delivery,
    productIds: [ids.product],
    sourceKind: "product_event",
    sourceId: ids.source,
    destinationRevision: 1,
    scopeRevision: 1,
    destinationUrl: endpoint.url,
  };
  const repo = {
    listEndpoints: jest.fn().mockResolvedValue({
      rows: [endpoint],
      total: 1,
      page: 1,
      pageSize: 15,
      pageCount: 1,
    }),
    endpoint: jest.fn().mockResolvedValue(endpoint),
    signingSecrets: jest.fn().mockResolvedValue([
      {
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
    ]),
    validateProducts: jest.fn<
      ReturnType<WebhookRepositoryPort["validateProducts"]>,
      Parameters<WebhookRepositoryPort["validateProducts"]>
    >(),
    existingCommandKeyId: jest.fn().mockResolvedValue(null),
    executeEndpointCommand: jest
      .fn<
        ReturnType<WebhookRepositoryPort["executeEndpointCommand"]>,
        Parameters<WebhookRepositoryPort["executeEndpointCommand"]>
      >()
      .mockResolvedValue(endpoint),
    deliveryContext: jest.fn().mockResolvedValue(context),
    deliveryScopes: jest.fn().mockResolvedValue([
      {
        deliveryId: ids.delivery,
        scope: { productIds: [ids.product], resource: delivery.resource },
      },
    ]),
    sourceScope: jest.fn().mockResolvedValue({
      productIds: [ids.product],
      resource: delivery.resource,
    }),
    listDeliveries: jest.fn().mockResolvedValue({
      rows: [delivery],
      total: 1,
      page: 1,
      pageSize: 15,
      pageCount: 1,
    }),
    delivery: jest.fn().mockResolvedValue({
      delivery,
      attempts: { rows: [], total: 0, page: 1, pageSize: 15, pageCount: 1 },
    }),
    previewReplay: jest
      .fn()
      .mockResolvedValue({ previewDigest: "a".repeat(64) }),
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
    decrypt: jest.fn().mockReturnValue(secret),
    fingerprint: jest
      .fn<
        ReturnType<WebhookVaultPort["fingerprint"]>,
        Parameters<WebhookVaultPort["fingerprint"]>
      >()
      .mockReturnValue({ keyId: "master", digest: "a".repeat(64) }),
    encrypt: jest.fn().mockReturnValue({
      format: "aes-256-gcm-v1",
      keyId: "master",
      ciphertext: "cipher",
      nonce: "nonce",
      authTag: "tag",
    }),
  };
  const egress = { validate: jest.fn() };
  const usecases = new WebhookUseCases(
    repo as unknown as WebhookRepositoryPort,
    authorization,
    vault as unknown as WebhookVaultPort,
    egress,
  );
  const input = {
    displayName: endpoint.displayName,
    url: endpoint.url,
    productIds: endpoint.productIds,
    eventTypes: endpoint.eventTypes,
    retryPolicy: endpoint.retryPolicy,
    idempotencyKey: ids.idempotency,
  };
  return {
    usecases,
    repo,
    authorization,
    vault,
    egress,
    endpoint,
    delivery,
    input,
  };
}
describe("Webhook endpoint commands", () => {
  it("requires current source permission before owner credential rotation", async () => {
    const f = fixture();
    f.endpoint.eventTypes = ["vulnerability.assessment.approved"];
    f.authorization.authorize.mockImplementation(
      (_org: unknown, _actor: unknown, permissions: readonly string[]) =>
        permissions.includes("can_view_findings")
          ? Promise.reject(new Error("source permission revoked"))
          : Promise.resolve({
              actorId: ids.actor,
              organizationId: ids.org,
              permissionVersion: 1,
              role: "owner",
            }),
    );
    await expect(
      f.usecases.rotateSecret(ids.org, ids.endpoint, ids.actor, {
        expectedVersion: 1,
        idempotencyKey: ids.idempotency,
        secretValue: secret,
        overlapSeconds: 3600,
      }),
    ).rejects.toThrow("source permission revoked");
    expect(f.vault.encrypt).not.toHaveBeenCalled();
    expect(f.repo.executeEndpointCommand).not.toHaveBeenCalled();
  });
  it("renders only the current authorized source reference in history and details", async () => {
    const f = fixture();
    const historical = {
      ...f.delivery,
      resource: {
        type: "product" as const,
        id: ids.source,
        url: `/products/${ids.source}`,
      },
    };
    f.repo.listDeliveries.mockResolvedValue({
      rows: [historical],
      total: 1,
      page: 1,
      pageSize: 15,
      pageCount: 1,
    });
    f.repo.delivery.mockResolvedValue({
      delivery: historical,
      attempts: { rows: [], total: 0, page: 1, pageSize: 15, pageCount: 1 },
    });
    expect(
      (
        await f.usecases.deliveries(ids.org, ids.endpoint, ids.actor, {
          page: 1,
          pageSize: 15,
        })
      ).rows[0]?.resource,
    ).toEqual(f.delivery.resource);
    expect(
      (
        await f.usecases.delivery(
          ids.org,
          ids.endpoint,
          ids.delivery,
          ids.actor,
          { page: 1, pageSize: 15 },
        )
      ).delivery.resource,
    ).toEqual(f.delivery.resource);
  });

  it("rejects previous signing keys copied into configuration/control/replay reasons", async () => {
    const f = fixture();
    await expect(
      f.usecases.update(ids.org, ids.endpoint, ids.actor, {
        ...f.input,
        displayName: secret,
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      f.usecases.control(ids.org, ids.endpoint, ids.actor, "disable", {
        expectedVersion: 1,
        idempotencyKey: ids.idempotency,
        reason: secret,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      f.usecases.replay(ids.org, ids.endpoint, ids.delivery, ids.actor, {
        expectedEndpointVersion: 1,
        expectedDeliveryVersion: 2,
        idempotencyKey: ids.idempotency,
        reason: secret,
        previewDigest: "a".repeat(64),
        confirmDestinationChange: false,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(f.repo.executeEndpointCommand).not.toHaveBeenCalled();
  });

  it("keeps a maximum-page aggregate history read bounded without a large product URL", async () => {
    const f = fixture();
    const deliveries = Array.from({ length: 100 }, (_, index) => ({
      ...f.delivery,
      id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    }));
    f.repo.listDeliveries.mockResolvedValue({
      rows: deliveries,
      total: 100,
      page: 1,
      pageSize: 100,
      pageCount: 1,
    });
    const scopes = deliveries.map((delivery, index) => ({
      deliveryId: delivery.id,
      scope: {
        resource: delivery.resource,
        productIds: Array.from(
          { length: 100 },
          (_, product) =>
            `30000000-0000-4000-8000-${String(index * 100 + product + 1).padStart(12, "0")}`,
        ),
      },
    }));
    f.repo.deliveryScopes.mockResolvedValue(scopes);
    expect(
      (
        await f.usecases.deliveries(ids.org, ids.endpoint, ids.actor, {
          page: 1,
          pageSize: 100,
        })
      ).rows,
    ).toHaveLength(100);
    expect(f.repo.deliveryScopes).toHaveBeenCalledTimes(1);
    expect(f.repo.validateProducts).toHaveBeenCalledTimes(1);
    expect(f.repo.validateProducts.mock.calls[0]?.[1]).toEqual([ids.product]);
  });

  it("shows safe operational suppression when historical source scope is unknown", async () => {
    const f = fixture();
    f.repo.deliveryScopes.mockResolvedValue([
      { deliveryId: ids.delivery, scope: null },
    ]);
    const page = await f.usecases.deliveries(ids.org, ids.endpoint, ids.actor, {
      page: 1,
      pageSize: 15,
    });
    expect(page.rows[0]?.resource).toEqual({
      type: "connector",
      id: ids.endpoint,
      url: "/connectors/webhooks",
    });
    expect(page.rows[0]?.lastFailureCategory).toBe("scope_unknown");
    const detail = await f.usecases.delivery(
      ids.org,
      ids.endpoint,
      ids.delivery,
      ids.actor,
      { page: 1, pageSize: 15 },
    );
    expect(detail.delivery.resource.id).toBe(ids.endpoint);
    expect(detail.delivery.resource.id).not.toBe(ids.product);
  });
  it.each(["missing", "malformed"])(
    "blocks enable with %s signing material",
    async (kind) => {
      const f = fixture();
      if (kind === "missing") f.repo.signingSecrets.mockResolvedValue([]);
      else f.vault.decrypt.mockReturnValue("not-a-key");
      await expect(
        f.usecases.control(ids.org, ids.endpoint, ids.actor, "enable", {
          expectedVersion: 1,
          idempotencyKey: ids.idempotency,
        }),
      ).rejects.toMatchObject({ code: "unavailable" });
    },
  );

  it("blocks enable/test if recovery keys are unavailable or incorrect", async () => {
    const f = fixture();
    f.vault.decrypt.mockImplementation(() => {
      throw new Error("secret-canary");
    });
    await expect(
      f.usecases.control(ids.org, ids.endpoint, ids.actor, "enable", {
        expectedVersion: 1,
        idempotencyKey: ids.idempotency,
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(f.repo.executeEndpointCommand).not.toHaveBeenCalled();
  });

  it.each(["displayName", "url"])(
    "rejects secret canaries copied into persisted %s",
    async (field) => {
      const f = fixture();
      const input = {
        ...f.input,
        secretValue: secret,
        [field]:
          field === "url"
            ? `https://receiver.example/${encodeURIComponent(secret)}`
            : secret,
      };
      await expect(
        f.usecases.create(ids.org, ids.actor, input),
      ).rejects.toMatchObject({ code: "invalid_request" });
      expect(f.repo.executeEndpointCommand).not.toHaveBeenCalled();
    },
  );

  it("requires create/source permissions and owner for write-only keys", async () => {
    const f = fixture();
    await f.usecases.create(ids.org, ids.actor, {
      ...f.input,
      secretValue: secret,
    });
    expect(f.authorization.authorize).toHaveBeenCalledWith(
      ids.org,
      ids.actor,
      ["can_create_connectors", "can_edit_connectors", "can_view_products"],
      true,
    );
    const request = f.repo.executeEndpointCommand.mock.calls[0]![1];
    const slot = request.payload.secret as {
      keyId: string;
      secretId: string;
      revision: number;
    };
    expect(JSON.stringify(request.payload)).not.toContain(secret);
    expect(slot.secretId).toBe(slot.keyId);
    expect(f.vault.encrypt).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointId: request.endpointId,
        signingKeyId: slot.keyId,
      }),
      secret,
    );
  });
  it("creates disabled unkeyed configurations without owner privilege", async () => {
    const f = fixture();
    await f.usecases.create(ids.org, ids.actor, f.input);
    expect(f.authorization.authorize).toHaveBeenCalledWith(
      ids.org,
      ids.actor,
      ["can_create_connectors", "can_view_products"],
      false,
    );
    expect(f.vault.encrypt).not.toHaveBeenCalled();
  });
  it("fingerprints identical create retries under a stable purpose namespace", async () => {
    const f = fixture();
    await f.usecases.create(ids.org, ids.actor, {
      ...f.input,
      secretValue: secret,
    });
    f.repo.existingCommandKeyId.mockResolvedValue("retained-key");
    await f.usecases.create(ids.org, ids.actor, {
      ...f.input,
      secretValue: secret,
    });
    expect(f.vault.fingerprint.mock.calls[0]![1]).toBe(
      "00000000-0000-0000-0000-000000000000",
    );
    expect(f.vault.fingerprint.mock.calls[1]![2]).toBe(
      f.vault.fingerprint.mock.calls[0]![2],
    );
    expect(f.vault.fingerprint.mock.calls[1]![3]).toBe("retained-key");
    expect(f.vault.fingerprint.mock.calls[0]![2]).toContain(
      "webhook-command-v1",
    );
  });
  it("rejects denied access and unsafe destinations before committing", async () => {
    const f = fixture();
    f.authorization.authorize.mockRejectedValue(new Error("denied"));
    await expect(
      f.usecases.create(ids.org, ids.actor, f.input),
    ).rejects.toThrow();
    expect(f.repo.executeEndpointCommand).not.toHaveBeenCalled();
    f.authorization.authorize.mockResolvedValue({
      actorId: ids.actor,
      organizationId: ids.org,
      permissionVersion: 1,
      role: "owner",
    });
    f.egress.validate.mockRejectedValue(new Error("private target"));
    await expect(
      f.usecases.create(ids.org, ids.actor, f.input),
    ).rejects.toThrow();
    expect(f.repo.executeEndpointCommand).not.toHaveBeenCalled();
  });
  it("updates current actor scope and fences expected version", async () => {
    const f = fixture();
    await f.usecases.update(ids.org, ids.endpoint, ids.actor, {
      ...f.input,
      expectedVersion: 4,
    });
    expect(f.repo.executeEndpointCommand).toHaveBeenCalledWith(
      ids.org,
      expect.objectContaining({
        operation: "update",
        expectedVersion: 4,
        authorization: expect.objectContaining({
          actorId: ids.actor,
        }) as unknown,
        payload: expect.objectContaining({
          productIds: [ids.product],
        }) as unknown,
      }),
    );
  });
  it("rotates with fresh public signing identity and bounded overlap", async () => {
    const f = fixture();
    await f.usecases.rotateSecret(ids.org, ids.endpoint, ids.actor, {
      expectedVersion: 1,
      idempotencyKey: ids.idempotency,
      secretValue: secret,
      overlapSeconds: 3600,
    });
    const request = f.repo.executeEndpointCommand.mock.calls[0]![1];
    const slot = request.payload.secret as {
      keyId: string;
      secretId: string;
      revision: number;
    };
    expect(slot.keyId).not.toBe(ids.key);
    expect(slot.revision).toBe(2);
    expect(request.payload.overlapSeconds).toBe(3600);
  });
  it.each(["fingerprint", "encrypt"])(
    "maps unavailable %s to safe outcomes",
    async (kind) => {
      const f = fixture();
      f.vault[kind as "fingerprint" | "encrypt"].mockImplementation(() => {
        throw new Error(secret);
      });
      await expect(
        f.usecases.create(ids.org, ids.actor, {
          ...f.input,
          secretValue: secret,
        }),
      ).rejects.toMatchObject({ code: "unavailable" });
    },
  );
  it.each(["enable", "test", "disable", "revoke_secret"] as const)(
    "checks %s control permissions",
    async (operation) => {
      const f = fixture();
      await f.usecases.control(ids.org, ids.endpoint, ids.actor, operation, {
        expectedVersion: 1,
        idempotencyKey: ids.idempotency,
        reason: "Operational control",
      });
      expect(f.repo.executeEndpointCommand).toHaveBeenCalledWith(
        ids.org,
        expect.objectContaining({ operation, reason: "Operational control" }),
      );
      expect(f.egress.validate).toHaveBeenCalledTimes(
        operation === "test" || operation === "enable" ? 1 : 0,
      );
    },
  );
  it.each(["enable", "test"] as const)(
    "cannot %s without credentials",
    async (operation) => {
      const f = fixture();
      f.repo.endpoint.mockResolvedValue({ ...f.endpoint, hasSecret: false });
      await expect(
        f.usecases.control(ids.org, ids.endpoint, ids.actor, operation, {
          expectedVersion: 1,
          idempotencyKey: ids.idempotency,
        }),
      ).rejects.toMatchObject({ code: "invalid_state" });
    },
  );
  it("authorizes endpoint and all source records before exposing history", async () => {
    const f = fixture();
    await f.usecases.list(ids.org, ids.actor, { page: 1, pageSize: 15 });
    await f.usecases.get(ids.org, ids.endpoint, ids.actor);
    await f.usecases.deliveries(ids.org, ids.endpoint, ids.actor, {
      page: 1,
      pageSize: 15,
    });
    await f.usecases.delivery(ids.org, ids.endpoint, ids.delivery, ids.actor, {
      page: 1,
      pageSize: 15,
    });
    expect(f.repo.deliveryScopes).toHaveBeenCalledTimes(2);
    f.repo.sourceScope.mockResolvedValue({
      productIds: [ids.source],
      resource: f.delivery.resource,
    });
    await expect(
      f.usecases.replayPreview(ids.org, ids.endpoint, ids.delivery, ids.actor, {
        expectedEndpointVersion: 1,
        expectedDeliveryVersion: 2,
      }),
    ).rejects.toMatchObject({ code: "forbidden_by_policy" });
  });
  it("requires authoritative SQL preview and rechecks current replay scope", async () => {
    const f = fixture();
    const input = { expectedEndpointVersion: 1, expectedDeliveryVersion: 2 };
    await f.usecases.replayPreview(
      ids.org,
      ids.endpoint,
      ids.delivery,
      ids.actor,
      input,
    );
    expect(f.repo.previewReplay).toHaveBeenCalledWith(
      ids.org,
      ids.endpoint,
      ids.delivery,
      expect.anything(),
      1,
      2,
    );
    await f.usecases.replay(ids.org, ids.endpoint, ids.delivery, ids.actor, {
      ...input,
      previewDigest: "a".repeat(64),
      idempotencyKey: ids.idempotency,
      reason: "Recovered receiver",
      confirmDestinationChange: true,
    });
    expect(f.repo.executeEndpointCommand).toHaveBeenCalledWith(
      ids.org,
      expect.objectContaining({
        operation: "replay",
        payload: expect.objectContaining({
          deliveryId: ids.delivery,
          confirmDestinationChange: true,
        }) as unknown,
      }),
    );
    expect(f.repo.previewReplay).toHaveBeenCalledTimes(1);
  });
});
