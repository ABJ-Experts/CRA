import type {
  ReleaseMarketAvailabilityReader,
  ReleaseRegulatoryStateReader,
} from "./release-regulatory-reader.port";
import { ProductUseCases } from "./product-use-cases";

describe("ProductUseCases", () => {
  const organizationId = "00000000-0000-4000-8000-000000000001";
  const actorId = "00000000-0000-4000-8000-000000000002";
  const legalEntityId = "00000000-0000-4000-8000-000000000003";

  it("does not persist a product until an active complete legal-entity context is resolved", async () => {
    const repository = { createProduct: jest.fn() };
    const legalEntities = {
      resolveActiveContext: jest.fn().mockResolvedValue({
        ok: false,
        error: { code: "inactive" },
      }),
    };
    const useCases = new ProductUseCases(repository as never, legalEntities);

    const result = await useCases.create({
      organizationId,
      actorId,
      input: { legalEntityId } as never,
    });

    expect(result).toEqual({ ok: false, error: { code: "inactive" } });
    expect(repository.createProduct).not.toHaveBeenCalled();
  });

  it("validates legal-entity provenance before the authoritative create operation", async () => {
    const context = Object.freeze({
      organizationId,
      legalEntityId,
      legalEntityVersion: 4,
      legalEntitySnapshot: Object.freeze({ id: legalEntityId }),
    });
    const product = Object.freeze({
      id: "00000000-0000-4000-8000-000000000004",
    });
    const repository = {
      createProduct: jest
        .fn()
        .mockResolvedValue({ outcome: "created", product }),
    };
    const legalEntities = {
      resolveActiveContext: jest
        .fn()
        .mockResolvedValue({ ok: true, value: context }),
    };
    const useCases = new ProductUseCases(repository as never, legalEntities);

    await expect(
      useCases.create({
        organizationId,
        actorId,
        input: { legalEntityId } as never,
      }),
    ).resolves.toEqual({ ok: true, value: { product } });
    expect(legalEntities.resolveActiveContext).toHaveBeenCalledWith(
      organizationId,
      legalEntityId,
    );
    expect(repository.createProduct).toHaveBeenCalledWith(
      organizationId,
      actorId,
      expect.objectContaining({ legalEntityId }),
    );
  });

  it("maps foreign and stale product writes to safe application errors", async () => {
    const repository = {
      updateProduct: jest
        .fn()
        .mockResolvedValueOnce({ outcome: "not_found" })
        .mockResolvedValueOnce({
          outcome: "conflict",
          product: { id: "current" },
        }),
    };
    const useCases = new ProductUseCases(repository as never, {} as never);

    await expect(
      useCases.update({
        organizationId,
        actorId,
        productId: "product",
        input: {} as never,
      }),
    ).resolves.toEqual({ ok: false, error: { code: "not_found" } });
    await expect(
      useCases.update({
        organizationId,
        actorId,
        productId: "product",
        input: {} as never,
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "conflict", current: { id: "current" } },
    });
  });

  it("preserves malformed provider failures as a distinct safe error", async () => {
    const repository = {
      getRelease: jest.fn().mockRejectedValue(new Error("malformed")),
    };
    const useCases = new ProductUseCases(repository as never, {} as never);

    await expect(
      useCases.getRelease({
        organizationId,
        actorId,
        productId: "product",
        releaseId: "release",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "malformed_provider" },
    });
  });

  it("maps release regulatory domain outcomes without collapsing them to unavailable", async () => {
    const repository = {
      transitionReleaseLifecycle: jest.fn().mockResolvedValue({
        outcome: "placement_requires_active_market_availability",
      }),
    };
    const useCases = new ProductUseCases(repository as never, {} as never);

    await expect(
      useCases.transitionReleaseLifecycle({
        organizationId,
        actorId,
        productId: "product",
        releaseId: "release",
        input: {} as never,
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "placement_requires_active_market_availability" },
    });
  });

  it("returns parsed Member State reference data through the application port", async () => {
    const memberStates = Object.freeze([
      Object.freeze({
        countryCode: "AT",
        name: "Austria",
        version: 1,
        active: true,
      }),
    ]);
    const repository = {
      listMemberStates: jest.fn().mockResolvedValue({
        outcome: "found",
        memberStates,
      }),
    };
    const useCases = new ProductUseCases(repository as never, {} as never);

    await expect(
      useCases.listMemberStates({ organizationId, actorId }),
    ).resolves.toEqual({ ok: true, value: { memberStates } });
    expect(repository.listMemberStates).toHaveBeenCalledWith(
      organizationId,
      actorId,
    );
  });

  it("publishes scoped regulatory read ports without exposing infrastructure", async () => {
    const release = Object.freeze({ id: "release" });
    const marketAvailability = Object.freeze([
      Object.freeze({ countryCode: "AT" }),
    ]);
    const repository = {
      getRelease: jest.fn().mockResolvedValue({ outcome: "found", release }),
      getReleaseMarketAvailability: jest.fn().mockResolvedValue({
        outcome: "found",
        marketAvailability,
      }),
    };
    const useCases = new ProductUseCases(repository as never, {} as never);
    const regulatoryStateReader: ReleaseRegulatoryStateReader = useCases;
    const availabilityReader: ReleaseMarketAvailabilityReader = useCases;
    const command = {
      organizationId,
      actorId,
      productId: "product",
      releaseId: "release",
    };

    await expect(
      regulatoryStateReader.getReleaseRegulatoryState(command),
    ).resolves.toEqual({ ok: true, value: { release } });
    await expect(
      availabilityReader.getReleaseMarketAvailability(command),
    ).resolves.toEqual({ ok: true, value: { marketAvailability } });
  });
});
