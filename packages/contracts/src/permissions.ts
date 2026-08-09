/**
 * The RBAC model, shared verbatim by `apps/api` and `apps/web`.
 *
 * Ported from `xisuite-backend/src/permissions/models/access-control.model.ts`
 * and retargeted at CRA's actual navigation surface. Three deliberate
 * deviations from the reference are marked DEVIATION below; each one closes a
 * privilege-escalation hole that the reference's ordering leaves open.
 */

// ---------------------------------------------------------------------------
// Base roles
// ---------------------------------------------------------------------------

/** The four base organization roles, ordered by privilege (owner strongest). */
export const BASE_ROLES = ["owner", "admin", "member", "viewer"] as const;

export type BaseRole = (typeof BASE_ROLES)[number];

/** Rank for comparisons. Higher wins. Never persisted — derived only. */
export const BASE_ROLE_RANK: Readonly<Record<BaseRole, number>> = {
  owner: 40,
  admin: 30,
  member: 20,
  viewer: 10,
};

export function isBaseRole(value: unknown): value is BaseRole {
  return (
    typeof value === "string" &&
    (BASE_ROLES as readonly string[]).includes(value)
  );
}

/**
 * Coerce anything to a known base role.
 *
 * Falls back to `viewer` — the least privileged — so a role string that was
 * renamed or corrupted downgrades rather than escalating. The reference does
 * the same, and it is the single most important default in this file.
 */
export function coerceBaseRole(value: unknown): BaseRole {
  return isBaseRole(value) ? value : "viewer";
}

// ---------------------------------------------------------------------------
// Permission keys
// ---------------------------------------------------------------------------

export const PERMISSION_ACTIONS = [
  "view",
  "create",
  "edit",
  "delete",
  "export",
] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/**
 * Which actions exist per module. Not every module supports every action —
 * generating the full cross product would invent keys like
 * `can_create_analytics` that nothing can ever check, and a permission key that
 * cannot be reached is indistinguishable from one that was forgotten.
 *
 * Modules mirror `apps/web/app/_components/sidebar/nav-config.tsx`.
 */
export const PERMISSION_MATRIX = {
  // Administration
  users: ["view", "create", "edit", "delete", "export"],
  roles: ["view", "create", "edit", "delete"],
  invitations: ["view", "create", "delete"],
  organization: ["view", "edit"],
  audit: ["view", "export"],
  // Commerce
  products: ["view", "create", "edit", "delete", "export"],
  orders: ["view", "create", "edit", "delete", "export"],
  invoices: ["view", "create", "edit", "delete", "export"],
  // Logistics
  fleet: ["view", "create", "edit", "delete"],
  routes: ["view", "create", "edit", "delete"],
  // Workspace
  messages: ["view", "create", "delete"],
  email: ["view", "create", "delete"],
  calendar: ["view", "create", "edit", "delete"],
  files: ["view", "create", "edit", "delete"],
  // Read surfaces
  dashboards: ["view", "export"],
  tables: ["view", "export"],
  analytics: ["view", "export"],
} as const satisfies Record<string, readonly PermissionAction[]>;

export type PermissionModule = keyof typeof PERMISSION_MATRIX;

export const PERMISSION_MODULES = Object.keys(
  PERMISSION_MATRIX,
) as PermissionModule[];

/**
 * The permission key union, e.g. `can_view_orders`.
 *
 * Derived from the matrix rather than hand-listed, so adding an action to a
 * module cannot leave the type and the runtime set disagreeing.
 */
export type PermissionKey = {
  [M in PermissionModule]: `can_${(typeof PERMISSION_MATRIX)[M][number]}_${M}`;
}[PermissionModule];

/** Every valid key, generated once at module load. */
export const PERMISSION_KEYS: readonly PermissionKey[] =
  PERMISSION_MODULES.flatMap((module) =>
    (PERMISSION_MATRIX[module] as readonly PermissionAction[]).map(
      (action) => `can_${action}_${module}` as PermissionKey,
    ),
  );

const PERMISSION_KEY_SET: ReadonlySet<string> = new Set<string>(
  PERMISSION_KEYS,
);

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === "string" && PERMISSION_KEY_SET.has(value);
}

export function permissionKey<M extends PermissionModule>(
  action: (typeof PERMISSION_MATRIX)[M][number],
  module: M,
): PermissionKey {
  return `can_${action}_${module}` as PermissionKey;
}

/**
 * A permission set. Absent means denied — never "inherit".
 *
 * `Partial` is load-bearing: with `noUncheckedIndexedAccess` on (see
 * `packages/typescript-config/base.json`) reading a key yields
 * `boolean | undefined`, which forces every consumer through `hasPermission`
 * instead of a truthiness check that would treat `undefined` as meaningful.
 */
export type PermissionSet = Partial<Record<PermissionKey, boolean>>;

/**
 * The one and only way to ask whether a permission is granted.
 *
 * Strict `=== true`: `undefined` is a denial, and so is `false`.
 */
export function hasPermission(set: PermissionSet, key: PermissionKey): boolean {
  return set[key] === true;
}

export function hasAllPermissions(
  set: PermissionSet,
  keys: readonly PermissionKey[],
): boolean {
  return keys.every((key) => hasPermission(set, key));
}

export function hasAnyPermission(
  set: PermissionSet,
  keys: readonly PermissionKey[],
): boolean {
  return keys.some((key) => hasPermission(set, key));
}

/**
 * Drop anything that is not a live permission key.
 *
 * `custom_roles.permissions` is `jsonb`, so a key can survive in the database
 * long after the code that defined it was deleted. Without this, a stale key
 * would ride through every merge and show up in `GET /permissions/effective`
 * as if it meant something.
 */
export function sanitizePermissions(input: unknown): PermissionSet {
  if (input === null || typeof input !== "object" || Array.isArray(input))
    return {};
  const out: PermissionSet = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (isPermissionKey(key) && typeof value === "boolean") out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Implications
// ---------------------------------------------------------------------------

/**
 * Acting on a thing implies being able to see it.
 *
 * Without this, a role granted `can_edit_orders` but not `can_view_orders`
 * produces a user who can PATCH an order they cannot GET — the API allows the
 * write while the sidebar hides the page. The reference has no such rule and
 * papers over it by always granting view in its presets, which works until
 * someone builds a custom role by hand.
 */
export const IMPLICATIONS: Readonly<
  Record<PermissionAction, readonly PermissionAction[]>
> = {
  view: [],
  create: ["view"],
  edit: ["view"],
  delete: ["view"],
  export: ["view"],
};

/** Parse `can_<action>_<module>` back into its parts. */
export function parsePermissionKey(key: PermissionKey): {
  action: PermissionAction;
  module: PermissionModule;
} {
  // Module names contain no underscore, so the last segment is the module and
  // the middle is the action. Asserted by a spec.
  const withoutPrefix = key.slice("can_".length);
  const separator = withoutPrefix.indexOf("_");
  const action = withoutPrefix.slice(0, separator) as PermissionAction;
  const module = withoutPrefix.slice(separator + 1) as PermissionModule;
  return { action, module };
}

/**
 * Apply implications: any granted action pulls in the actions it implies.
 *
 * Only ever grants. Never clears a key — an explicit `false` survives untouched
 * so the caller can still revoke afterwards.
 */
export function normalizePermissions(set: PermissionSet): PermissionSet {
  const out: PermissionSet = { ...set };
  for (const key of PERMISSION_KEYS) {
    if (out[key] !== true) continue;
    const { action, module } = parsePermissionKey(key);
    for (const implied of IMPLICATIONS[action]) {
      const impliedKey = `can_${implied}_${module}` as PermissionKey;
      if (PERMISSION_KEY_SET.has(impliedKey)) out[impliedKey] = true;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Merges
// ---------------------------------------------------------------------------

/**
 * Authoritative merge: every key present in `patch` replaces the base,
 * including an explicit `false`. Used for organization-level overrides, which
 * must be able to REVOKE.
 */
export function mergeHard(
  base: PermissionSet,
  patch: PermissionSet,
): PermissionSet {
  return { ...base, ...patch };
}

/**
 * Additive merge: `true` wins, `false` is ignored when the base already
 * granted. Used for custom roles, which may only ADD.
 *
 * This asymmetry with `mergeHard` is the heart of the model: an organization
 * can take a capability away from a base role, but assigning someone an extra
 * role can never quietly strip a permission they already had.
 */
export function mergePermissive(
  base: PermissionSet,
  patch: PermissionSet,
): PermissionSet {
  const out: PermissionSet = { ...base };
  for (const [key, value] of Object.entries(patch) as [
    PermissionKey,
    boolean,
  ][]) {
    if (value === true) out[key] = true;
    else if (out[key] === undefined) out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

function grantAll(): PermissionSet {
  const out: PermissionSet = {};
  for (const key of PERMISSION_KEYS) out[key] = true;
  return out;
}

function grantViewOf(modules: readonly PermissionModule[]): PermissionSet {
  const out: PermissionSet = {};
  for (const module of modules)
    out[`can_view_${module}` as PermissionKey] = true;
  return out;
}

/** Modules a plain viewer may see. Administration surfaces are excluded. */
const VIEWER_MODULES: readonly PermissionModule[] = [
  "organization",
  "products",
  "orders",
  "invoices",
  "fleet",
  "routes",
  "messages",
  "email",
  "calendar",
  "files",
  "dashboards",
  "tables",
  "analytics",
];

/** Modules a member may also create/edit in — day-to-day operational work. */
const MEMBER_WRITE_MODULES: readonly PermissionModule[] = [
  "products",
  "orders",
  "invoices",
  "fleet",
  "routes",
  "messages",
  "email",
  "calendar",
  "files",
];

function viewerPreset(): PermissionSet {
  return grantViewOf(VIEWER_MODULES);
}

function memberPreset(): PermissionSet {
  const out: PermissionSet = viewerPreset();
  for (const module of MEMBER_WRITE_MODULES) {
    const actions = PERMISSION_MATRIX[module] as readonly PermissionAction[];
    for (const action of actions) {
      // Members create and edit but never delete. Deletion is an admin verb
      // here because none of these entities has an undo.
      if (action === "create" || action === "edit") {
        out[`can_${action}_${module}` as PermissionKey] = true;
      }
    }
  }
  for (const module of [
    "dashboards",
    "tables",
    "analytics",
    "products",
    "orders",
  ] as const) {
    out[`can_export_${module}` as PermissionKey] = true;
  }
  return out;
}

function adminPreset(): PermissionSet {
  const out = grantAll();
  // Organization settings (name, slug, branding, deletion) stay with the owner.
  // Everything else — including user and role administration — is the admin's.
  out.can_edit_organization = false;
  return out;
}

/**
 * Default permission set per base role. Frozen copies are returned by
 * `defaultPermissionsFor` so a caller cannot mutate the preset in place.
 */
export const DEFAULT_PERMISSIONS_BY_ROLE: Readonly<
  Record<BaseRole, PermissionSet>
> = {
  owner: normalizePermissions(grantAll()),
  admin: normalizePermissions(adminPreset()),
  member: normalizePermissions(memberPreset()),
  viewer: normalizePermissions(viewerPreset()),
};

export function defaultPermissionsFor(role: BaseRole): PermissionSet {
  return { ...DEFAULT_PERMISSIONS_BY_ROLE[coerceBaseRole(role)] };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface AssignedCustomRole {
  id: string;
  name: string;
  base_role: BaseRole;
  permissions: unknown;
  is_active: boolean;
  is_deleted: boolean;
}

export interface ResolveInput {
  baseRole: BaseRole;
  customRoles?: readonly AssignedCustomRole[];
  /** Organization-level overrides for the user's base role. */
  baseRoleOverrides?: unknown;
}

/**
 * Compute a user's effective permissions.
 *
 * Order — and it is the order, not the merges, that carries the security:
 *
 *   1. base role defaults
 *   2. every active custom role, merged permissively (add only)
 *   3. implications
 *   4. organization overrides, merged hard — the last word
 *
 * DEVIATION from the reference, and the reason for it: the reference applies
 * overrides at step 2 and custom roles afterwards. That ordering means an
 * organization that revokes `can_delete_users` from `admin` has the revocation
 * silently undone the moment the user is assigned any custom role whose
 * `base_role` is `admin`, because the custom role re-merges the full admin
 * preset on top. Moving the override to last makes a revocation actually stick.
 * Covered by `resolves the override as the last word` in the spec.
 *
 * DEVIATION 2: custom roles contribute their own `permissions` only, not their
 * `base_role` preset. The reference merges `DEFAULT_PERMISSIONS_BY_ROLE[role.base_role]`
 * as well, so a custom role called "Report Reader" carrying a single permission
 * but declaring `base_role: 'admin'` grants full administration. `base_role` on
 * a custom role is a UI grouping hint, not a grant.
 *
 * DEVIATION 3: `permissions` is sanitized against the live key set, so a key
 * removed from the code cannot keep granting access from stale `jsonb`.
 */
export function resolveEffectivePermissions(
  input: ResolveInput,
): PermissionSet {
  const baseRole = coerceBaseRole(input.baseRole);

  let effective: PermissionSet = defaultPermissionsFor(baseRole);

  for (const role of input.customRoles ?? []) {
    if (!role.is_active || role.is_deleted) continue;
    effective = mergePermissive(
      effective,
      sanitizePermissions(role.permissions),
    );
  }

  effective = normalizePermissions(effective);

  const overrides = sanitizePermissions(input.baseRoleOverrides);
  if (Object.keys(overrides).length > 0) {
    effective = mergeHard(effective, overrides);
  }

  return effective;
}
