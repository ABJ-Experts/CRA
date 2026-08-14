import { SupabaseProductRepository } from "./supabase-product.repository";

describe("SupabaseProductRepository", () => {
  const organizationId = "00000000-0000-4000-8000-000000000001";
  const actorId = "00000000-0000-4000-8000-000000000002";
  const productId = "00000000-0000-4000-8000-000000000003";
  const releaseId = "00000000-0000-4000-8000-000000000004";

  type RpcCall = Readonly<{
    name: string;
    args: Readonly<Record<string, unknown>>;
  }>;

  function harness(row: Record<string, unknown>) {
    const calls: RpcCall[] = [];
    const rpc = (
      name: string,
      args: Readonly<Record<string, unknown>>,
    ): Promise<{ data: Record<string, unknown>[]; error: null }> => {
      calls.push(Object.freeze({ name, args }));
      return Promise.resolve({ data: [row], error: null });
    };
    const repository = new SupabaseProductRepository({
      admin: () => ({ rpc }),
    } as never);
    return { repository, calls };
  }

  it("creates releases through the lifecycle-free V1 RPC signature", async () => {
    const { repository, calls } = harness({
      outcome: "created",
      release: releaseJson(),
    });

    await repository.createRelease(organizationId, actorId, productId, {
      label: "Release 1",
      version: "1.0.0",
      idempotencyKey: "10000000-0000-4000-8000-000000000001",
    });

    expect(calls[0]?.name).toBe("create_product_release_atomic");
    expect(calls[0]?.args).not.toHaveProperty("p_lifecycle");
  });

  it("updates release metadata without passing lifecycle through generic CRUD", async () => {
    const { repository, calls } = harness({
      outcome: "updated",
      release: releaseJson(),
    });

    await repository.updateRelease(
      organizationId,
      actorId,
      productId,
      releaseId,
      { label: "Release 1", expectedVersion: 3 },
    );

    expect(calls[0]?.name).toBe("update_product_release_atomic");
    expect(calls[0]?.args).not.toHaveProperty("p_lifecycle");
  });

  it("reads the versioned EU Member State reference envelope", async () => {
    const { repository } = harness({
      outcome: "found",
      member_states: {
        memberStates: [
          { countryCode: "AT", name: "Austria", version: 1, active: true },
        ],
      },
    });

    await expect(
      repository.listMemberStates(organizationId, actorId),
    ).resolves.toEqual({
      outcome: "found",
      memberStates: [
        { countryCode: "AT", name: "Austria", version: 1, active: true },
      ],
    });
  });

  it("sends lifecycle transition commands with server-generated correlation IDs", async () => {
    const { repository, calls } = harness({
      outcome: "transitioned",
      release: releaseJson({
        lifecycle: "placed_on_market",
        placedOnMarketAt: "2026-08-12T10:00:00.000Z",
        versionNumber: 4,
      }),
    });

    await repository.transitionReleaseLifecycle(
      organizationId,
      actorId,
      productId,
      releaseId,
      {
        targetState: "placed_on_market",
        expectedVersion: 3,
        placedOnMarketAt: "2026-08-12T10:00:00.000Z",
      },
    );

    expect(calls[0]?.name).toBe("transition_product_release_lifecycle_atomic");
    const args = calls[0]?.args ?? {};
    expect(args).toMatchObject({
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_product_id: productId,
      p_release_id: releaseId,
      p_expected_version: 3,
      p_target_lifecycle: "placed_on_market",
      p_placed_on_market_at: "2026-08-12T10:00:00.000Z",
      p_reason: null,
    });
    expect(args.p_correlation_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("keeps support-period writes org-first and parses their successful record", async () => {
    const { repository, calls } = harness({
      outcome: "created",
      support_period: supportPeriodJson(),
    });

    await expect(
      repository.createSupportPeriod(organizationId, actorId, productId, {
        releaseId,
        supportStartsAt: "2026-08-13T00:00:00.000Z",
        supportEndsAt: "2036-08-13T00:00:00.000Z",
        expectedLifetimeJustification:
          "Expected lifetime is supported by the approved maintenance plan.",
        idempotencyKey: "10000000-0000-4000-8000-000000000002",
      }),
    ).resolves.toEqual({
      outcome: "created",
      supportPeriod: supportPeriodJson(),
    });

    expect(calls[0]).toMatchObject({
      name: "create_product_support_period_atomic",
      args: {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_product_id: productId,
        p_release_id: releaseId,
        p_idempotency_key: "10000000-0000-4000-8000-000000000002",
      },
    });
    expect(calls[0]?.args.p_correlation_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("parses the complete retention explanation instead of trusting provider JSON", async () => {
    const retention = retentionJson();
    const { repository } = harness({ outcome: "found", retention });

    await expect(
      repository.getProductRetentionCalculation(
        organizationId,
        actorId,
        productId,
      ),
    ).resolves.toEqual({ outcome: "found", retention });
  });

  it("rejects a malformed retention response at the infrastructure boundary", async () => {
    const { repository } = harness({
      outcome: "found",
      retention: { status: "current" },
    });

    await expect(
      repository.getProductRetentionCalculation(
        organizationId,
        actorId,
        productId,
      ),
    ).rejects.toMatchObject({ code: "malformed" });
  });

  it("resolves propagation candidates through the org-first source RPC and parses its envelope", async () => {
    const candidate = {
      productId,
      releaseId,
      relationshipPathIds: [],
      graphVersion: 3,
      evaluatedAt: "2026-08-13T00:00:00.000Z",
    };
    const { repository, calls } = harness({
      outcome: "found",
      candidates: {
        candidates: [candidate],
        nextCursor: null,
        graphVersion: 3,
        evaluatedAt: "2026-08-13T00:00:00.000Z",
      },
    });

    await expect(
      repository.getRelationshipPropagationCandidates(organizationId, actorId, {
        organizationId,
        actorId,
        sourceReleaseId: releaseId,
        graphVersion: 3,
        pageSize: 25,
      }),
    ).resolves.toEqual({
      outcome: "found",
      candidates: [candidate],
      nextCursor: null,
      graphVersion: 3,
      evaluatedAt: "2026-08-13T00:00:00.000Z",
    });
    expect(calls[0]).toMatchObject({
      name: "get_product_relationship_propagation_candidates",
      args: {
        p_organization_id: organizationId,
        p_source_release_id: releaseId,
        p_source_baseline_revision_id: null,
        p_actor_user_id: actorId,
      },
    });
    expect(calls[0]?.args).not.toHaveProperty("p_source_product_id");
  });

  it("keeps every relationship lookup and command tenant-safe when the resource is absent", async () => {
    const { repository, calls } = harness({ outcome: "not_found" });
    const baselineId = "00000000-0000-4000-8000-000000000005";
    const membershipId = "00000000-0000-4000-8000-000000000006";
    const relationshipId = "00000000-0000-4000-8000-000000000007";

    const results = await Promise.all([
      repository.createSoftwareBaseline(organizationId, actorId, {} as never),
      repository.appendSoftwareBaselineRevision(
        organizationId,
        actorId,
        baselineId,
        {} as never,
      ),
      repository.getSoftwareBaselineHistory(
        organizationId,
        actorId,
        baselineId,
      ),
      repository.archiveSoftwareBaseline(
        organizationId,
        actorId,
        baselineId,
        {} as never,
      ),
      repository.assignSoftwareBaselineMembership(
        organizationId,
        actorId,
        productId,
        {} as never,
      ),
      repository.endSoftwareBaselineMembership(
        organizationId,
        actorId,
        productId,
        membershipId,
        {} as never,
      ),
      repository.getSoftwareBaselineMemberships(
        organizationId,
        actorId,
        productId,
      ),
      repository.createProductVariantRelationship(
        organizationId,
        actorId,
        productId,
        {} as never,
      ),
      repository.endProductVariantRelationship(
        organizationId,
        actorId,
        productId,
        relationshipId,
        {} as never,
      ),
      repository.getProductVariantRelationships(
        organizationId,
        actorId,
        productId,
      ),
      repository.previewProductComponentLink(
        organizationId,
        actorId,
        productId,
        {} as never,
      ),
      repository.createProductComponentLink(
        organizationId,
        actorId,
        productId,
        {} as never,
      ),
      repository.endProductComponentLink(
        organizationId,
        actorId,
        productId,
        relationshipId,
        {} as never,
      ),
      repository.supersedeProductComponentLink(
        organizationId,
        actorId,
        productId,
        relationshipId,
        {} as never,
      ),
      repository.getProductComponentLinks(organizationId, actorId, productId),
      repository.getProductRelationshipGraph(
        organizationId,
        actorId,
        productId,
        {} as never,
      ),
      repository.getRelationshipPropagationCandidates(organizationId, actorId, {
        organizationId,
        actorId,
        sourceReleaseId: releaseId,
        graphVersion: 1,
      }),
      repository.getRelationshipPropagationEvents(
        organizationId,
        actorId,
        productId,
        {} as never,
      ),
      repository.requestRelationshipReevaluation(
        organizationId,
        actorId,
        productId,
        {} as never,
      ),
    ]);

    expect(results.every((result) => result.outcome === "not_found")).toBe(
      true,
    );
    expect(calls).toHaveLength(19);
    for (const call of calls) {
      expect(call.args.p_organization_id).toBe(organizationId);
      expect(call.args.p_actor_user_id).toBe(actorId);
    }
  });

  function releaseJson(overrides: Record<string, unknown> = {}) {
    return {
      id: releaseId,
      organizationId,
      productId,
      label: "Release 1",
      version: "1.0.0",
      description: null,
      lifecycle: "development",
      placedOnMarketAt: null,
      marketAvailabilityWarning: "no_active_member_state_availability",
      legalEntity: {
        id: "00000000-0000-4000-8000-000000000005",
        identifier: "ABJ",
        legalName: "ABJ Experts",
        mainEstablishmentCountry: "DE",
        version: 1,
      },
      archivedAt: null,
      versionNumber: 3,
      createdAt: "2026-08-12T09:00:00.000Z",
      updatedAt: "2026-08-12T09:00:00.000Z",
      createdBy: actorId,
      updatedBy: actorId,
      ...overrides,
    };
  }

  function supportPeriodJson() {
    return {
      id: "00000000-0000-4000-8000-000000000006",
      organizationId,
      productId,
      releaseId,
      supportStartsAt: "2026-08-13T00:00:00.000Z",
      supportEndsAt: "2036-08-13T00:00:00.000Z",
      expectedLifetimeJustification:
        "Expected lifetime is supported by the approved maintenance plan.",
      decisionActorId: actorId,
      effectiveAt: "2026-08-13T00:00:00.000Z",
      supersededAt: null,
      supersededById: null,
      scopeRevision: 1,
      version: 1,
      createdAt: "2026-08-13T00:00:00.000Z",
      createdBy: actorId,
      updatedAt: "2026-08-13T00:00:00.000Z",
      updatedBy: actorId,
    };
  }

  function retentionJson() {
    return {
      ruleVersion: "m2.v1.later_of_placement_plus_10y_or_support_end",
      status: "current",
      placedOnMarketCandidate: "2036-08-13T00:00:00.000Z",
      supportPeriodCandidate: "2036-08-13T00:00:00.000Z",
      retentionUntil: "2036-08-13T00:00:00.000Z",
      retentionProtectionUntil: "2036-08-13T00:00:00.000Z",
      winningRule: "equal",
      incompleteReasons: [],
      legalHoldActive: false,
      releaseCalculations: [
        {
          releaseId,
          ruleVersion: "m2.v1.later_of_placement_plus_10y_or_support_end",
          status: "current",
          placedOnMarketCandidate: "2036-08-13T00:00:00.000Z",
          supportPeriodCandidate: "2036-08-13T00:00:00.000Z",
          retentionUntil: "2036-08-13T00:00:00.000Z",
          retentionProtectionUntil: "2036-08-13T00:00:00.000Z",
          winningRule: "equal",
          incompleteReasons: [],
          legalHoldActive: false,
        },
      ],
    };
  }
});
