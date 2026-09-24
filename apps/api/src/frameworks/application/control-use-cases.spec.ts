/* eslint-disable @typescript-eslint/unbound-method */
import { ControlUseCases, type ControlRepository } from "./control-use-cases";

describe("ControlUseCases", () => {
  const repository = {
    list: jest.fn(),
    ownerCandidates: jest.fn(),
    detail: jest.fn(),
    coverage: jest.fn(),
    command: jest.fn(),
  } as unknown as ControlRepository;
  const useCases = new ControlUseCases(repository);

  it("forwards verified organization and actor scope to the repository", async () => {
    const result = { controls: [], nextCursor: null };
    jest.spyOn(repository, "list").mockResolvedValue(result);
    await expect(
      useCases.list("org-a", {
        actorId: "user-a",
        limit: 50,
        includeArchived: false,
      }),
    ).resolves.toBe(result);
    expect(repository.list).toHaveBeenCalledWith("org-a", {
      actorId: "user-a",
      limit: 50,
      includeArchived: false,
    });
  });

  it("delegates detail, candidates, coverage and commands with explicit scope", async () => {
    const detail = { id: "control-a" } as never;
    const owners = { owners: [], nextCursor: null };
    const coverage = { requirements: [], nextCursor: null } as never;
    const command = { controlId: "control-a", revision: 1 } as never;
    jest.spyOn(repository, "detail").mockResolvedValue(detail);
    jest.spyOn(repository, "ownerCandidates").mockResolvedValue(owners);
    jest.spyOn(repository, "coverage").mockResolvedValue(coverage);
    jest.spyOn(repository, "command").mockResolvedValue(command);
    const detailInput = {
      actorId: "user-a",
      controlId: "control-a",
      canViewEvidence: false,
      canViewProducts: false,
    };
    const ownerInput = { actorId: "user-a", limit: 100 };
    const coverageInput = {
      actorId: "user-a",
      packKey: "cra",
      versionKey: "2024",
      productId: "product-a",
      limit: 100,
    };
    const commandInput = {
      actorId: "user-a",
      operation: "archive_control" as const,
      payload: { controlId: "control-a" },
      expectedRevision: 1,
      idempotencyKey: "key",
    };
    await expect(useCases.detail("org-a", detailInput)).resolves.toBe(detail);
    await expect(useCases.ownerCandidates("org-a", ownerInput)).resolves.toBe(
      owners,
    );
    await expect(useCases.coverage("org-a", coverageInput)).resolves.toBe(
      coverage,
    );
    await expect(useCases.command("org-a", commandInput)).resolves.toBe(
      command,
    );
    expect(repository.detail).toHaveBeenCalledWith("org-a", detailInput);
    expect(repository.ownerCandidates).toHaveBeenCalledWith(
      "org-a",
      ownerInput,
    );
    expect(repository.coverage).toHaveBeenCalledWith("org-a", coverageInput);
    expect(repository.command).toHaveBeenCalledWith("org-a", commandInput);
  });
});
