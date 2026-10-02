import type { FindingPropagationRepository } from "./finding-propagation-use-cases";
import {
  FindingPropagationProviderError,
  FindingPropagationUseCases,
} from "./finding-propagation-use-cases";

const ids = Object.freeze({
  organization: "11111111-1111-4111-8111-111111111111",
  actor: "22222222-2222-4222-8222-222222222222",
  product: "33333333-3333-4333-8333-333333333333",
  release: "44444444-4444-4444-8444-444444444444",
  source: "55555555-5555-4555-8555-555555555555",
  override: "66666666-6666-4666-8666-666666666666",
  job: "77777777-7777-4777-8777-777777777777",
  key: "88888888-8888-4888-8888-888888888888",
  correlation: "99999999-9999-4999-8999-999999999999",
});
const at = "2026-08-14T11:00:00.000Z";

describe("FindingPropagationUseCases", () => {
  it("parses and delegates an opaque source registration", async () => {
    const registerSource = jest.fn().mockResolvedValue({
      outcome: "created",
      response: mutationResponse(),
    });
    const repository = repositoryFor({
      registerSource,
    });

    await expect(
      new FindingPropagationUseCases(repository).registerSource({
        organizationId: ids.organization,
        actorId: ids.actor,
        input: registerInput(),
      }),
    ).resolves.toEqual({ ok: true, value: mutationResponse() });
    expect(registerSource).toHaveBeenCalledWith(
      ids.organization,
      ids.actor,
      registerInput(),
    );
  });

  it("fails invalid registration before the repository boundary", async () => {
    const registerSource = jest.fn();
    const repository = repositoryFor({ registerSource });

    await expect(
      new FindingPropagationUseCases(repository).registerSource({
        organizationId: "not-a-uuid",
        actorId: ids.actor,
        input: registerInput(),
      }),
    ).resolves.toEqual({ ok: false, error: { code: "invalid_request" } });
    expect(registerSource).not.toHaveBeenCalled();
  });

  it("uses expected versions for source updates and preserves idempotent responses", async () => {
    const repository = repositoryFor({
      updateSource: jest.fn().mockResolvedValue({
        outcome: "replayed",
        response: { ...mutationResponse(), idempotent: true },
      }),
    });

    await expect(
      new FindingPropagationUseCases(repository).updateSource({
        organizationId: ids.organization,
        actorId: ids.actor,
        sourceId: ids.source,
        input: updateInput(),
      }),
    ).resolves.toEqual({
      ok: true,
      value: { ...mutationResponse(), idempotent: true },
    });
  });

  it("maps a provider conflict without presenting it as an unavailable dependency", async () => {
    const repository = repositoryFor({
      updateSource: jest.fn().mockResolvedValue({ outcome: "conflict" }),
    });

    await expect(
      new FindingPropagationUseCases(repository).updateSource({
        organizationId: ids.organization,
        actorId: ids.actor,
        sourceId: ids.source,
        input: updateInput(),
      }),
    ).resolves.toEqual({ ok: false, error: { code: "conflict" } });
  });

  it("returns only a contract-valid aggregate product summary", async () => {
    const getProductImpactSummary = jest.fn().mockResolvedValue({
      outcome: "found",
      response: {
        summary: {
          productId: ids.product,
          releaseId: ids.release,
          activeImpactCount: 2,
          supersededImpactCount: 1,
          closedImpactCount: 0,
          overrideCount: 1,
          latestGraphVersion: 4,
          latestEvaluatedAt: at,
          propagationState: "idle",
          queuedJobCount: 0,
          inProgressJobCount: 0,
          retryingJobCount: 0,
          deadLetterJobCount: 0,
        },
      },
    });
    const repository = repositoryFor({
      getProductImpactSummary,
    });

    const result = await new FindingPropagationUseCases(
      repository,
    ).getProductImpactSummary({
      organizationId: ids.organization,
      actorId: ids.actor,
      productId: ids.product,
      query: { releaseId: ids.release },
    });

    expect(result).toMatchObject({ ok: true });
    expect(getProductImpactSummary).toHaveBeenCalledWith(
      ids.organization,
      ids.actor,
      ids.product,
      ids.release,
    );
  });

  it("treats malformed successful provider data as a bad gateway result", async () => {
    const repository = repositoryFor({
      getProductImpactSummary: jest.fn().mockResolvedValue({
        outcome: "found",
        response: { summary: { productId: ids.product } },
      }),
    });

    await expect(
      new FindingPropagationUseCases(repository).getProductImpactSummary({
        organizationId: ids.organization,
        actorId: ids.actor,
        productId: ids.product,
        query: {},
      }),
    ).resolves.toEqual({ ok: false, error: { code: "malformed_provider" } });
  });

  it("preserves a product-specific override as a finding-owned command", async () => {
    const repository = repositoryFor({
      createProductImpactOverride: jest.fn().mockResolvedValue({
        outcome: "created",
        response: overrideResponse(),
      }),
    });

    await expect(
      new FindingPropagationUseCases(repository).createProductImpactOverride({
        organizationId: ids.organization,
        actorId: ids.actor,
        sourceId: ids.source,
        productId: ids.product,
        input: overrideInput(),
      }),
    ).resolves.toEqual({ ok: true, value: overrideResponse() });
  });

  it("maps an unavailable end-override dependency without leaking provider detail", async () => {
    const repository = repositoryFor({
      endProductImpactOverride: jest
        .fn()
        .mockRejectedValue(new FindingPropagationProviderError("unavailable")),
    });

    await expect(
      new FindingPropagationUseCases(repository).endProductImpactOverride({
        organizationId: ids.organization,
        actorId: ids.actor,
        sourceId: ids.source,
        productId: ids.product,
        overrideId: ids.override,
        input: {
          expectedVersion: 0,
          reason: "The configuration exception is no longer required.",
          idempotencyKey: ids.key,
          correlationId: ids.correlation,
        },
      }),
    ).resolves.toEqual({ ok: false, error: { code: "unavailable" } });
  });

  it("preserves source replay semantics and rejects malformed source responses", async () => {
    const repository = repositoryFor({
      registerSource: jest
        .fn()
        .mockResolvedValueOnce({
          outcome: "replayed",
          response: { ...mutationResponse(), idempotent: true },
        })
        .mockResolvedValueOnce({
          outcome: "created",
          response: { source: mutationResponse().source },
        })
        .mockRejectedValueOnce(
          new FindingPropagationProviderError("malformed"),
        ),
    });
    const useCases = new FindingPropagationUseCases(repository);
    const command = {
      organizationId: ids.organization,
      actorId: ids.actor,
      input: registerInput(),
    };

    await expect(useCases.registerSource(command)).resolves.toEqual({
      ok: true,
      value: { ...mutationResponse(), idempotent: true },
    });
    await expect(useCases.registerSource(command)).resolves.toEqual({
      ok: false,
      error: { code: "malformed_provider" },
    });
    await expect(useCases.registerSource(command)).resolves.toEqual({
      ok: false,
      error: { code: "malformed_provider" },
    });
  });

  it("fails invalid source-update identifiers and preserves terminal provider outcomes", async () => {
    const updateSource = jest
      .fn()
      .mockResolvedValueOnce({ outcome: "not_found" })
      .mockResolvedValueOnce({
        outcome: "updated",
        response: { source: mutationResponse().source },
      });
    const useCases = new FindingPropagationUseCases(
      repositoryFor({ updateSource }),
    );
    const command = {
      organizationId: ids.organization,
      actorId: ids.actor,
      sourceId: ids.source,
      input: updateInput(),
    };

    await expect(
      useCases.updateSource({ ...command, sourceId: "not-a-uuid" }),
    ).resolves.toEqual({ ok: false, error: { code: "invalid_request" } });
    await expect(useCases.updateSource(command)).resolves.toEqual({
      ok: false,
      error: { code: "not_found" },
    });
    await expect(useCases.updateSource(command)).resolves.toEqual({
      ok: false,
      error: { code: "malformed_provider" },
    });
    expect(updateSource).toHaveBeenCalledTimes(2);
  });

  it("validates summary queries and returns only explicit provider results", async () => {
    const getProductImpactSummary = jest
      .fn()
      .mockResolvedValueOnce({ outcome: "not_found" })
      .mockRejectedValueOnce(new FindingPropagationProviderError("malformed"));
    const useCases = new FindingPropagationUseCases(
      repositoryFor({ getProductImpactSummary }),
    );
    const command = {
      organizationId: ids.organization,
      actorId: ids.actor,
      productId: ids.product,
      query: {},
    };

    await expect(
      useCases.getProductImpactSummary({
        ...command,
        query: { releaseId: "bad" },
      }),
    ).resolves.toEqual({ ok: false, error: { code: "invalid_request" } });
    await expect(
      useCases.getProductImpactSummary({ ...command, organizationId: "bad" }),
    ).resolves.toEqual({ ok: false, error: { code: "invalid_request" } });
    await expect(useCases.getProductImpactSummary(command)).resolves.toEqual({
      ok: false,
      error: { code: "not_found" },
    });
    await expect(useCases.getProductImpactSummary(command)).resolves.toEqual({
      ok: false,
      error: { code: "malformed_provider" },
    });
    expect(getProductImpactSummary).toHaveBeenCalledTimes(2);
  });

  it("does not turn override conflicts or malformed override rows into successful commands", async () => {
    const createProductImpactOverride = jest
      .fn()
      .mockResolvedValueOnce({ outcome: "conflict" })
      .mockResolvedValueOnce({
        outcome: "replayed",
        response: { override: overrideResponse().override, idempotent: true },
      })
      .mockResolvedValueOnce({
        outcome: "created",
        response: { override: { id: ids.override }, idempotent: false },
      });
    const useCases = new FindingPropagationUseCases(
      repositoryFor({ createProductImpactOverride }),
    );
    const command = {
      organizationId: ids.organization,
      actorId: ids.actor,
      sourceId: ids.source,
      productId: ids.product,
      input: overrideInput(),
    };

    await expect(
      useCases.createProductImpactOverride({
        ...command,
        sourceId: "not-a-uuid",
      }),
    ).resolves.toEqual({ ok: false, error: { code: "invalid_request" } });
    await expect(
      useCases.createProductImpactOverride(command),
    ).resolves.toEqual({
      ok: false,
      error: { code: "conflict" },
    });
    await expect(
      useCases.createProductImpactOverride(command),
    ).resolves.toEqual({
      ok: true,
      value: { ...overrideResponse(), idempotent: true },
    });
    await expect(
      useCases.createProductImpactOverride(command),
    ).resolves.toEqual({
      ok: false,
      error: { code: "malformed_provider" },
    });
  });

  it("ends only valid overrides and maps conflict or malformed end responses", async () => {
    const endProductImpactOverride = jest
      .fn()
      .mockResolvedValueOnce({
        outcome: "ended",
        response: {
          ...overrideResponse(),
          override: {
            ...overrideResponse().override,
            endedAt: at,
            endedBy: ids.actor,
            endReason: "The configuration exception is no longer required.",
            version: 1,
          },
        },
      })
      .mockResolvedValueOnce({ outcome: "conflict" })
      .mockResolvedValueOnce({
        outcome: "replayed",
        response: { override: { id: ids.override }, idempotent: true },
      });
    const useCases = new FindingPropagationUseCases(
      repositoryFor({ endProductImpactOverride }),
    );
    const command = {
      organizationId: ids.organization,
      actorId: ids.actor,
      sourceId: ids.source,
      productId: ids.product,
      overrideId: ids.override,
      input: {
        expectedVersion: 0,
        reason: "The configuration exception is no longer required.",
        idempotencyKey: ids.key,
        correlationId: ids.correlation,
      },
    } as const;

    await expect(
      useCases.endProductImpactOverride({
        ...command,
        overrideId: "not-a-uuid",
      }),
    ).resolves.toEqual({ ok: false, error: { code: "invalid_request" } });
    await expect(
      useCases.endProductImpactOverride(command),
    ).resolves.toMatchObject({
      ok: true,
      value: { idempotent: false },
    });
    await expect(useCases.endProductImpactOverride(command)).resolves.toEqual({
      ok: false,
      error: { code: "conflict" },
    });
    await expect(useCases.endProductImpactOverride(command)).resolves.toEqual({
      ok: false,
      error: { code: "malformed_provider" },
    });
  });
});

function repositoryFor(
  overrides: Partial<
    Record<keyof FindingPropagationRepository, jest.Mock>
  > = {},
): FindingPropagationRepository &
  Record<keyof FindingPropagationRepository, jest.Mock> {
  return {
    registerSource: jest.fn(),
    updateSource: jest.fn(),
    getProductImpactSummary: jest.fn(),
    createProductImpactOverride: jest.fn(),
    endProductImpactOverride: jest.fn(),
    ...overrides,
  } as never;
}

function registerInput() {
  return {
    sourceSystem: "sbom-correlation",
    sourceFindingKey: "opaque-finding-42",
    sourceProductId: ids.product,
    sourceReleaseId: ids.release,
    ruleVersion: "m2-v1",
    source: "SBOM correlation service",
    provenance: "Signed ingest batch",
    idempotencyKey: ids.key,
    correlationId: ids.correlation,
  } as const;
}

function updateInput() {
  return {
    sourceProductId: ids.product,
    sourceReleaseId: ids.release,
    ruleVersion: "m2-v2",
    status: "active",
    reason: "The release mapping changed after a signed SBOM review.",
    source: "SBOM correlation service",
    provenance: "Signed ingest batch",
    expectedVersion: 0,
    idempotencyKey: ids.key,
    correlationId: ids.correlation,
  } as const;
}

function mutationResponse() {
  return {
    source: {
      id: ids.source,
      organizationId: ids.organization,
      status: "active" as const,
      version: 0,
    },
    jobId: ids.job,
    idempotent: false,
  };
}

function overrideInput() {
  return {
    affectedReleaseId: ids.release,
    overrideState: "not_applicable" as const,
    reason: "The product configuration omits the affected feature.",
    source: "Configuration review",
    provenance: "Approved configuration record",
    effectiveStartsAt: at,
    idempotencyKey: ids.key,
    correlationId: ids.correlation,
  };
}

function overrideResponse() {
  return {
    override: {
      id: ids.override,
      organizationId: ids.organization,
      sourceId: ids.source,
      affectedProductId: ids.product,
      affectedReleaseId: ids.release,
      overrideState: "not_applicable" as const,
      reason: "The product configuration omits the affected feature.",
      source: "Configuration review",
      provenance: "Approved configuration record",
      effectiveStartsAt: at,
      effectiveEndsAt: null,
      version: 0,
      createdAt: at,
      createdBy: ids.actor,
      updatedAt: at,
      updatedBy: ids.actor,
      endedAt: null,
      endedBy: null,
      endReason: null,
    },
    idempotent: false,
  };
}
