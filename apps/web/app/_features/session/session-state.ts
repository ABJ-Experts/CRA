import type { SessionResponse } from "@repo/contracts/auth";
import type { MenuKey } from "@repo/contracts/menu";
import type { BaseRole, PermissionSet } from "@repo/contracts/permissions";

import type { EffectivePermissionsResponse } from "./session.api";

export interface SessionState {
  readonly session: SessionResponse | null;
  readonly permissions: PermissionSet;
  readonly menu: readonly MenuKey[] | null;
  readonly role: BaseRole | null;
  readonly isLoading: boolean;
  readonly isError: boolean;
}

export interface DeriveSessionStateInput {
  readonly enabled: boolean;
  readonly session: SessionResponse | null;
  readonly permissions: Pick<
    EffectivePermissionsResponse,
    "role" | "permissions"
  > | null;
  readonly menu: readonly MenuKey[] | null;
  readonly loading: boolean;
  readonly error: boolean;
}

function copySession(session: SessionResponse | null): SessionResponse | null {
  if (session === null) return null;

  const organizations = session.organizations.map((organization) =>
    Object.freeze({ ...organization }),
  );
  Object.freeze(organizations);

  return Object.freeze({
    user: Object.freeze({ ...session.user }),
    organization: session.organization
      ? Object.freeze({ ...session.organization })
      : null,
    organizations,
  });
}

export function deriveSessionState({
  enabled,
  session,
  permissions,
  menu,
  loading,
  error,
}: DeriveSessionStateInput): SessionState {
  if (!enabled) {
    return Object.freeze({
      session: null,
      permissions: Object.freeze({}),
      menu: null,
      role: null,
      isLoading: false,
      isError: false,
    });
  }

  const permissionSnapshot = Object.freeze({
    ...(permissions?.permissions ?? {}),
  });
  // `/permissions/menu` is independently authenticated and runtime-parsed.
  // Keep a successful server decision even when optional identity enrichment
  // is still loading or temporarily unavailable; otherwise a transient
  // `/auth/session` outage collapses the rail after a valid sign-in.
  const menuSnapshot = menu === null ? null : [...menu];
  if (menuSnapshot !== null) Object.freeze(menuSnapshot);

  return Object.freeze({
    session: copySession(session),
    permissions: permissionSnapshot,
    // `null` is the deliberate fail-open signal consumed by `useCanViewMenu`.
    // A non-null value has already passed the authenticated menu boundary.
    menu: menuSnapshot,
    role: permissions?.role ?? null,
    isLoading: loading,
    isError: error,
  });
}
