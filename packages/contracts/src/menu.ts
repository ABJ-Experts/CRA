/**
 * Navigation keys and their permission mapping.
 *
 * These mirror `apps/web/app/_components/sidebar/nav-config.tsx` exactly.
 */

import type { PermissionKey } from "./permissions.js";

export const MENU_KEYS = [
  "dashboard",
  "management",
  "organization",
  "products",
  "connectors",
  "profile",
  "profile.account",
  "profile.security",
  "authorization",
  "authorization.roles",
  "authorization.permissions",
] as const;

export type MenuKey = (typeof MENU_KEYS)[number];

const MENU_KEY_SET: ReadonlySet<string> = new Set<string>(MENU_KEYS);

export function isMenuKey(value: unknown): value is MenuKey {
  return typeof value === "string" && MENU_KEY_SET.has(value);
}

/**
 * `null` entries stay available during a session/menu outage, so the rail
 * degrades instead of becoming empty. Authorization remains server-side.
 */
export const MENU_PERMISSION_MAP: Readonly<
  Record<MenuKey, PermissionKey | null>
> = {
  dashboard: null,
  management: "can_view_users",
  organization: "can_view_organization",
  products: "can_view_products",
  connectors: "can_view_connectors",
  profile: null,
  "profile.account": null,
  "profile.security": null,
  authorization: null,
  "authorization.roles": "can_view_roles",
  "authorization.permissions": "can_view_roles",
};

/** Group key -> child keys, used to hide an empty group. */
export const MENU_GROUPS: Readonly<
  Partial<Record<MenuKey, readonly MenuKey[]>>
> = {
  profile: ["profile.account", "profile.security"],
  authorization: ["authorization.roles", "authorization.permissions"],
};

export interface MenuVisibilityInput {
  can: (key: PermissionKey) => boolean;
  overrides?: Readonly<Partial<Record<MenuKey, boolean>>>;
}

export function canViewMenu(key: MenuKey, input: MenuVisibilityInput): boolean {
  const override = input.overrides?.[key];
  if (override === false) return false;

  const children = MENU_GROUPS[key];
  if (children && children.length > 0) {
    return children.some((child) => canViewMenu(child, input));
  }

  if (override === true) return true;

  const required = MENU_PERMISSION_MAP[key];
  return required === null || input.can(required);
}

/** Every menu key the current caller may see. */
export function visibleMenuKeys(input: MenuVisibilityInput): MenuKey[] {
  return MENU_KEYS.filter((key) => canViewMenu(key, input));
}
