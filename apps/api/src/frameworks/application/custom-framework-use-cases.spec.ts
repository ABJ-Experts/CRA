import {
  CustomFrameworkUseCases,
  type CustomFrameworkRepository,
} from "./custom-framework-use-cases";

const content = {
  title: "Internal controls",
  editionDate: "2026-09-25",
  language: "en",
  attribution: "Internal team",
  requirements: [
    {
      requirementKey: "control-1",
      identifier: "INT-1",
      parentKey: null,
      position: 1,
      heading: "Design review",
      text: "Document design control decisions.",
      sourceReference: "Policy 1",
    },
  ],
} as const;

describe("CustomFrameworkUseCases", () => {
  it("forwards list, detail, and commands to the repository with verified scope", async () => {
    const list = jest.fn().mockResolvedValue({ items: [], nextOffset: null });
    const detail = jest.fn().mockResolvedValue({ content });
    const command = jest.fn().mockResolvedValue({ revision: 2 });
    const repository = {
      list,
      detail,
      command,
    } as unknown as CustomFrameworkRepository;
    const useCases = new CustomFrameworkUseCases(repository);

    await useCases.list("org-a", "actor-a", 20, 0);
    await useCases.detail("org-a", "actor-a", "draft-a");
    await useCases.command("org-a", "actor-a", "draft-a", {
      action: "publish_version",
      expectedRevision: 1,
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
    });

    expect(list).toHaveBeenCalledWith("org-a", "actor-a", 20, 0);
    expect(detail).toHaveBeenCalledWith("org-a", "actor-a", "draft-a");
    expect(command).toHaveBeenCalledWith("org-a", "actor-a", "draft-a", {
      action: "publish_version",
      expectedRevision: 1,
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("reports exact invalid paths without reaching the SQL validator", async () => {
    const command = jest.fn();
    const validate = jest.fn();
    const repository = {
      command,
      validate,
    } as unknown as CustomFrameworkRepository;
    const useCases = new CustomFrameworkUseCases(repository);
    const result = await useCases.validateImport("org-a", "actor-a", {
      schemaVersion: 1,
      kind: "customer_defined",
      content: {
        ...content,
        requirements: [{ ...content.requirements[0], text: "<img src=x>" }],
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "content.requirements.0.text" }),
      ]),
    );
    expect(command).not.toHaveBeenCalled();
    expect(validate).not.toHaveBeenCalled();
  });

  it("checks valid portable imports against the SQL publication validator", async () => {
    const command = jest.fn();
    const validate = jest.fn().mockResolvedValue({ valid: true, errors: [] });
    const repository = {
      command,
      validate,
    } as unknown as CustomFrameworkRepository;
    const result = await new CustomFrameworkUseCases(repository).validateImport(
      "org-a",
      "actor-a",
      {
        schemaVersion: 1,
        kind: "customer_defined",
        content,
      },
    );

    expect(result).toEqual({ valid: true, errors: [] });
    expect(command).not.toHaveBeenCalled();
    expect(validate).toHaveBeenCalledWith("org-a", "actor-a", content);
  });

  it("reports exact SQL-only validation paths without publishing", async () => {
    const validate = jest.fn().mockResolvedValue({
      valid: false,
      errors: [
        {
          path: "content.requirements.0.parentKey",
          message: "Parent requirement does not exist",
        },
      ],
    });
    const command = jest.fn();
    const useCases = new CustomFrameworkUseCases({
      validate,
      command,
    } as unknown as CustomFrameworkRepository);
    await expect(
      useCases.validateImport("org-a", "actor-a", {
        schemaVersion: 1,
        kind: "customer_defined",
        content,
      }),
    ).resolves.toEqual({
      valid: false,
      errors: [
        {
          path: "content.requirements.0.parentKey",
          message: "Parent requirement does not exist",
        },
      ],
    });
    expect(command).not.toHaveBeenCalled();
  });

  it("exports content without tenant, pack, or mapping identifiers", async () => {
    const repository = {
      detail: jest.fn().mockResolvedValue({
        draftId: "11111111-1111-4111-8111-111111111111",
        packKey: "custom.11111111-1111-4111-8111-111111111111",
        title: content.title,
        status: "published",
        revision: 2,
        latestVersionKey: "v1",
        selectedVersionKey: null,
        contentHash: "a".repeat(64),
        archivedAt: null,
        updatedAt: "2026-09-25T00:00:00Z",
        content,
      }),
    } as unknown as CustomFrameworkRepository;
    const exported = await new CustomFrameworkUseCases(repository).export(
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
      "11111111-1111-4111-8111-111111111111",
    );
    expect(exported).toEqual({
      schemaVersion: 1,
      kind: "customer_defined",
      content,
    });
    expect(JSON.stringify(exported)).not.toContain("custom.11111111");
  });

  it("exports an exact immutable published version when requested", async () => {
    const detail = jest.fn();
    const exportVersion = jest.fn().mockResolvedValue(content);
    const repository = {
      detail,
      exportVersion,
    } as unknown as CustomFrameworkRepository;
    const exported = await new CustomFrameworkUseCases(repository).export(
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
      "11111111-1111-4111-8111-111111111111",
      "v1",
    );
    expect(exportVersion).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
      "11111111-1111-4111-8111-111111111111",
      "v1",
    );
    expect(detail).not.toHaveBeenCalled();
    expect(exported.content).toEqual(content);
  });
});
