import type { AssignedCustomRole, BaseRole } from "@repo/contracts/permissions";

import type {
  PermissionDataPort,
  PermissionResolver,
} from "./permission-data.port";

export interface ResolverContractHarness {
  readonly data: PermissionDataPort;
  readonly resolver: PermissionResolver;
}

const assignedRoles: readonly AssignedCustomRole[] = [
  {
    id: "custom-role",
    name: "Exporters",
    base_role: "owner",
    permissions: {
      can_delete_users: true,
      can_edit_organization: false,
    },
    is_active: true,
    is_deleted: false,
  },
];

export function permissionResolverContract(
  name: string,
  createHarness: () => ResolverContractHarness,
): void {
  describe(`${name} permission resolver contract`, () => {
    it("preserves the frozen merge and menu-rule precedence", async () => {
      const { resolver } = createHarness();

      const resolved = await resolver.resolve("org-a", "user-a", "viewer");

      expect(resolved.permissions).toMatchObject({
        can_delete_users: true,
        can_view_users: false,
        can_edit_organization: false,
      });
      expect(resolved.menuOverrides).toEqual({ management: false });
    });

    it("returns immutable state that callers cannot poison", async () => {
      const { resolver } = createHarness();
      const first = await resolver.resolve("org-a", "user-a", "viewer");

      expect(Object.isFrozen(first)).toBe(true);
      expect(Object.isFrozen(first.permissions)).toBe(true);
      expect(Object.isFrozen(first.menuOverrides)).toBe(true);
      expect(() => {
        (first.permissions as Record<string, boolean>).can_delete_users = false;
      }).toThrow(TypeError);
      expect(() => {
        (first.menuOverrides as Record<string, boolean>).management = true;
      }).toThrow(TypeError);

      await expect(
        resolver.resolve("org-a", "user-a", "viewer"),
      ).resolves.toMatchObject({
        permissions: { can_delete_users: true, can_view_users: false },
        menuOverrides: { management: false },
      });
    });
  });
}

export function permissionData(
  overrides: Partial<PermissionDataPort> = {},
): PermissionDataPort {
  return {
    version: jest.fn().mockResolvedValue(7),
    assignedRoles: jest.fn().mockResolvedValue(assignedRoles),
    baseRoleOverrides: jest
      .fn()
      .mockImplementation((_orgId, baseRole) =>
        Promise.resolve(baseRole === "viewer" ? { can_view_users: false } : {}),
      ),
    menuRules: jest.fn().mockResolvedValue({ management: false }),
    ...overrides,
  };
}

export function role(value: BaseRole = "viewer"): BaseRole {
  return value;
}
