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
  const menuSnapshot = loading || error || menu === null ? null : [...menu];
  if (menuSnapshot !== null) Object.freeze(menuSnapshot);

  return Object.freeze({
    session: copySession(session),
    permissions: permissionSnapshot,
    // Never turn a partial or failed fetch into an authoritative menu. `null`
    // is the deliberate fail-open signal consumed by `useCanViewMenu`.
    menu: menuSnapshot,
    role: permissions?.role ?? null,
    isLoading: loading,
    isError: error,
  });
}
