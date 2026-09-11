import { SbomQualityUseCases } from "./sbom-quality-use-cases";

const organizationId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const sourceId = "00000000-0000-4000-8000-000000000003";

describe("SbomQualityUseCases", () => {
  it("passes verified tenant identity into source-scoped quality reads", async () => {
    const report = { report: { id: "report" } };
    const repository = {
      getQualityReport: jest.fn().mockResolvedValue(report),
    };
    const useCases = new SbomQualityUseCases(repository as never);

    await expect(
      useCases.report({ organizationId, actorId, sourceId }),
    ).resolves.toEqual({ ok: true, value: report });
    expect(repository.getQualityReport).toHaveBeenCalledWith(organizationId, {
      actorId,
      sourceId,
    });
  });

  it("returns indistinguishable not-found results for missing or foreign reports", async () => {
    const repository = {
      getQualityReport: jest.fn().mockResolvedValue(null),
      listQualityFindings: jest.fn().mockResolvedValue(null),
    };
    const useCases = new SbomQualityUseCases(repository as never);

    await expect(
      useCases.report({ organizationId, actorId, sourceId }),
    ).resolves.toEqual({ ok: false, error: { code: "not_found" } });
    await expect(
      useCases.findings({ organizationId, actorId, sourceId, limit: 50 }),
    ).resolves.toEqual({ ok: false, error: { code: "not_found" } });
  });

  it("maps optimistic settings conflicts without leaking provider state", async () => {
    const repository = {
      updateQualitySettings: jest
        .fn()
        .mockResolvedValue({ outcome: "conflict" }),
    };
    const useCases = new SbomQualityUseCases(repository as never);

    await expect(
      useCases.updateSettings({
        organizationId,
        actorId,
        expectedVersion: 2,
        bsiProfileEnabled: true,
      }),
    ).resolves.toEqual({ ok: false, error: { code: "conflict" } });
  });
});
