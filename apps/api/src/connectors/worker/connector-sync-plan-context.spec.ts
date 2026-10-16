import { createConnectorSyncPlanContext } from "./connector-sync-plan-context";
const connectorContext = {
  connector: {
    connectorType: "reference_conformance",
    connectionConfig: {},
    hasSecret: true,
  },
};

function queryFixture() {
  const queued: Record<string, unknown>[] = [];
  const queries: { table: string; eq: jest.Mock }[] = [];
  const rpc = jest
    .fn()
    .mockResolvedValue({ data: { outcome: "allowed" }, error: null });
  const from = jest.fn((table: string) => {
    const result = queued.shift() ?? { data: null, error: null };
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "neq", "like", "limit"])
      query[method] = jest.fn().mockReturnValue(query);
    query.maybeSingle = jest.fn().mockResolvedValue(result);
    query.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve(result).then(resolve);
    queries.push({ table, eq: query.eq as jest.Mock });
    return query;
  });
  const context = createConnectorSyncPlanContext(
    { admin: () => ({ from, rpc }) } as never,
    "org-a",
    "connector-a",
    {
      ...connectorContext.connector,
      connectionConfig: {
        defaultOwnerBinding: {
          responsibleOwnerId: "owner-a",
          legalEntityId: "entity-a",
        },
      },
    } as never,
    [
      { entityType: "product", externalId: "single", changeKind: "upsert" },
      { entityType: "product", externalId: "duplicate", changeKind: "upsert" },
      { entityType: "product", externalId: "duplicate", changeKind: "upsert" },
      { entityType: "release", externalId: "release", changeKind: "upsert" },
      { entityType: "product", externalId: "deleted", changeKind: "tombstone" },
    ],
  );
  return { queued, queries, rpc, context };
}

describe("connector planner tenant-scoped storage", () => {
  it("fails closed on mapping, candidate, field and policy lookup outages", async () => {
    const { context, queued } = queryFixture();
    const methods = [
      () => context.findActiveMapping("product", "external"),
      () => context.findProductCandidatesByCode("code"),
      () => context.findReleaseCandidatesByVersion("product", "version"),
      () => context.getProductFields("product"),
      () => context.getReleaseFields("product", "release"),
      () => context.getFieldAuthorityPolicy("product", "name"),
    ];
    for (const method of methods) {
      queued.push({ data: null, error: { message: "upstream-canary" } });
      await expect(method()).rejects.toThrow(/connector_.*_lookup_failed/);
    }
  });
  it("resolves mappings and fields without treating other tenants as candidates", async () => {
    const { context, queued, queries } = queryFixture();
    queued.push({ data: null, error: null });
    expect(await context.findActiveMapping("product", "external")).toBeNull();
    queued.push({
      data: { id: "identity", cra_product_id: "product", cra_release_id: null },
      error: null,
    });
    expect(await context.findActiveMapping("product", "external")).toEqual({
      id: "identity",
      craProductId: "product",
      craReleaseId: null,
    });
    queued.push(
      { data: [{ id: "product" }], error: null },
      { data: null, count: 1, error: null },
    );
    expect(await context.findProductCandidatesByCode("code")).toEqual([
      { productId: "product", hasOtherActiveMapping: true },
    ]);
    queued.push({ data: [{ id: "release" }], error: null });
    expect(
      await context.findReleaseCandidatesByVersion("product", "version"),
    ).toEqual([{ releaseId: "release", hasOtherActiveMapping: false }]);
    queued.push({ data: null, error: null });
    expect(await context.getProductFields("product")).toBeNull();
    queued.push({
      data: {
        name: "name",
        internal_code: "code",
        product_type: "software",
        description: null,
        version: 3,
      },
      error: null,
    });
    expect(await context.getProductFields("product")).toMatchObject({
      internalCode: "code",
      version: 3,
    });
    queued.push({ data: null, error: null });
    expect(await context.getReleaseFields("product", "release")).toBeNull();
    queued.push({
      data: {
        label: "label",
        release_version: "1.0",
        description: null,
        version: 2,
      },
      error: null,
    });
    expect(await context.getReleaseFields("product", "release")).toMatchObject({
      releaseVersion: "1.0",
      version: 2,
    });
    queued.push({ data: null, error: null });
    expect(await context.getFieldAuthorityPolicy("product", "name")).toBeNull();
    queued.push({
      data: {
        id: "policy",
        policy_value: "external",
        protected: true,
        policy_version: 2,
      },
      error: null,
    });
    expect(
      await context.getFieldAuthorityPolicy("product", "name"),
    ).toMatchObject({ id: "policy", policyVersion: 2, protected: true });
    for (const query of queries)
      expect(query.eq).toHaveBeenCalledWith("organization_id", "org-a");
    expect(context.isProductExternalIdPlanned("single")).toBe(true);
    expect(context.isProductExternalIdPlanned("duplicate")).toBe(false);
    expect(context.isProductExternalIdPlanned("deleted")).toBe(false);
    expect(context.hashValue(null)).toMatch(/^[a-f0-9]{64}$/);
    expect(context.hashValue("value")).not.toBe(context.hashValue(null));
    expect(context.nowIso()).toMatch(/^\d{4}-/);
  });
  it("uses connector-owned hierarchy and the existing organization graph preview", async () => {
    const { context, queued, queries, rpc } = queryFixture();
    queued.push({
      data: [{ id: "identity", cra_product_id: "parent" }],
      error: null,
    });
    expect(
      await context.getActiveProductMappingsForExternalParent(
        "parent-external",
      ),
    ).toEqual([{ identityId: "identity", craProductId: "parent" }]);
    queued.push({ data: null, error: null });
    expect(await context.getConnectorOwnedParent("child")).toEqual({
      outcome: "none",
    });
    queued.push({ data: [{ source_product_id: "parent" }], error: null });
    expect(await context.getConnectorOwnedParent("child")).toEqual({
      outcome: "one",
      parentProductId: "parent",
    });
    queued.push({
      data: [{ source_product_id: "first" }, { source_product_id: "second" }],
      error: null,
    });
    expect(await context.getConnectorOwnedParent("child")).toEqual({
      outcome: "ambiguous",
      parentProductIds: ["first", "second"],
    });
    queued.push({
      data: { product_relationship_graph_version: 2 },
      error: null,
    });
    expect(
      await context.wouldCreateEmbeddedComponentCycle("parent", "child"),
    ).toBe(false);
    expect(rpc).toHaveBeenCalledWith(
      "m2_component_link_preview",
      expect.objectContaining({
        p_organization_id: "org-a",
        p_parent_product_id: "parent",
        p_component_product_id: "child",
        p_graph_version: 2,
      }),
    );
    rpc.mockResolvedValue({ data: { outcome: "cycle" }, error: null });
    queued.push({
      data: { product_relationship_graph_version: 2 },
      error: null,
    });
    expect(
      await context.wouldCreateEmbeddedComponentCycle("parent", "child"),
    ).toBe(true);
    for (const query of queries)
      expect(query.eq).toHaveBeenCalledWith("organization_id", "org-a");
    queued.push({ data: null, error: {} });
    await expect(
      context.getActiveProductMappingsForExternalParent("external"),
    ).rejects.toThrow("connector_parent_mapping_lookup_failed");
    queued.push({ data: null, error: {} });
    await expect(context.getConnectorOwnedParent("child")).rejects.toThrow(
      "connector_owned_parent_lookup_failed",
    );
    queued.push({ data: null, error: {} });
    await expect(
      context.wouldCreateEmbeddedComponentCycle("parent", "child"),
    ).rejects.toThrow("connector_relationship_graph_lookup_failed");
    rpc.mockResolvedValue({ data: null, error: {} });
    queued.push({
      data: { product_relationship_graph_version: 2 },
      error: null,
    });
    await expect(
      context.wouldCreateEmbeddedComponentCycle("parent", "child"),
    ).rejects.toThrow("connector_relationship_graph_preview_failed");
  });
});
