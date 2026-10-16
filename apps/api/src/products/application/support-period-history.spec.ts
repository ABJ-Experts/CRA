import { ProductUseCases } from "./product-use-cases";

describe("release-scoped support period history", () => {
  const command = {
    organizationId: "org",
    actorId: "actor",
    productId: "product",
    releaseId: "release-a",
  };
  const productPeriod = { id: "product-period", releaseId: null };
  const releasePeriod = { id: "release-period", releaseId: "release-a" };
  const otherPeriod = { id: "other-period", releaseId: "release-b" };
  function harness(outcome = "found") {
    const repository = {
      getRelease: jest.fn().mockResolvedValue({ outcome }),
      getSupportPeriods: jest.fn().mockResolvedValue({
        outcome: "found",
        supportPeriods: [productPeriod, releasePeriod, otherPeriod],
      }),
    };
    return {
      repository,
      useCases: new ProductUseCases(repository as never, {} as never),
    };
  }
  it("validates the release in its tenant/product and includes only that release plus product-wide history", async () => {
    const { repository, useCases } = harness();
    await expect(useCases.getSupportPeriods(command)).resolves.toEqual({
      ok: true,
      value: { supportPeriods: [productPeriod, releasePeriod] },
    });
    expect(repository.getRelease).toHaveBeenCalledWith(
      "org",
      "actor",
      "product",
      "release-a",
    );
    expect(repository.getSupportPeriods).toHaveBeenCalledWith(
      "org",
      "actor",
      "product",
    );
  });
  it("rejects foreign, missing, or wrong-product releases before reading history", async () => {
    const { repository, useCases } = harness("not_found");
    await expect(useCases.getSupportPeriods(command)).resolves.toEqual({
      ok: false,
      error: { code: "not_found" },
    });
    expect(repository.getSupportPeriods).not.toHaveBeenCalled();
  });
  it("preserves unfiltered product history for existing callers", async () => {
    const { repository, useCases } = harness();
    const productCommand = {
      organizationId: command.organizationId,
      actorId: command.actorId,
      productId: command.productId,
    };
    await expect(useCases.getSupportPeriods(productCommand)).resolves.toEqual({
      ok: true,
      value: { supportPeriods: [productPeriod, releasePeriod, otherPeriod] },
    });
    expect(repository.getRelease).not.toHaveBeenCalled();
  });
  it("keeps missing-product history as not found after a valid release lookup", async () => {
    const { repository, useCases } = harness();
    repository.getSupportPeriods.mockResolvedValue({
      outcome: "not_found",
    });
    await expect(useCases.getSupportPeriods(command)).resolves.toEqual({
      ok: false,
      error: { code: "not_found" },
    });
  });
  it("reports support history provider failures without returning partial data", async () => {
    const { repository, useCases } = harness();
    repository.getSupportPeriods.mockRejectedValue(new Error("offline"));
    expect(await useCases.getSupportPeriods(command)).toMatchObject({
      ok: false,
    });
  });
  it("does not read history after a release provider failure", async () => {
    const { repository, useCases } = harness();
    repository.getRelease.mockRejectedValue(new Error("offline"));
    expect(await useCases.getSupportPeriods(command)).toMatchObject({
      ok: false,
    });
    expect(repository.getSupportPeriods).not.toHaveBeenCalled();
  });
});
