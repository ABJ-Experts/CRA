/**
 * Navigation keys and their permission mapping.
 *
 * These mirror `apps/web/app/_components/sidebar/nav-config.tsx` exactly, item
 * for item. `menu_permissions` rows are keyed by `MenuKey`, so a typo here is a
 * nav entry that can never be granted — `menu-nav-parity.spec.ts` asserts the
 * two lists stay identical in both directions.
 */

import type { PermissionKey } from "./permissions.js";

export const MENU_KEYS = [
  // Dashboards
  "dashboard",
  "dashboard.ecommerce",
  "dashboard.analytics",
  "dashboard.crypto",
  "dashboard.project",
  // Tables
  "tables",
  "tables.basic",
  "tables.striped",
  "tables.bordered",
  "tables.splitted",
  // Standalone
  "messages",
  "email",
  // E-commerce
  "ecommerce",
  "ecommerce.products",
  "ecommerce.orders",
  // Finance
  "finance",
  "finance.invoices",
  // Logistic
  "logistic",
  "logistic.fleet",
  "logistic.routes",
  // Standalone
  "management",
  "organization",
  "calendar",
  "help",
  "files",
  // Admin Authorization
  "profile",
  "profile.account",
  "profile.security",
  "authorization",
  "authorization.roles",
  "authorization.permissions",
  "docs",
] as const;

export type MenuKey = (typeof MENU_KEYS)[number];

const MENU_KEY_SET: ReadonlySet<string> = new Set<string>(MENU_KEYS);

export function isMenuKey(value: unknown): value is MenuKey {
  return typeof value === "string" && MENU_KEY_SET.has(value);
}

/**
 * The permission that gates each nav entry, or `null` when the entry is
 * unconditionally visible.
 *
 * `null` is not laziness — it is the failure-safety valve. If every item were
 * gated, a session query that errors would empty the entire sidebar and the app
 * would look broken rather than degraded. Dashboard, the table skins, the
 * user's own profile, help and docs are always reachable.
 *
 * Group rows (`ecommerce`, `finance`, `logistic`, `authorization`) map to
 * `null` and are instead resolved from their children by `canViewMenu` — a
 * group with no visible children hides itself.
 */
export const MENU_PERMISSION_MAP: Readonly<
  Record<MenuKey, PermissionKey | null>
> = {
  dashboard: null,
  "dashboard.ecommerce": null,
  "dashboard.analytics": "can_view_analytics",
  "dashboard.crypto": null,
  "dashboard.project": null,

  tables: null,
  "tables.basic": null,
  "tables.striped": null,
  "tables.bordered": null,
  "tables.splitted": null,

  messages: "can_view_messages",
  email: "can_view_email",

  ecommerce: null,
  "ecommerce.products": "can_view_products",
  "ecommerce.orders": "can_view_orders",

  finance: null,
  "finance.invoices": "can_view_invoices",

  logistic: null,
  "logistic.fleet": "can_view_fleet",
  "logistic.routes": "can_view_routes",

  management: "can_view_users",
  organization: "can_view_organization",
  calendar: "can_view_calendar",
  help: null,
  files: "can_view_files",

  profile: null,
  "profile.account": null,
  "profile.security": null,

  authorization: null,
  "authorization.roles": "can_view_roles",
  "authorization.permissions": "can_view_roles",

  docs: null,
};

/** Group key -> its child keys, for the "hide an empty group" rule. */
export const MENU_GROUPS: Readonly<
  Partial<Record<MenuKey, readonly MenuKey[]>>
> = {
  dashboard: [
    "dashboard.ecommerce",
    "dashboard.analytics",
    "dashboard.crypto",
    "dashboard.project",
  ],
  tables: [
    "tables.basic",
    "tables.striped",
    "tables.bordered",
    "tables.splitted",
  ],
  ecommerce: ["ecommerce.products", "ecommerce.orders"],
  finance: ["finance.invoices"],
  logistic: ["logistic.fleet", "logistic.routes"],
  profile: ["profile.account", "profile.security"],
  authorization: ["authorization.roles", "authorization.permissions"],
};

export interface MenuVisibilityInput {
  /** Effective permission check, usually `(k) => hasPermission(set, k)`. */
  can: (key: PermissionKey) => boolean;
  /**
   * Explicit `menu_permissions` rows, keyed by menu key. An entry of `false`
   * hides the item even when the underlying permission is granted, which is
   * how an organization hides a module it does not use without stripping the
   * permissions that other surfaces depend on.
   */
  overrides?: Readonly<Partial<Record<MenuKey, boolean>>>;
}

/**
 * Whether a nav entry should render.
 *
 * A group is visible when any child is visible, regardless of its own mapping —
 * otherwise a user with `can_view_orders` but not `can_view_products` would see
 * an E-commerce group that expands to a single item, or worse, no group at all.
 */
export function canViewMenu(key: MenuKey, input: MenuVisibilityInput): boolean {
  const override = input.overrides?.[key];
  if (override === false) return false;

  const children = MENU_GROUPS[key];
  if (children && children.length > 0) {
    return children.some((child) => canViewMenu(child, input));
  }

  if (override === true) return true;

  const required = MENU_PERMISSION_MAP[key];
  if (required === null) return true;
  return input.can(required);
}

/** Every menu key the input can see. Handy for `GET /permissions/menu`. */
export function visibleMenuKeys(input: MenuVisibilityInput): MenuKey[] {
  return MENU_KEYS.filter((key) => canViewMenu(key, input));
}
