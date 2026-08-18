import { describe, expect, it } from "vitest";

import {
  BASE_ROLES,
  DEFAULT_PERMISSIONS_BY_ROLE,
  PERMISSION_KEYS,
  PERMISSION_MATRIX,
  PERMISSION_MODULES,
  coerceBaseRole,
  defaultPermissionsFor,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  isPermissionKey,
  mergeHard,
  mergePermissive,
  normalizePermissions,
  parsePermissionKey,
  resolveEffectivePermissions,
  sanitizePermissions,
  type AssignedCustomRole,
} from "./permissions.js";

function role(over: Partial<AssignedCustomRole> = {}): AssignedCustomRole {
  return {
    id: "role-1",
    name: "Test Role",
    base_role: "member",
    permissions: {},
    is_active: true,
    is_deleted: false,
    ...over,
  };
}

describe("key generation", () => {
  it("generates one key per module/action pair with no duplicates", () => {
    const expected = PERMISSION_MODULES.reduce(
      (n, m) => n + (PERMISSION_MATRIX[m] as readonly string[]).length,
      0,
    );
    expect(PERMISSION_KEYS).toHaveLength(expected);
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
  });

  it("round-trips every key through parsePermissionKey", () => {
    // parsePermissionKey splits on the FIRST underscore after `can_`, which is
    // only correct while no action contains one. This is the assertion that
    // catches the day someone adds `can_bulk_edit_orders`.
    for (const key of PERMISSION_KEYS) {
      const { action, module } = parsePermissionKey(key);
      expect(`can_${action}_${module}`).toBe(key);
      expect(PERMISSION_MODULES).toContain(module);
    }
  });

  it("rejects unknown keys", () => {
    expect(isPermissionKey("can_view_orders")).toBe(true);
    expect(isPermissionKey("can_view_spaces")).toBe(false);
    expect(isPermissionKey("can_launch_missiles")).toBe(false);
    expect(isPermissionKey(null)).toBe(false);
  });
});

describe("hasPermission", () => {
  it("treats undefined and false alike as denial", () => {
    const set = { can_view_orders: true, can_edit_orders: false } as const;
    expect(hasPermission(set, "can_view_orders")).toBe(true);
    expect(hasPermission(set, "can_edit_orders")).toBe(false);
    expect(hasPermission(set, "can_delete_orders")).toBe(false);
  });

  it("supports all/any", () => {
    const set = { can_view_orders: true } as const;
    expect(hasAllPermissions(set, ["can_view_orders"])).toBe(true);
    expect(hasAllPermissions(set, ["can_view_orders", "can_edit_orders"])).toBe(
      false,
    );
    expect(hasAnyPermission(set, ["can_view_orders", "can_edit_orders"])).toBe(
      true,
    );
    expect(hasAnyPermission(set, ["can_edit_orders"])).toBe(false);
    expect(hasAnyPermission(set, [])).toBe(false);
    expect(hasAllPermissions(set, [])).toBe(true);
  });
});

describe("sanitizePermissions", () => {
  it("drops stale, non-boolean and non-object input", () => {
    expect(
      sanitizePermissions({
        can_view_orders: true,
        can_view_spaces: true, // module deleted from the code
        can_edit_orders: "yes", // wrong type
      }),
    ).toEqual({ can_view_orders: true });

    expect(sanitizePermissions(null)).toEqual({});
    expect(sanitizePermissions(undefined)).toEqual({});
    expect(sanitizePermissions([1, 2])).toEqual({});
    expect(sanitizePermissions("nope")).toEqual({});
  });
});

describe("merges", () => {
  it("mergeHard lets an explicit false win", () => {
    expect(
      mergeHard({ can_view_orders: true }, { can_view_orders: false }),
    ).toEqual({
      can_view_orders: false,
    });
  });

  it("mergePermissive never revokes an existing grant", () => {
    expect(
      mergePermissive({ can_view_orders: true }, { can_view_orders: false }),
    ).toEqual({
      can_view_orders: true,
    });
  });

  it("mergePermissive still records a false the base never mentioned", () => {
    expect(mergePermissive({}, { can_view_orders: false })).toEqual({
      can_view_orders: false,
    });
  });
});

describe("normalizePermissions", () => {
  it("grants view for any acting permission", () => {
    const out = normalizePermissions({ can_delete_orders: true });
    expect(hasPermission(out, "can_view_orders")).toBe(true);
  });

  it("does not invent permissions for a denied action", () => {
    const out = normalizePermissions({ can_delete_orders: false });
    expect(hasPermission(out, "can_view_orders")).toBe(false);
  });

  it("never clears an explicit false", () => {
    const out = normalizePermissions({
      can_view_orders: false,
      can_export_orders: false,
    });
    expect(out.can_view_orders).toBe(false);
  });
});

describe("presets", () => {
  it("adds product approval only for owners and admins", () => {
    expect(PERMISSION_MATRIX.products).toContain("approve");
    expect(isPermissionKey("can_approve_products")).toBe(true);
    expect(
      hasPermission(DEFAULT_PERMISSIONS_BY_ROLE.owner, "can_approve_products"),
    ).toBe(true);
    expect(
      hasPermission(DEFAULT_PERMISSIONS_BY_ROLE.admin, "can_approve_products"),
    ).toBe(true);
    expect(
      hasPermission(DEFAULT_PERMISSIONS_BY_ROLE.member, "can_approve_products"),
    ).toBe(false);
    expect(
      hasPermission(DEFAULT_PERMISSIONS_BY_ROLE.viewer, "can_approve_products"),
    ).toBe(false);
  });

  it("owner has every permission", () => {
    for (const key of PERMISSION_KEYS) {
      expect(hasPermission(DEFAULT_PERMISSIONS_BY_ROLE.owner, key)).toBe(true);
    }
  });

  it("reserves organization export and deletion for owners", () => {
    expect(
      hasPermission(
        DEFAULT_PERMISSIONS_BY_ROLE.owner,
        "can_export_organization",
      ),
    ).toBe(true);
    expect(
      hasPermission(
        DEFAULT_PERMISSIONS_BY_ROLE.owner,
        "can_delete_organization",
      ),
    ).toBe(true);
    for (const baseRole of ["admin", "member", "viewer"] as const) {
      expect(
        hasPermission(
          DEFAULT_PERMISSIONS_BY_ROLE[baseRole],
          "can_export_organization",
        ),
      ).toBe(false);
      expect(
        hasPermission(
          DEFAULT_PERMISSIONS_BY_ROLE[baseRole],
          "can_delete_organization",
        ),
      ).toBe(false);
    }
  });

  it("keeps custom-role permission merging additive, so destructive routes must also require owner", () => {
    const out = resolveEffectivePermissions({
      baseRole: "viewer",
      customRoles: [role({ permissions: { can_delete_organization: true } })],
    });
    expect(hasPermission(out, "can_delete_organization")).toBe(true);
  });

  it("admin has everything except organization editing", () => {
    expect(
      hasPermission(DEFAULT_PERMISSIONS_BY_ROLE.admin, "can_edit_organization"),
    ).toBe(false);
    expect(
      hasPermission(DEFAULT_PERMISSIONS_BY_ROLE.admin, "can_delete_users"),
    ).toBe(true);
    expect(
      hasPermission(DEFAULT_PERMISSIONS_BY_ROLE.admin, "can_view_audit"),
    ).toBe(true);
  });

  it("member can operate but not administer or delete", () => {
    const member = DEFAULT_PERMISSIONS_BY_ROLE.member;
    expect(hasPermission(member, "can_create_orders")).toBe(true);
    expect(hasPermission(member, "can_edit_orders")).toBe(true);
    expect(hasPermission(member, "can_delete_orders")).toBe(false);
    expect(hasPermission(member, "can_view_users")).toBe(false);
    expect(hasPermission(member, "can_view_roles")).toBe(false);
  });

  it("viewer can only read, and cannot see administration surfaces", () => {
    const viewer = DEFAULT_PERMISSIONS_BY_ROLE.viewer;
    expect(hasPermission(viewer, "can_view_orders")).toBe(true);
    expect(hasPermission(viewer, "can_create_orders")).toBe(false);
    expect(hasPermission(viewer, "can_view_users")).toBe(false);
    expect(hasPermission(viewer, "can_view_audit")).toBe(false);
    for (const key of PERMISSION_KEYS) {
      if (key.startsWith("can_view_")) continue;
      expect(hasPermission(viewer, key)).toBe(false);
    }
  });

  it("defaults finding read access to every live role, but finding changes to owner and admin", () => {
    for (const baseRole of BASE_ROLES) {
      expect(
        hasPermission(
          DEFAULT_PERMISSIONS_BY_ROLE[baseRole],
          "can_view_findings",
        ),
      ).toBe(true);
    }
    for (const baseRole of ["owner", "admin"] as const) {
      expect(
        hasPermission(
          DEFAULT_PERMISSIONS_BY_ROLE[baseRole],
          "can_edit_findings",
        ),
      ).toBe(true);
    }
    for (const baseRole of ["member", "viewer"] as const) {
      expect(
        hasPermission(
          DEFAULT_PERMISSIONS_BY_ROLE[baseRole],
          "can_edit_findings",
        ),
      ).toBe(false);
    }
  });

  it("privilege is monotonic across the base roles", () => {
    const granted = (r: (typeof BASE_ROLES)[number]) =>
      PERMISSION_KEYS.filter((k) =>
        hasPermission(DEFAULT_PERMISSIONS_BY_ROLE[r], k),
      ).length;
    expect(granted("owner")).toBeGreaterThan(granted("admin"));
    expect(granted("admin")).toBeGreaterThan(granted("member"));
    expect(granted("member")).toBeGreaterThan(granted("viewer"));
  });

  it("returns a defensive copy so a caller cannot poison the preset", () => {
    const set = defaultPermissionsFor("viewer");
    set.can_delete_users = true;
    expect(
      hasPermission(DEFAULT_PERMISSIONS_BY_ROLE.viewer, "can_delete_users"),
    ).toBe(false);
  });
});

describe("coerceBaseRole", () => {
  it("downgrades anything unrecognized to viewer rather than escalating", () => {
    expect(coerceBaseRole("owner")).toBe("owner");
    expect(coerceBaseRole("superadmin")).toBe("viewer");
    expect(coerceBaseRole(undefined)).toBe("viewer");
    expect(coerceBaseRole(null)).toBe("viewer");
    expect(coerceBaseRole(42)).toBe("viewer");
  });
});

describe("resolveEffectivePermissions", () => {
  it("starts from the base role", () => {
    const out = resolveEffectivePermissions({ baseRole: "viewer" });
    expect(hasPermission(out, "can_view_orders")).toBe(true);
    expect(hasPermission(out, "can_delete_orders")).toBe(false);
  });

  it("adds custom role permissions", () => {
    const out = resolveEffectivePermissions({
      baseRole: "viewer",
      customRoles: [role({ permissions: { can_export_orders: true } })],
    });
    expect(hasPermission(out, "can_export_orders")).toBe(true);
  });

  it("ignores inactive and soft-deleted roles", () => {
    const out = resolveEffectivePermissions({
      baseRole: "viewer",
      customRoles: [
        role({
          id: "a",
          is_active: false,
          permissions: { can_delete_users: true },
        }),
        role({
          id: "b",
          is_deleted: true,
          permissions: { can_delete_orders: true },
        }),
      ],
    });
    expect(hasPermission(out, "can_delete_users")).toBe(false);
    expect(hasPermission(out, "can_delete_orders")).toBe(false);
  });

  it("a custom role cannot revoke what the base role granted", () => {
    const out = resolveEffectivePermissions({
      baseRole: "member",
      customRoles: [role({ permissions: { can_view_orders: false } })],
    });
    expect(hasPermission(out, "can_view_orders")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Privilege-escalation regressions. Both of these are live holes in the
  // reference implementation; they are the reason this file exists.
  // -------------------------------------------------------------------------

  it("REGRESSION: an organization override is the last word, even with a custom role assigned", () => {
    // Reference bug: overrides are applied BEFORE custom roles, and each custom
    // role re-merges DEFAULT_PERMISSIONS_BY_ROLE[role.base_role]. So an org that
    // revokes can_delete_users from admin has the revocation silently undone the
    // moment the user is given any custom role declaring base_role 'admin'.
    const out = resolveEffectivePermissions({
      baseRole: "admin",
      baseRoleOverrides: { can_delete_users: false },
      customRoles: [
        role({ base_role: "admin", permissions: { can_view_users: true } }),
      ],
    });
    expect(hasPermission(out, "can_delete_users")).toBe(false);
    expect(hasPermission(out, "can_view_users")).toBe(true);
  });

  it("REGRESSION: a custom role's base_role is a label, not a grant", () => {
    // Reference bug: a role carrying one harmless permission but declaring
    // base_role 'owner' merges the entire owner preset into the user.
    const out = resolveEffectivePermissions({
      baseRole: "viewer",
      customRoles: [
        role({ base_role: "owner", permissions: { can_export_orders: true } }),
      ],
    });
    expect(hasPermission(out, "can_export_orders")).toBe(true);
    expect(hasPermission(out, "can_delete_users")).toBe(false);
    expect(hasPermission(out, "can_edit_organization")).toBe(false);
  });

  it("REGRESSION: a stale jsonb key cannot grant anything", () => {
    const out = resolveEffectivePermissions({
      baseRole: "viewer",
      customRoles: [
        role({
          permissions: { can_view_spaces: true, can_admin_everything: true },
        }),
      ],
    });
    expect((out as Record<string, unknown>).can_view_spaces).toBeUndefined();
    expect(
      (out as Record<string, unknown>).can_admin_everything,
    ).toBeUndefined();
  });

  it("an override that revokes view survives an implication that would restore it", () => {
    // export implies view; the override must still win because it is applied last.
    const out = resolveEffectivePermissions({
      baseRole: "member",
      baseRoleOverrides: { can_view_orders: false },
    });
    expect(hasPermission(out, "can_view_orders")).toBe(false);
  });

  it("applies implications from a custom role's grant", () => {
    const out = resolveEffectivePermissions({
      baseRole: "viewer",
      customRoles: [role({ permissions: { can_delete_users: true } })],
    });
    // viewer cannot see users, but a role that can delete them must be able to.
    expect(hasPermission(out, "can_view_users")).toBe(true);
  });

  it("is deterministic regardless of custom role order", () => {
    const a = role({ id: "a", permissions: { can_export_orders: true } });
    const b = role({ id: "b", permissions: { can_view_users: true } });
    const forward = resolveEffectivePermissions({
      baseRole: "viewer",
      customRoles: [a, b],
    });
    const reverse = resolveEffectivePermissions({
      baseRole: "viewer",
      customRoles: [b, a],
    });
    expect(forward).toEqual(reverse);
  });

  it("an unknown base role resolves to viewer, not to owner", () => {
    const out = resolveEffectivePermissions({
      baseRole: "root" as unknown as (typeof BASE_ROLES)[number],
    });
    expect(out).toEqual(resolveEffectivePermissions({ baseRole: "viewer" }));
  });

  it("tolerates a null permissions blob", () => {
    const out = resolveEffectivePermissions({
      baseRole: "viewer",
      customRoles: [role({ permissions: null })],
      baseRoleOverrides: null,
    });
    expect(hasPermission(out, "can_view_orders")).toBe(true);
  });

  it("never emits a key outside the known set", () => {
    const out = resolveEffectivePermissions({
      baseRole: "owner",
      customRoles: [role({ permissions: { nonsense: true } })],
      baseRoleOverrides: { garbage: true },
    });
    for (const key of Object.keys(out)) {
      expect(isPermissionKey(key)).toBe(true);
    }
  });
});
