import {
  FrameworkUseCases,
  type FrameworkRepository,
} from "./framework-use-cases";

describe("FrameworkUseCases", () => {
  const catalog = jest.fn();
  const tree = jest.fn();
  const select = jest.fn();
  const repository = {
    catalog,
    tree,
    select,
  } as unknown as FrameworkRepository;
  const useCases = new FrameworkUseCases(repository);

  beforeEach(() => jest.clearAllMocks());

  it("carries the verified organization to catalog and tree reads", async () => {
    catalog.mockResolvedValue({ packs: [] });
    tree.mockResolvedValue({
      packKey: "cra",
      versionKey: "2024",
      requirements: [],
      nextCursor: null,
    });
    await useCases.catalog("org-a", "user-a");
    await useCases.tree("org-a", {
      actorId: "user-a",
      packKey: "cra",
      versionKey: "2024",
      limit: 100,
    });
    expect(catalog).toHaveBeenCalledWith("org-a", "user-a", { limit: 100 });
    expect(tree).toHaveBeenCalledWith("org-a", {
      actorId: "user-a",
      packKey: "cra",
      versionKey: "2024",
      limit: 100,
    });
  });

  it("carries actor and expected revision to the atomic selection", async () => {
    select.mockResolvedValue({
      packKey: "cra",
      versionKey: "2024",
      enabled: true,
      revision: 1,
    });
    const input = {
      actorId: "user-a",
      packKey: "cra",
      versionKey: "2024",
      enabled: true,
      expectedRevision: null,
      idempotencyKey: "2f564a90-a9ef-46e9-afd8-b743866860ff",
    };
    await useCases.select("org-a", input);
    expect(select).toHaveBeenCalledWith("org-a", input);
  });
});
