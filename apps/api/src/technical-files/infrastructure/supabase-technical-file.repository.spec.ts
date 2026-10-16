import { SupabaseTechnicalFileRepository } from "./supabase-technical-file.repository";

describe("SupabaseTechnicalFileRepository", () => {
  const organizationId = "00000000-0000-4000-8000-000000000001";
  const actorId = "00000000-0000-4000-8000-000000000002";
  const productId = "00000000-0000-4000-8000-000000000003";

  it("passes verified tenant scope and parses the RPC response envelope", async () => {
    const technicalFile = {
      id: "00000000-0000-4000-8000-000000000004",
      organizationId,
      productId,
      templateKey: "annex_vii",
      templateVersion: "2024-01",
      legalSource: "Annex VII",
      status: "active",
      version: 1,
      sections: [],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const rpc = jest.fn().mockResolvedValue({
      data: { outcome: "found", result: { technicalFile } },
      error: null,
    });
    const repository = new SupabaseTechnicalFileRepository({
      admin: () => ({ rpc }),
    } as never);

    await expect(
      repository.get(organizationId, { actorId, productId }),
    ).resolves.toEqual(technicalFile);
    expect(rpc).toHaveBeenCalledWith("get_technical_file", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_product_id: productId,
    });
  });

  it("maps a durable version conflict without trusting malformed current state", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { outcome: "conflict", result: null },
      error: null,
    });
    const repository = new SupabaseTechnicalFileRepository({
      admin: () => ({ rpc }),
    } as never);

    await expect(
      repository.updateSection(organizationId, {
        actorId,
        productId,
        sectionKey: "test_reports",
        expectedVersion: 1,
        narrative: null,
        applicability: "applicable",
        nonApplicabilityReason: null,
        idempotencyKey: "technical-file-update-0001",
      }),
    ).rejects.toThrow("changed");
  });
});
