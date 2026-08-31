import { describe, expect, it } from "vitest";

import {
  MENU_GROUPS,
  MENU_KEYS,
  MENU_PERMISSION_MAP,
  canViewMenu,
  isMenuKey,
  visibleMenuKeys,
  type MenuKey,
} from "./menu.js";
import {
  DEFAULT_PERMISSIONS_BY_ROLE,
  hasPermission,
  isPermissionKey,
  type BaseRole,
} from "./permissions.js";

function canFor(baseRole: BaseRole) {
  const set = DEFAULT_PERMISSIONS_BY_ROLE[baseRole];
  return (key: Parameters<typeof hasPermission>[1]) => hasPermission(set, key);
}

describe("menu keys", () => {
  it("has no duplicates", () => {
    expect(new Set(MENU_KEYS).size).toBe(MENU_KEYS.length);
  });

  it("maps every key exactly once", () => {
    expect(Object.keys(MENU_PERMISSION_MAP).sort()).toEqual(
      [...MENU_KEYS].sort(),
    );
  });

  it("only maps to live permission keys", () => {
    for (const value of Object.values(MENU_PERMISSION_MAP)) {
      if (value !== null) expect(isPermissionKey(value)).toBe(true);
    }
  });

  it("group children are all real menu keys, and groups are not their own child", () => {
    for (const [group, children] of Object.entries(MENU_GROUPS)) {
      expect(isMenuKey(group)).toBe(true);
      for (const child of children ?? []) {
        expect(isMenuKey(child)).toBe(true);
        expect(child).not.toBe(group);
      }
    }
  });

  it("every dotted key belongs to its declared group", () => {
    const claimed = new Set(
      Object.values(MENU_GROUPS).flatMap((c) => [...(c ?? [])]),
    );
    for (const key of MENU_KEYS) {
      if (key.includes(".")) expect(claimed.has(key)).toBe(true);
    }
  });
});

describe("canViewMenu", () => {
  const can = canFor("viewer");

  it("always shows unmapped entries so a failed session cannot empty the rail", () => {
    for (const key of [
      "dashboard",
      "profile.account",
    ] as MenuKey[]) {
      expect(canViewMenu(key, { can: () => false })).toBe(true);
    }
  });

  it("gates a mapped entry on its permission", () => {
    expect(canViewMenu("management", { can })).toBe(false);
    expect(canViewMenu("authorization.roles", { can })).toBe(false);
    expect(canViewMenu("organization", { can })).toBe(true);
    expect(canViewMenu("organization", { can: () => false })).toBe(false);
  });

  it("hides a group when every child is hidden", () => {
    expect(canViewMenu("authorization", { can: () => false })).toBe(false);
  });

  it("an explicit override of false hides an entry the permission would allow", () => {
    expect(
      canViewMenu("organization", {
        can,
        overrides: { organization: false },
      }),
    ).toBe(false);
  });

  it("an override of false on a group hides it even when children are visible", () => {
    expect(
      canViewMenu("authorization", {
        can: () => true,
        overrides: { authorization: false },
      }),
    ).toBe(false);
  });

  it("an override of true reveals an entry the permission would deny", () => {
    expect(
      canViewMenu("management", { can, overrides: { management: true } }),
    ).toBe(true);
  });
});

describe("visibleMenuKeys", () => {
  it("an owner sees everything", () => {
    expect(visibleMenuKeys({ can: canFor("owner") })).toEqual([...MENU_KEYS]);
  });

  it("a viewer never sees the authorization section", () => {
    const visible = visibleMenuKeys({ can: canFor("viewer") });
    expect(visible).not.toContain("authorization");
    expect(visible).not.toContain("authorization.roles");
    expect(visible).not.toContain("management");
    // ...but keeps the always-on entries.
    expect(visible).toContain("dashboard");
    expect(visible).toContain("profile.account");
  });

  it("an admin sees the authorization section", () => {
    const visible = visibleMenuKeys({ can: canFor("admin") });
    expect(visible).toContain("authorization");
    expect(visible).toContain("authorization.roles");
    expect(visible).toContain("management");
  });

  it("a user with no permissions at all still gets a usable rail", () => {
    const visible = visibleMenuKeys({ can: () => false });
    expect(visible.length).toBeGreaterThan(0);
    expect(visible).toContain("dashboard");
  });
});
