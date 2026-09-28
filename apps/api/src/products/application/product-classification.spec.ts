import { PRODUCT_CLASSIFICATION_POLICY } from "@repo/contracts/products";
import {
  ProductClassificationUseCases,
  ClassificationFailure,
  type ProductClassificationRepository,
} from "./product-classification";
const input = {
  expectedProductVersion: 1,
  expectedRevision: 0,
  policyVersion: PRODUCT_CLASSIFICATION_POLICY.version,
  policyHash: PRODUCT_CLASSIFICATION_POLICY.hash,
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  answers: {
    scope: "out_of_scope" as const,
    criticalCoreFunction: null,
    classIICoreFunction: null,
    classICoreFunction: null,
  },
  rationale: "Declared exclusion",
};
describe("classification application", () => {
  const save = jest.fn();
  const repository = {
    save,
    history: jest.fn(),
    latest: jest.fn(),
  } as ProductClassificationRepository;
  beforeEach(() => jest.clearAllMocks());
  it("rejects stale policy without writing", async () => {
    await expect(
      new ProductClassificationUseCases(repository).save(
        "org",
        "actor",
        "product",
        { ...input, policyHash: "0".repeat(64) },
      ),
    ).rejects.toEqual(new ClassificationFailure("conflict"));
    expect(save).not.toHaveBeenCalled();
  });
  it("rejects hidden answers without writing", async () => {
    await expect(
      new ProductClassificationUseCases(repository).save(
        "org",
        "actor",
        "product",
        {
          ...input,
          answers: { ...input.answers, criticalCoreFunction: "yes" },
        },
      ),
    ).rejects.toEqual(new ClassificationFailure("invalid_request"));
    expect(save).not.toHaveBeenCalled();
  });
  it("passes verified scope and authoritative policy", async () => {
    save.mockRejectedValue(new ClassificationFailure("forbidden"));
    await expect(
      new ProductClassificationUseCases(repository).save(
        "org",
        "actor",
        "product",
        input,
      ),
    ).rejects.toEqual(new ClassificationFailure("forbidden"));
    expect(save).toHaveBeenCalledWith(
      "org",
      "actor",
      "product",
      input,
      PRODUCT_CLASSIFICATION_POLICY,
    );
  });
  it("returns fixed provisional policy", () =>
    expect(new ProductClassificationUseCases(repository).policy()).toEqual({
      policy: PRODUCT_CLASSIFICATION_POLICY,
    }));
});

describe("classification parsed projections", () => {
  it("rejects policy version mismatch", async () => {
    const save = jest.fn();
    await expect(
      new ProductClassificationUseCases({
        save,
      } as unknown as ProductClassificationRepository).save(
        "org",
        "actor",
        "product",
        { ...input, policyVersion: "other" },
      ),
    ).rejects.toEqual(new ClassificationFailure("conflict"));
    expect(save).not.toHaveBeenCalled();
  });
  it("passes scoped history query and fixed policy", async () => {
    const history = jest.fn().mockResolvedValue({
      latest: null,
      productVersion: 1,
      runs: { rows: [], total: 0, page: 1, pageSize: 15, pageCount: 1 },
    });
    const useCases = new ProductClassificationUseCases({
      history,
    } as unknown as ProductClassificationRepository);
    expect(
      await useCases.history("org", "actor", "product", {
        page: 1,
        pageSize: 15,
      }),
    ).toMatchObject({ policy: PRODUCT_CLASSIFICATION_POLICY, latest: null });
    expect(history).toHaveBeenCalledWith("org", "actor", "product", {
      page: 1,
      pageSize: 15,
    });
  });
  it("passes scoped bulk IDs and parses response", async () => {
    const latest = jest.fn().mockResolvedValue({ classifications: [] });
    const useCases = new ProductClassificationUseCases({
      latest,
    } as unknown as ProductClassificationRepository);
    expect(await useCases.latest("org", "actor", { productIds: [] })).toEqual({
      classifications: [],
    });
    expect(latest).toHaveBeenCalledWith("org", "actor", { productIds: [] });
  });
});
