import { SbomExportController } from "./sbom-export.controller";
const id = "11111111-1111-4111-8111-111111111111";
describe("SBOM export controller", () => {
  const query = {
    sourceId: id,
    format: "cyclonedx" as const,
    includeVex: false,
  };
  it("passes only verified identity and parsed scope", async () => {
    const useCases = {
      export: jest
        .fn()
        .mockResolvedValue({ ok: true, value: { export: { content: "{}" } } }),
    };
    const controller = new SbomExportController(useCases as never);
    expect(
      await controller.export({ documentId: id }, query, {
        id,
        organizationId: id,
      } as never),
    ).toEqual({ export: { content: "{}" } });
    expect(useCases.export).toHaveBeenCalledWith({
      documentId: id,
      ...query,
      organizationId: id,
      actorId: id,
    });
  });
  it.each([
    ["not_found", 404],
    ["conflict", 409],
    ["unavailable", 503],
  ])("maps %s without exposing provider errors", async (code, status) => {
    const controller = new SbomExportController({
      export: jest.fn().mockResolvedValue({
        ok: false,
        error: { code, message: "Explicit export limitation" },
      }),
    } as never);
    await expect(
      controller.export({ documentId: id }, query, {
        id,
        organizationId: id,
      } as never),
    ).rejects.toMatchObject({ status });
  });
  it("denies a session without organization", async () => {
    const useCases = { export: jest.fn() };
    await expect(
      new SbomExportController(useCases as never).export(
        { documentId: id },
        query,
        { id, organizationId: null } as never,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(useCases.export).not.toHaveBeenCalled();
  });
});
