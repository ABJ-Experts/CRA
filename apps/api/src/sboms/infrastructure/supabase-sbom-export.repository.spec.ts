import { SupabaseSbomExportRepository } from "./supabase-sbom-export.repository";
const id = "11111111-1111-4111-8111-111111111111";
describe("SBOM export adapter", () => {
  it("denies missing or unauthorized graph before service-role table reads", async () => {
    const normalization = { getDocument: jest.fn().mockResolvedValue(null) };
    const supabase = { admin: jest.fn() };
    const repository = new SupabaseSbomExportRepository(
      supabase as never,
      normalization as never,
    );
    expect(
      await repository.graph(id, { actorId: id, sourceId: id, documentId: id }),
    ).toBeNull();
    expect(normalization.getDocument).toHaveBeenCalledWith(id, {
      actorId: id,
      documentId: id,
    });
    expect(supabase.admin).not.toHaveBeenCalled();
  });
});
function setup(
  tables: Record<string, unknown>,
  detail: unknown = {
    document: {
      state: "completed",
      componentCount: 0,
      dependencyCount: 0,
      createdAt: "2026-09-28T00:00:00Z",
    },
  },
) {
  const filters: unknown[] = [];
  const admin = {
    from: jest.fn((table: string) => {
      const result = tables[table] ?? { data: null, error: null };
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        gt: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue(result),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(result).then(resolve),
      };
      chain.eq.mockImplementation((...args: unknown[]) => {
        filters.push([table, ...args]);
        return chain;
      });
      return chain;
    }),
    rpc: jest.fn(),
  };
  const normalization = { getDocument: jest.fn().mockResolvedValue(detail) };
  return {
    repository: new SupabaseSbomExportRepository(
      { admin: () => admin } as never,
      normalization as never,
    ),
    admin,
    normalization,
    filters,
  };
}
const source = {
  data: { id, product_id: id, release_id: id, status: "verified" },
  error: null,
};
const mapping = { data: { source_id: id }, error: null };
describe("scoped graph reads", () => {
  it("reads a completed graph with org filters and rechecks authorization", async () => {
    const { repository, filters, normalization } = setup({
      sbom_document_sources: mapping,
      sbom_sources: source,
      sbom_components: { data: [], error: null },
      sbom_component_dependencies: { data: [], error: null },
    });
    expect(
      await repository.graph(id, { actorId: id, sourceId: id, documentId: id }),
    ).toMatchObject({
      documentId: id,
      sourceId: id,
      components: [],
      dependencies: [],
    });
    expect(
      filters.filter((filter) => (filter as string[])[1] === "organization_id"),
    ).toHaveLength(4);
    expect(normalization.getDocument).toHaveBeenCalledTimes(2);
  });
  it("does not export another source's graph", async () => {
    const { repository, admin } = setup({
      sbom_document_sources: { data: null, error: null },
    });
    expect(
      await repository.graph(id, { actorId: id, sourceId: id, documentId: id }),
    ).toBeNull();
    expect(admin.from).toHaveBeenCalledTimes(1);
  });
  it.each([
    "sbom_document_sources",
    "sbom_sources",
    "sbom_components",
    "sbom_component_dependencies",
  ])("fails on %s provider error", async (table) => {
    const { repository } = setup({
      sbom_document_sources: mapping,
      sbom_sources: source,
      sbom_components: { data: [], error: null },
      sbom_component_dependencies: { data: [], error: null },
      [table]: { data: null, error: { message: "private" } },
    });
    await expect(
      repository.graph(id, { actorId: id, sourceId: id, documentId: id }),
    ).rejects.toThrow();
  });
  it("rejects incomplete normalization", async () => {
    const { repository } = setup({}, { document: { state: "processing" } });
    await expect(
      repository.graph(id, { actorId: id, sourceId: id, documentId: id }),
    ).rejects.toThrow("normalization");
  });
  it("rejects changed graph counts", async () => {
    const { repository } = setup(
      {
        sbom_document_sources: mapping,
        sbom_sources: source,
        sbom_components: { data: [], error: null },
        sbom_component_dependencies: { data: [], error: null },
      },
      {
        document: { state: "completed", componentCount: 1, dependencyCount: 0 },
      },
    );
    await expect(
      repository.graph(id, { actorId: id, sourceId: id, documentId: id }),
    ).rejects.toThrow("changed");
  });
  it("stops a read when membership is revoked before serialization", async () => {
    const { repository, normalization } = setup({
      sbom_document_sources: mapping,
      sbom_sources: source,
      sbom_components: { data: [], error: null },
      sbom_component_dependencies: { data: [], error: null },
    });
    normalization.getDocument
      .mockResolvedValueOnce({
        document: { state: "completed", componentCount: 0, dependencyCount: 0 },
      })
      .mockResolvedValueOnce(null);
    expect(
      await repository.graph(id, { actorId: id, sourceId: id, documentId: id }),
    ).toBeNull();
  });
  it.each(["not_found", "forbidden"])(
    "conceals %s VEX scope",
    async (outcome) => {
      const { repository, admin } = setup({});
      admin.rpc.mockResolvedValue({
        data: [{ outcome, result: null }],
        error: null,
      });
      expect(
        await repository.reviewedVex(id, {
          actorId: id,
          productId: id,
          releaseId: id,
        }),
      ).toBeNull();
      expect(admin.rpc).toHaveBeenCalledWith(
        "preview_vulnerability_vex_export_scope",
        expect.objectContaining({
          p_organization_id: id,
          p_product_id: id,
          p_release_id: id,
          p_actor_user_id: id,
        }),
      );
    },
  );
  it("fails VEX errors and unavailable mapping", async () => {
    const { repository, admin } = setup({});
    admin.rpc
      .mockResolvedValueOnce({ data: null, error: { message: "private" } })
      .mockResolvedValueOnce({
        data: [{ outcome: "mapping_unavailable", result: null }],
        error: null,
      });
    await expect(
      repository.reviewedVex(id, { actorId: id, productId: id, releaseId: id }),
    ).rejects.toThrow("read failed");
    await expect(
      repository.reviewedVex(id, { actorId: id, productId: id, releaseId: id }),
    ).rejects.toThrow("represented");
  });
});
const exportComponent = {
  id,
  normalized_name: "Root",
  normalized_version: "1",
  canonical_purl: "pkg:npm/example@1",
  cpe: null,
  supplier: null,
  license_expression: null,
  hashes: [],
};
const scope = {
  organizationId: id,
  scopeVersion: 0,
  product: { id, name: "Product" },
  release: { id, label: "Release", version: "1" },
  assessmentCount: 1,
  assessments: [
    {
      findingId: id,
      assessmentId: id,
      revision: 1,
      advisoryId: "CVE-2026-1",
      componentIdentity: "pkg:npm/example@1",
      canonicalPurl: "pkg:npm/example@1",
      componentVersion: "1",
      status: "affected",
      justification: null,
      approvalState: "approved",
      submittedAt: "2026-09-28T00:00:00Z",
      decidedAt: null,
      exportMappingIssue: null,
    },
  ],
};
describe("parsed normalized data", () => {
  it("preserves fields and retained exact edges", async () => {
    const { repository } = setup(
      {
        sbom_document_sources: mapping,
        sbom_sources: source,
        sbom_components: { data: [exportComponent], error: null },
        sbom_component_dependencies: {
          data: [
            {
              id,
              parent_component_id: id,
              child_component_id: id,
              edge_state: "retained",
            },
          ],
          error: null,
        },
      },
      {
        document: {
          state: "completed",
          componentCount: 1,
          dependencyCount: 1,
          createdAt: "2026-09-28T00:00:00Z",
        },
      },
    );
    expect(
      await repository.graph(id, { actorId: id, documentId: id, sourceId: id }),
    ).toMatchObject({
      components: [{ id, name: "Root" }],
      dependencies: [{ parentId: id, childId: id }],
    });
  });
  it("rejects unresolved edges rather than omit", async () => {
    const { repository } = setup(
      {
        sbom_document_sources: mapping,
        sbom_sources: source,
        sbom_components: { data: [exportComponent], error: null },
        sbom_component_dependencies: {
          data: [
            {
              id,
              parent_component_id: id,
              child_component_id: null,
              edge_state: "omitted",
            },
          ],
          error: null,
        },
      },
      {
        document: { state: "completed", componentCount: 1, dependencyCount: 1 },
      },
    );
    await expect(
      repository.graph(id, { actorId: id, documentId: id, sourceId: id }),
    ).rejects.toThrow("Unresolved");
  });
  it("does not expose a removed source", async () => {
    const { repository } = setup({
      sbom_document_sources: mapping,
      sbom_sources: { data: null, error: null },
    });
    expect(
      await repository.graph(id, { actorId: id, documentId: id, sourceId: id }),
    ).toBeNull();
  });
  it("maps existing approved M5 projection, with scope substitution checks", async () => {
    const { repository, admin } = setup({});
    admin.rpc.mockResolvedValue({
      data: [
        { outcome: "found", result: { scopeDigest: "a".repeat(64), scope } },
      ],
      error: null,
    });
    expect(
      await repository.reviewedVex(id, {
        actorId: id,
        productId: id,
        releaseId: id,
      }),
    ).toMatchObject([
      {
        approvalState: "approved",
        effectiveAt: "2026-09-28T00:00:00Z",
        provenanceReference: `${id}:1`,
      },
    ]);
    await expect(
      repository.reviewedVex("22222222-2222-4222-8222-222222222222", {
        actorId: id,
        productId: id,
        releaseId: id,
      }),
    ).rejects.toThrow("scope");
    admin.rpc.mockResolvedValue({
      data: [
        {
          outcome: "no_eligible_assessments",
          result: {
            scopeDigest: "a".repeat(64),
            scope: { ...scope, assessmentCount: 0, assessments: [] },
          },
        },
      ],
      error: null,
    });
    expect(
      await repository.reviewedVex(id, {
        actorId: id,
        productId: id,
        releaseId: id,
      }),
    ).toEqual([]);
  });
});
