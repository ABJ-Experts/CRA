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
});
