import { describe, expect, it } from "vitest";
import {
  MENU_GROUPS,
  MENU_KEYS,
  MENU_PERMISSION_MAP,
  type MenuKey,
} from "@repo/contracts/menu";

import { NAV, type NavItem } from "./nav-config";

/**
 * The sidebar and the RBAC contract must describe the same tree.
 *
 * These assertions fail in BOTH directions on purpose. A nav entry with no
 * contract key is an item nobody can ever be granted; a contract key with no nav
 * entry is a `menu_permissions` row that gates nothing, which is worse — it
 * reads in the admin UI as a working control.
 */

const items: NavItem[] = NAV.flatMap((section) => section.items);
const navKeys: MenuKey[] = items.flatMap((item) => [
  item.menuKey,
  ...(item.children ?? []).map((child) => child.menuKey),
]);

describe("menu key parity", () => {
  it("every nav entry declares a key that exists in the contract", () => {
    for (const key of navKeys) expect(MENU_KEYS).toContain(key);
  });

  it("every contract key is reachable from the nav", () => {
    expect([...navKeys].sort()).toEqual([...MENU_KEYS].sort());
  });

  it("no key is used twice", () => {
    expect(new Set(navKeys).size).toBe(navKeys.length);
  });

  it("every nav entry has a permission mapping declared", () => {
    // `null` is a valid, deliberate mapping (always visible). What must never
    // happen is a key absent from the record entirely.
    for (const key of navKeys) {
      expect(
        Object.prototype.hasOwnProperty.call(MENU_PERMISSION_MAP, key),
      ).toBe(true);
    }
  });

  it("the contract's groups match the nav's parent/child structure", () => {
    for (const item of items) {
      const children = (item.children ?? []).map((c) => c.menuKey);
      if (children.length === 0) {
        expect(MENU_GROUPS[item.menuKey]).toBeUndefined();
      } else {
        expect(MENU_GROUPS[item.menuKey]).toEqual(children);
      }
    }
  });

  it("every leaf has an href and every group does not", () => {
    for (const item of items) {
      if (item.children && item.children.length > 0) {
        expect(item.href).toBeUndefined();
      } else {
        expect(typeof item.href).toBe("string");
      }
    }
  });
});
