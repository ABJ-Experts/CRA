import { UpgradeUseCases, type UpgradeRepository } from "./upgrade-use-cases";

describe("UpgradeUseCases tenant boundary", () => {
  const repository = {
    crosswalks: jest.fn(),
    preview: jest.fn(),
    createReview: jest.fn(),
    review: jest.fn(),
    decide: jest.fn(),
    commit: jest.fn(),
    evidenceReuse: jest.fn(),
  } as unknown as UpgradeRepository;
  const useCases = new UpgradeUseCases(repository);

  beforeEach(() => jest.clearAllMocks());

  it("never substitutes organization or actor across the reviewed workflow", async () => {
    const scope = { actorId: "verified-actor", packKey: "cra" };
    const calls = [
      ["crosswalks", { ...scope, versionKey: "2024", limit: 10 }],
      ["preview", { ...scope, targetVersionKey: "2025", limit: 10 }],
      [
        "createReview",
        {
          ...scope,
          targetVersionKey: "2025",
          expectedSelectionRevision: 1,
          idempotencyKey: "key",
        },
      ],
      ["review", { ...scope, reviewId: "review", limit: 10 }],
      [
        "decide",
        {
          ...scope,
          reviewId: "review",
          mappingId: "mapping",
          action: "leave_gap",
          targetRequirementKeys: [],
          expectedReviewRevision: 1,
          idempotencyKey: "key",
        },
      ],
      [
        "commit",
        {
          ...scope,
          reviewId: "review",
          expectedReviewRevision: 1,
          idempotencyKey: "key",
        },
      ],
      [
        "evidenceReuse",
        {
          actorId: "verified-actor",
          evidenceVersionId: "evidence",
          productId: "product",
          limit: 10,
        },
      ],
    ] as const;
    for (const [name, input] of calls) {
      const method = Reflect.get(repository, name) as jest.Mock;
      method.mockResolvedValueOnce({ ok: true });
      await expect(
        useCases[name]("verified-org", input as never),
      ).resolves.toEqual({ ok: true });
      expect(method).toHaveBeenCalledWith("verified-org", input);
    }
  });
});
