import { SbomNormalizationUseCases } from "./sbom-normalization-use-cases";

const organizationId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const productId = "00000000-0000-4000-8000-000000000003";
const releaseId = "00000000-0000-4000-8000-000000000004";
const documentId = "00000000-0000-4000-8000-000000000005";

describe("SbomNormalizationUseCases", () => {
  it("passes verified tenant identity to a release-scoped document query", async () => {
    const repository = { listDocuments: jest.fn().mockResolvedValue(null) };
    const useCases = new SbomNormalizationUseCases(repository as never);

    await expect(
      useCases.listDocuments({
        organizationId,
        actorId,
        productId,
        releaseId,
        limit: 25,
      }),
    ).resolves.toEqual({ ok: false, error: { code: "not_found" } });
    expect(repository.listDocuments).toHaveBeenCalledWith(organizationId, {
      actorId,
      productId,
      releaseId,
      limit: 25,
      cursor: undefined,
    });
  });

  it("does not disclose a missing document across list, search, and tree reads", async () => {
    const repository = {
      getDocument: jest.fn().mockResolvedValue(null),
      searchComponents: jest.fn().mockResolvedValue(null),
      listDependencyTree: jest.fn().mockResolvedValue(null),
    };
    const useCases = new SbomNormalizationUseCases(repository as never);
    const command = { organizationId, actorId, documentId, limit: 50 };

    await expect(useCases.document(command)).resolves.toEqual({
      ok: false,
      error: { code: "not_found" },
    });
    await expect(useCases.searchComponents(command)).resolves.toEqual({
      ok: false,
      error: { code: "not_found" },
    });
    await expect(useCases.dependencyTree(command)).resolves.toEqual({
      ok: false,
      error: { code: "not_found" },
    });
  });
});
