import { ConnectorAuthorizationAdapter } from "./connector-authorization.adapter";

describe("ConnectorAuthorizationAdapter", () => {
  it("rejects role and permission changes during permission resolution", async () => {
    const versions = [1, 2];
    const repository = {
      actor: jest
        .fn()
        .mockResolvedValue({ role: "owner", permissionVersion: 1 }),
      permissionVersion: jest.fn().mockImplementation(() => versions.shift()),
    };
    const permissions = {
      effectivePermissions: jest
        .fn()
        .mockResolvedValue({ can_edit_connectors: true }),
    };
    const adapter = new ConnectorAuthorizationAdapter(repository, permissions);
    await expect(
      adapter.authorize("org", "actor", ["can_edit_connectors"]),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("denies non-owners even when a custom role grants editing", async () => {
    const repository = {
      actor: jest
        .fn()
        .mockResolvedValue({ role: "admin", permissionVersion: 1 }),
      permissionVersion: jest.fn().mockResolvedValue(1),
    };
    const permissions = {
      effectivePermissions: jest
        .fn()
        .mockResolvedValue({ can_edit_connectors: true }),
    };
    const adapter = new ConnectorAuthorizationAdapter(repository, permissions);
    await expect(
      adapter.authorize("org", "actor", ["can_edit_connectors"], true),
    ).rejects.toMatchObject({ code: "forbidden_by_policy" });
  });
});

describe("ConnectorAuthorizationAdapter effective permissions", () => {
  it("returns a fenced owner identity scoped to the requested organization", async () => {
    const repo = {
      actor: jest.fn().mockResolvedValue({ role: "owner" }),
      permissionVersion: jest.fn().mockResolvedValue(3),
    };
    const permissions = {
      effectivePermissions: jest
        .fn()
        .mockResolvedValue({ can_edit_connectors: true }),
    };
    const adapter = new ConnectorAuthorizationAdapter(repo, permissions);
    await expect(
      adapter.authorize("org", "actor", ["can_edit_connectors"], true),
    ).resolves.toEqual({
      organizationId: "org",
      actorId: "actor",
      role: "owner",
      permissionVersion: 3,
    });
    expect(permissions.effectivePermissions).toHaveBeenCalledWith(
      "org",
      "actor",
      "owner",
    );
  });
  it("rejects a hard permission override even for an owner", async () => {
    const repo = {
      actor: jest.fn().mockResolvedValue({ role: "owner" }),
      permissionVersion: jest.fn().mockResolvedValue(3),
    };
    const adapter = new ConnectorAuthorizationAdapter(repo, {
      effectivePermissions: jest
        .fn()
        .mockResolvedValue({ can_edit_connectors: false }),
    });
    await expect(
      adapter.authorize("org", "actor", ["can_edit_connectors"]),
    ).rejects.toMatchObject({ code: "forbidden_by_policy" });
  });
});
