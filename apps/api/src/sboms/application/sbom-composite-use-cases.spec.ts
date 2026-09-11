import { SbomCompositeUseCases } from "./sbom-composite-use-cases";

const command = {
  organizationId: "org-1",
  actorId: "actor-1",
  productId: "product-1",
  releaseId: "release-1",
  sourceIds: ["source-1"],
  idempotencyKey: "idempotency-key",
};

describe("SbomCompositeUseCases", () => {
  it("preserves a replayed review without changing the result", async () => {
    const response = { review: { id: "review-1" } };
    const repository = {
      validateScope: jest.fn().mockResolvedValue("compatible"),
      createReview: jest
        .fn()
        .mockResolvedValue({ outcome: "replayed", response }),
    };

    const result = await new SbomCompositeUseCases(repository as never).create(
      command,
    );

    expect(result).toEqual({ ok: true, value: response });
    expect(repository.createReview).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({
        actorId: "actor-1",
        sourceIds: ["source-1"],
      }),
    );
    expect(repository.validateScope).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ sourceIds: ["source-1"] }),
    );
  });

  it("does not turn a cross-tenant/missing review into a conflict", async () => {
    const repository = {
      getReview: jest.fn().mockResolvedValue(null),
    };
    const result = await new SbomCompositeUseCases(repository as never).review({
      organizationId: "org-1",
      actorId: "actor-1",
      reviewId: "review-1",
    });
    expect(result).toEqual({ ok: false, error: { code: "not_found" } });
  });

  it("rejects source selections outside the active composite release structure", async () => {
    const repository = {
      validateScope: jest.fn().mockResolvedValue("conflict"),
      createReview: jest.fn(),
    };
    const result = await new SbomCompositeUseCases(repository as never).create(
      command,
    );
    expect(result).toEqual({ ok: false, error: { code: "conflict" } });
    expect(repository.createReview).not.toHaveBeenCalled();
  });

  it("maps unresolved conflicts to a conflict response", async () => {
    const repository = {
      generate: jest.fn().mockResolvedValue({ outcome: "conflict" }),
    };
    const result = await new SbomCompositeUseCases(
      repository as never,
    ).generate({
      organizationId: "org-1",
      actorId: "actor-1",
      reviewId: "review-1",
      idempotencyKey: "key",
    });
    expect(result).toEqual({ ok: false, error: { code: "conflict" } });
  });
});
