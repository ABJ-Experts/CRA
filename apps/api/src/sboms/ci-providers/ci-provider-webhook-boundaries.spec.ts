import type { Request } from "express";

import type { SupabaseService } from "../../supabase/supabase.service";
import { CiProviderWebhookController } from "./ci-provider-webhook.controller";
import type {
  CiProviderWebhookUseCases,
  CiWebhookOutcome,
} from "./ci-provider-webhook";
import { EnvironmentCiWebhookSecretReader } from "./environment-ci-webhook-secret-reader";
import { SupabaseCiWebhookEventLedger } from "./supabase-ci-webhook-event-ledger";

const orgId = "123e4567-e89b-12d3-a456-426614174000";
const bindingId = "123e4567-e89b-12d3-a456-426614174001";
const connectorId = "123e4567-e89b-12d3-a456-426614174002";

describe("CI webhook secret configuration", () => {
  it("loads only a sufficiently long GitHub App webhook secret", () => {
    expect(
      new EnvironmentCiWebhookSecretReader({}).load(
        "github_actions",
        connectorId,
      ),
    ).toBeNull();
    expect(
      new EnvironmentCiWebhookSecretReader({
        CI_GITHUB_WEBHOOK_SECRET: "short",
      }).load("github_actions", connectorId),
    ).toBeNull();
    const secret = "s".repeat(32);
    expect(
      new EnvironmentCiWebhookSecretReader({
        CI_GITHUB_WEBHOOK_SECRET: secret,
      }).load("github_actions", connectorId),
    ).toEqual({ mode: "github", secret });
  });

  it("loads a GitLab signing key scoped to its connector, preferring it over legacy", () => {
    const secret = `whsec_${Buffer.alloc(32, 7).toString("base64")}`;
    const environment = {
      CI_GITLAB_WEBHOOK_SIGNING_TOKENS: JSON.stringify({
        [connectorId]: secret,
      }),
      CI_GITLAB_WEBHOOK_LEGACY_TOKENS: JSON.stringify({
        [connectorId]: "x".repeat(32),
      }),
    };
    const reader = new EnvironmentCiWebhookSecretReader(environment);
    expect(reader.load("gitlab_ci", connectorId)).toEqual({
      mode: "signed",
      secret,
    });
    expect(reader.load("gitlab_ci", orgId)).toBeNull();
  });

  it("supports legacy GitLab tokens only when configured and rejects malformed maps", () => {
    const secret = "x".repeat(32);
    expect(
      new EnvironmentCiWebhookSecretReader({
        CI_GITLAB_WEBHOOK_SIGNING_TOKENS: "not-json",
        CI_GITLAB_WEBHOOK_LEGACY_TOKENS: JSON.stringify({
          [connectorId]: secret,
        }),
      }).load("gitlab_ci", connectorId),
    ).toEqual({ mode: "legacy", secret });
    expect(
      new EnvironmentCiWebhookSecretReader({
        CI_GITLAB_WEBHOOK_SIGNING_TOKENS: JSON.stringify({
          [connectorId]: "whsec_bad",
        }),
      }).load("gitlab_ci", connectorId),
    ).toBeNull();
    expect(
      new EnvironmentCiWebhookSecretReader({
        CI_GITLAB_WEBHOOK_LEGACY_TOKENS: "[]",
      }).load("gitlab_ci", connectorId),
    ).toBeNull();
  });
});

describe("CI webhook event ledger", () => {
  const input = {
    bindingId,
    provider: "github_actions" as const,
    deliveryId: "delivery-1",
    bodySha256: "a".repeat(64),
    runId: "81",
    runAttempt: "2",
  };

  it("passes the organization first to the atomic RPC and parses its result", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ outcome: "recorded", event_id: bindingId }],
      error: null,
    });
    const ledger = new SupabaseCiWebhookEventLedger({
      admin: () => ({ rpc }),
    } as unknown as SupabaseService);
    await expect(ledger.record(orgId, input)).resolves.toEqual({
      outcome: "recorded",
      eventId: bindingId,
    });
    expect(rpc).toHaveBeenCalledWith(
      "record_ci_provider_webhook_event_atomic",
      {
        p_organization_id: orgId,
        p_binding_id: bindingId,
        p_provider: "github_actions",
        p_delivery_id: "delivery-1",
        p_body_sha256: "a".repeat(64),
        p_run_id: "81",
        p_run_attempt: "2",
      },
    );
  });

  it("rejects RPC failures and malformed responses without exposing provider data", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "secret" } })
      .mockResolvedValueOnce({
        data: [{ outcome: "approved", event_id: null }],
        error: null,
      });
    const ledger = new SupabaseCiWebhookEventLedger({
      admin: () => ({ rpc }),
    } as unknown as SupabaseService);
    await expect(ledger.record(orgId, input)).rejects.toThrow(
      "could not be recorded",
    );
    await expect(ledger.record(orgId, input)).rejects.toThrow();
  });

  it("returns a conflict without inventing an event ID", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ outcome: "conflict", event_id: null }],
      error: null,
    });
    const ledger = new SupabaseCiWebhookEventLedger({
      admin: () => ({ rpc }),
    } as unknown as SupabaseService);
    await expect(ledger.record(orgId, input)).resolves.toEqual({
      outcome: "conflict",
    });
  });
});

describe("CI webhook HTTP boundary", () => {
  const params = {
    provider: "github_actions" as const,
    organizationId: orgId,
    bindingId,
  };
  const request = { rawBody: Buffer.from("{}"), headers: {} } as Request & {
    rawBody: Buffer;
  };

  it("returns an empty success for new and replayed deliveries", async () => {
    for (const outcome of ["recorded", "replayed"] as const) {
      const receive = jest.fn().mockResolvedValue({ outcome });
      const controller = new CiProviderWebhookController({
        receive,
      } as unknown as CiProviderWebhookUseCases);
      await expect(
        controller.receive(params, request),
      ).resolves.toBeUndefined();
      expect(receive).toHaveBeenCalledWith({
        ...params,
        rawBody: request.rawBody,
        headers: request.headers,
      });
    }
  });

  it("rejects a request without raw bytes before any event can be recorded", async () => {
    const receive = jest.fn().mockResolvedValue({ outcome: "invalid_request" });
    const controller = new CiProviderWebhookController({
      receive,
    } as unknown as CiProviderWebhookUseCases);
    await expect(
      controller.receive(params, { headers: {} } as Request),
    ).rejects.toMatchObject({ status: 400 });
    expect(receive).toHaveBeenCalledWith(
      expect.objectContaining({ rawBody: Buffer.alloc(0) }),
    );
  });

  it.each([
    ["unauthorized", 401],
    ["not_found", 404],
    ["invalid_request", 400],
    ["untrusted", 400],
    ["conflict", 409],
    ["unavailable", 503],
  ] as const)(
    "maps %s to HTTP %s",
    async (outcome: CiWebhookOutcome, status: number) => {
      const controller = new CiProviderWebhookController({
        receive: jest.fn().mockResolvedValue({ outcome }),
      } as unknown as CiProviderWebhookUseCases);
      await expect(controller.receive(params, request)).rejects.toMatchObject({
        status,
      });
    },
  );
});
