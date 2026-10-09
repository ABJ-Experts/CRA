import { SbomDiffUseCases } from "./sbom-diff-use-cases";

const organizationId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const sourceId = "00000000-0000-4000-8000-000000000003";
const baselineSourceId = "00000000-0000-4000-8000-000000000004";

describe("SbomDiffUseCases", () => {
  it("uses the verified organization for a read-only lineage lookup", async () => {
    const response = {
      status: "no_comparable_version" as const,
      sourceId,
      reason: "No predecessor exists.",
    };
    const repository = { getSourceDiff: jest.fn().mockResolvedValue(response) };

    await expect(
      new SbomDiffUseCases(repository as never).sourceDiff({
        organizationId,
        actorId,
        sourceId,
        baseSourceId: baselineSourceId,
      }),
    ).resolves.toEqual({ ok: true, value: response });
    expect(repository.getSourceDiff).toHaveBeenCalledWith(organizationId, {
      actorId,
      sourceId,
      baseSourceId: baselineSourceId,
    });
  });

  it("returns an indistinguishable not-found response for unavailable source diffs", async () => {
    const repository = { getSourceDiff: jest.fn().mockResolvedValue(null) };

    await expect(
      new SbomDiffUseCases(repository as never).sourceDiff({
        organizationId,
        actorId,
        sourceId,
      }),
    ).resolves.toEqual({ ok: false, error: { code: "not_found" } });
  });

  it("does not turn unavailable ecosystem ordering into a guessed upgrade", async () => {
    const repository = {
      createDiff: jest.fn().mockResolvedValue({
        outcome: "created",
        response: {
          status: "queued",
          replayed: false,
          report: { comparisonStatus: "partial_integration_unavailable" },
        },
      }),
    };

    await expect(
      new SbomDiffUseCases(repository as never).create({
        organizationId,
        actorId,
        sourceId,
        idempotencyKey: "00000000-0000-4000-8000-000000000005",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        report: { comparisonStatus: "partial_integration_unavailable" },
      },
    });
  });
});
