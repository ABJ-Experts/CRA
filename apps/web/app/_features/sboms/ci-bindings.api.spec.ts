import { afterEach, describe, expect, it, vi } from "vitest";

import { ciBindingsApi } from "./ci-bindings.api";

const bindingId = "11111111-1111-4111-8111-111111111111";
const connectorId = "22222222-2222-4222-8222-222222222222";
const productId = "33333333-3333-4333-8333-333333333333";
const releaseId = "44444444-4444-4444-8444-444444444444";
const credentialId = "55555555-5555-4555-8555-555555555555";

const binding = {
  id: bindingId,
  connectorId,
  connectionRevision: 1,
  credentialRevision: 1,
  organizationId: "66666666-6666-4666-8666-666666666666",
  productId,
  releaseId,
  credentialId,
  provider: "github_actions",
  providerHost: "github.com",
  repositoryOwner: "acme",
  repositoryName: "device",
  repositoryId: "42",
  allowedRef: "refs/heads/main",
  providerInstallationId: "77",
  projectKey: null,
  pipelineDefinitionId: null,
  status: "active",
  version: 1,
  createdAt: "2026-09-30T10:00:00Z",
  updatedAt: "2026-09-30T10:00:00Z",
} as const;

afterEach(() => vi.unstubAllGlobals());

describe("CI bindings browser gateway", () => {
  it("parses owner list and sends valid binding creation to the owner route", async () => {
    const fetcher = vi.fn(
      async (_path: string, init?: RequestInit) =>
        new Response(
          JSON.stringify(
            init?.method === "POST" ? { binding } : { bindings: [binding] },
          ),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(ciBindingsApi.list()).resolves.toEqual({
      bindings: [binding],
    });
    await expect(
      ciBindingsApi.create({
        connectorId,
        productId,
        releaseId,
        credentialId,
        provider: "github_actions",
        providerHost: "github.com",
        repositoryOwner: "acme",
        repositoryName: "device",
        repositoryId: "42",
        allowedRef: "refs/heads/main",
        providerInstallationId: "77",
        idempotencyKey: crypto.randomUUID(),
      }),
    ).resolves.toEqual({ binding });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/sbom-ci-bindings",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects malformed binding input before network and invalid server response", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ bindings: [{ secret: "no" }] }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      ciBindingsApi.create({ connectorId: "forged" } as never),
    ).rejects.toMatchObject({ kind: "invalid_request" });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(ciBindingsApi.list()).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });
});
