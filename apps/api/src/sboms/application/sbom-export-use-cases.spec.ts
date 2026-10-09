import { SbomExportUseCases } from "./sbom-export-use-cases";
const id = "11111111-1111-4111-8111-111111111111";
const command = {
  organizationId: id,
  actorId: id,
  documentId: id,
  sourceId: id,
  format: "cyclonedx" as const,
  includeVex: false,
};
describe("SBOM export scope", () => {
  it("does not reveal missing or foreign evidence", async () => {
    const repository = {
      graph: jest.fn().mockResolvedValue(null),
      reviewedVex: jest.fn(),
    };
    expect(await new SbomExportUseCases(repository).export(command)).toEqual({
      ok: false,
      error: { code: "not_found" },
    });
    expect(repository.reviewedVex).not.toHaveBeenCalled();
  });
  it("returns unavailable on provider failure", async () => {
    const repository = {
      graph: jest.fn().mockRejectedValue(new Error("secret")),
      reviewedVex: jest.fn(),
    };
    expect(await new SbomExportUseCases(repository).export(command)).toEqual({
      ok: false,
      error: { code: "unavailable" },
    });
  });
});
describe("SBOM export behavior", () => {
  const graph = {
    documentId: id,
    sourceId: id,
    productId: id,
    releaseId: id,
    createdAt: "2026-09-28T00:00:00Z",
    components: [],
    dependencies: [],
  };
  it("serializes current immutable evidence without fetching VEX when not requested", async () => {
    const repository = {
      graph: jest.fn().mockResolvedValue(graph),
      reviewedVex: jest.fn(),
    };
    expect((await new SbomExportUseCases(repository).export(command)).ok).toBe(
      true,
    );
    expect(repository.reviewedVex).not.toHaveBeenCalled();
  });
  it("denies revoked VEX scope and reports absent eligible VEX explicitly", async () => {
    const repository = {
      graph: jest.fn().mockResolvedValue(graph),
      reviewedVex: jest.fn().mockResolvedValue(null),
    };
    expect(
      await new SbomExportUseCases(repository).export({
        ...command,
        includeVex: true,
      }),
    ).toEqual({ ok: false, error: { code: "not_found" } });
    repository.reviewedVex.mockResolvedValue([]);
    expect(
      await new SbomExportUseCases(repository).export({
        ...command,
        includeVex: true,
      }),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
  });
});
it("reports deterministic reviewed VEX mapping limitations as conflict, not provider outage", async () => {
  const graph = {
    documentId: id,
    sourceId: id,
    productId: id,
    releaseId: id,
    createdAt: "2026-09-28T00:00:00Z",
    components: [
      {
        id,
        name: "Example",
        version: "1.0",
        purl: "pkg:npm/example@1.0",
        cpe: null,
        supplier: null,
        license: null,
        hashes: [],
      },
    ],
    dependencies: [],
  };
  const repository = {
    graph: jest.fn().mockResolvedValue(graph),
    reviewedVex: jest.fn().mockResolvedValue([
      {
        findingId: id,
        assessmentId: id,
        revision: 1,
        advisoryId: "CVE-2026-1",
        canonicalPurl: "pkg:npm/example@1.0",
        componentVersion: "1.0",
        status: "affected",
        justification: null,
        approvalState: "approved",
        effectiveAt: "2026-09-28T00:00:00Z",
        provenanceReference: `${id}:1`,
      },
    ]),
  };
  expect(
    await new SbomExportUseCases(repository).export({
      ...command,
      includeVex: true,
    }),
  ).toMatchObject({ ok: false, error: { code: "conflict" } });
});
