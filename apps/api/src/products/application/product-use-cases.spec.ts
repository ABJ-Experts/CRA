import type {
  ReleaseMarketAvailabilityReader,
  ReleaseRegulatoryStateReader,
} from "./release-regulatory-reader.port";
import type { ProductRelationshipResolverPort } from "./product-relationship-reader.port";
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

  it("publishes only scoped propagation candidates through the relationship resolver", async () => {
    const candidates = Object.freeze([
      Object.freeze({
        productId: "00000000-0000-4000-8000-000000000004",
        releaseId: "00000000-0000-4000-8000-000000000005",
        relationshipPathIds: Object.freeze(["relationship"]),
      }),
    ]);
    const repository = {
      getRelationshipPropagationCandidates: jest.fn().mockResolvedValue({
        outcome: "found",
        candidates,
        nextCursor: null,
        graphVersion: 2,
        evaluatedAt: "2026-08-13T00:00:00.000Z",
      }),
    };
    const useCases = new ProductUseCases(repository as never, {} as never);
    const resolver: ProductRelationshipResolverPort = useCases;
    const command = {
      organizationId,
      actorId,
      sourceReleaseId: "00000000-0000-4000-8000-000000000006",
      graphVersion: 2,
    };

    await expect(
      resolver.getRelationshipPropagationCandidates(command),
    ).resolves.toEqual({
      ok: true,
      value: {
        candidates,
        nextCursor: null,
        graphVersion: 2,
        evaluatedAt: "2026-08-13T00:00:00.000Z",
      },
    });
    expect(
      repository.getRelationshipPropagationCandidates,
    ).toHaveBeenCalledWith(
      organizationId,
      actorId,
      expect.objectContaining({
        ...command,
        pageSize: 25,
      }),
    );
  });

  it("rejects ambiguous propagation sources before querying the repository", async () => {
    const repository = {
      getRelationshipPropagationCandidates: jest.fn(),
    };
    const useCases = new ProductUseCases(repository as never, {} as never);

    await expect(
      useCases.getRelationshipPropagationCandidates({
        organizationId,
        actorId,
        sourceReleaseId: "00000000-0000-4000-8000-000000000004",
        sourceBaselineRevisionId: "00000000-0000-4000-8000-000000000005",
        graphVersion: 2,
      }),
    ).resolves.toEqual({ ok: false, error: { code: "invalid_request" } });
    expect(
      repository.getRelationshipPropagationCandidates,
    ).not.toHaveBeenCalled();
  });

  it("keeps the complete relationship command surface tenant-scoped and returns durable outcomes", async () => {
    const baseline = Object.freeze({ id: "baseline" });
    const membership = Object.freeze({ id: "membership" });
    const variant = Object.freeze({ id: "variant" });
    const component = Object.freeze({ id: "component" });
    const preview = Object.freeze({ outcome: "allowed" });
    const graph = Object.freeze({ graphVersion: 3 });
    const event = Object.freeze({ id: "event" });
    const repository = {
      createSoftwareBaseline: jest
        .fn()
        .mockResolvedValue({ outcome: "created", baseline }),
      appendSoftwareBaselineRevision: jest
        .fn()
        .mockResolvedValue({ outcome: "updated", baseline }),
      getSoftwareBaselineHistory: jest
        .fn()
        .mockResolvedValue({ outcome: "found", baselines: [baseline] }),
      archiveSoftwareBaseline: jest
        .fn()
        .mockResolvedValue({ outcome: "archived", baseline }),
      assignSoftwareBaselineMembership: jest
        .fn()
        .mockResolvedValue({ outcome: "created", membership }),
      endSoftwareBaselineMembership: jest
        .fn()
        .mockResolvedValue({ outcome: "ended", membership }),
      getSoftwareBaselineMemberships: jest
        .fn()
        .mockResolvedValue({ outcome: "found", memberships: [membership] }),
      createProductVariantRelationship: jest.fn().mockResolvedValue({
        outcome: "created",
        relationship: variant,
        graphVersion: 1,
      }),
      endProductVariantRelationship: jest.fn().mockResolvedValue({
        outcome: "ended",
        relationship: variant,
        graphVersion: 2,
      }),
      getProductVariantRelationships: jest
        .fn()
        .mockResolvedValue({ outcome: "found", relationships: [variant] }),
      previewProductComponentLink: jest
        .fn()
        .mockResolvedValue({ outcome: "found", preview }),
      createProductComponentLink: jest.fn().mockResolvedValue({
        outcome: "created",
        relationship: component,
        graphVersion: 2,
      }),
      endProductComponentLink: jest.fn().mockResolvedValue({
        outcome: "ended",
        relationship: component,
        graphVersion: 3,
      }),
      supersedeProductComponentLink: jest.fn().mockResolvedValue({
        outcome: "created",
        relationship: component,
        graphVersion: 4,
      }),
      getProductComponentLinks: jest
        .fn()
        .mockResolvedValue({ outcome: "found", links: [component] }),
      getProductRelationshipGraph: jest
        .fn()
        .mockResolvedValue({ outcome: "found", graph }),
      getRelationshipPropagationEvents: jest.fn().mockResolvedValue({
        outcome: "found",
        events: [event],
        nextCursor: null,
      }),
      requestRelationshipReevaluation: jest
        .fn()
        .mockResolvedValue({ outcome: "created", event }),
    };
    const useCases = new ProductUseCases(repository as never, {} as never);
    const productId = "00000000-0000-4000-8000-000000000004";
    const relationshipId = "00000000-0000-4000-8000-000000000005";
    const command = Object.freeze({ organizationId, actorId, productId });

    const results = await Promise.all([
      useCases.createSoftwareBaseline({
        organizationId,
        actorId,
        input: {} as never,
      }),
      useCases.appendSoftwareBaselineRevision({
        organizationId,
        actorId,
        baselineId: "00000000-0000-4000-8000-000000000006",
        input: {} as never,
      }),
      useCases.getSoftwareBaselineHistory({
        organizationId,
        actorId,
        baselineId: "00000000-0000-4000-8000-000000000006",
      }),
      useCases.archiveSoftwareBaseline({
        organizationId,
        actorId,
        baselineId: "00000000-0000-4000-8000-000000000006",
        input: {} as never,
      }),
      useCases.assignSoftwareBaselineMembership({
        ...command,
        input: {} as never,
      }),
      useCases.endSoftwareBaselineMembership({
        ...command,
        membershipId: relationshipId,
        input: {} as never,
      }),
      useCases.getSoftwareBaselineMemberships(command),
      useCases.createProductVariantRelationship({
        ...command,
        targetProductId: productId,
        input: { variantProductId: productId } as never,
      }),
      useCases.endProductVariantRelationship({
        ...command,
        relationshipId,
        input: {} as never,
      }),
      useCases.getProductVariantRelationships(command),
      useCases.previewProductComponentLink({
        ...command,
        parentProductId: productId,
        input: {} as never,
      }),
      useCases.createProductComponentLink({
        ...command,
        parentProductId: productId,
        input: {} as never,
      }),
      useCases.endProductComponentLink({
        ...command,
        relationshipId,
        input: {} as never,
      }),
      useCases.supersedeProductComponentLink({
        ...command,
        relationshipId,
        input: {} as never,
      }),
      useCases.getProductComponentLinks(command),
      useCases.getProductRelationshipGraph({ ...command, query: {} as never }),
      useCases.getRelationshipPropagationEvents({
        ...command,
        query: {} as never,
      }),
      useCases.requestRelationshipReevaluation({
        ...command,
        input: {} as never,
      }),
    ]);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(repository.createProductVariantRelationship).toHaveBeenCalledWith(
      organizationId,
      actorId,
      productId,
      expect.objectContaining({ variantProductId: productId }),
    );
    expect(repository.getRelationshipPropagationEvents).toHaveBeenCalledWith(
      organizationId,
      actorId,
      productId,
      expect.anything(),
    );
  });

  it("preserves relationship conflicts, cycle rejections, and tenant-safe misses", async () => {
    const repository = {
      createSoftwareBaseline: jest
        .fn()
        .mockResolvedValue({ outcome: "conflict" }),
      appendSoftwareBaselineRevision: jest
        .fn()
        .mockResolvedValue({ outcome: "idempotency_mismatch" }),
      getSoftwareBaselineHistory: jest
        .fn()
        .mockResolvedValue({ outcome: "not_found" }),
      archiveSoftwareBaseline: jest
        .fn()
        .mockResolvedValue({ outcome: "blocked" }),
      assignSoftwareBaselineMembership: jest
        .fn()
        .mockResolvedValue({ outcome: "not_found" }),
      endSoftwareBaselineMembership: jest
        .fn()
        .mockResolvedValue({ outcome: "conflict" }),
      getSoftwareBaselineMemberships: jest
        .fn()
        .mockResolvedValue({ outcome: "not_found" }),
      createProductVariantRelationship: jest
        .fn()
        .mockResolvedValue({ outcome: "cycle_detected" }),
      endProductVariantRelationship: jest
        .fn()
        .mockResolvedValue({ outcome: "depth_exceeded" }),
      getProductVariantRelationships: jest
        .fn()
        .mockResolvedValue({ outcome: "not_found" }),
      previewProductComponentLink: jest
        .fn()
        .mockResolvedValue({ outcome: "cycle_detected" }),
      createProductComponentLink: jest
        .fn()
        .mockResolvedValue({ outcome: "depth_exceeded" }),
      endProductComponentLink: jest
        .fn()
        .mockResolvedValue({ outcome: "blocked" }),
      supersedeProductComponentLink: jest
        .fn()
        .mockResolvedValue({ outcome: "idempotency_mismatch" }),
      getProductComponentLinks: jest
        .fn()
        .mockResolvedValue({ outcome: "not_found" }),
      getProductRelationshipGraph: jest
        .fn()
        .mockResolvedValue({ outcome: "invalid_request" }),
      getRelationshipPropagationEvents: jest
        .fn()
        .mockResolvedValue({ outcome: "not_found" }),
      requestRelationshipReevaluation: jest
        .fn()
        .mockResolvedValue({ outcome: "blocked" }),
    };
    const useCases = new ProductUseCases(repository as never, {} as never);
    const productId = "00000000-0000-4000-8000-000000000004";
    const relationshipId = "00000000-0000-4000-8000-000000000005";
    const command = Object.freeze({ organizationId, actorId, productId });

    const results = await Promise.all([
      useCases.createSoftwareBaseline({
        organizationId,
        actorId,
        input: {} as never,
      }),
      useCases.appendSoftwareBaselineRevision({
        organizationId,
        actorId,
        baselineId: "00000000-0000-4000-8000-000000000006",
        input: {} as never,
      }),
      useCases.getSoftwareBaselineHistory({
        organizationId,
        actorId,
        baselineId: "00000000-0000-4000-8000-000000000006",
      }),
      useCases.archiveSoftwareBaseline({
        organizationId,
        actorId,
        baselineId: "00000000-0000-4000-8000-000000000006",
        input: {} as never,
      }),
      useCases.assignSoftwareBaselineMembership({
        ...command,
        input: {} as never,
      }),
      useCases.endSoftwareBaselineMembership({
        ...command,
        membershipId: relationshipId,
        input: {} as never,
      }),
      useCases.getSoftwareBaselineMemberships(command),
      useCases.createProductVariantRelationship({
        ...command,
        targetProductId: productId,
        input: { variantProductId: productId } as never,
      }),
      useCases.endProductVariantRelationship({
        ...command,
        relationshipId,
        input: {} as never,
      }),
      useCases.getProductVariantRelationships(command),
      useCases.previewProductComponentLink({
        ...command,
        parentProductId: productId,
        input: {} as never,
      }),
      useCases.createProductComponentLink({
        ...command,
        parentProductId: productId,
        input: {} as never,
      }),
      useCases.endProductComponentLink({
        ...command,
        relationshipId,
        input: {} as never,
      }),
      useCases.supersedeProductComponentLink({
        ...command,
        relationshipId,
        input: {} as never,
      }),
      useCases.getProductComponentLinks(command),
      useCases.getProductRelationshipGraph({ ...command, query: {} as never }),
      useCases.getRelationshipPropagationEvents({
        ...command,
        query: {} as never,
      }),
      useCases.requestRelationshipReevaluation({
        ...command,
        input: {} as never,
      }),
    ]);

    expect(
      results.map((result) => (result.ok ? "ok" : result.error.code)),
    ).toEqual([
      "conflict",
      "conflict",
      "not_found",
      "dependency_blocked",
      "not_found",
      "conflict",
      "not_found",
      "cycle_detected",
      "depth_exceeded",
      "not_found",
      "cycle_detected",
      "depth_exceeded",
      "dependency_blocked",
      "conflict",
      "not_found",
      "invalid_request",
      "not_found",
      "dependency_blocked",
    ]);
  });
});
