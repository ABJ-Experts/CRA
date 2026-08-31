"use client";

import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { PermissionKey } from "@repo/contracts/permissions";
import { hasPermission } from "@repo/contracts/permissions";
import type { MenuKey } from "@repo/contracts/menu";
import { canViewMenu } from "@repo/contracts/menu";

import {
  deriveSessionState,
  type SessionState,
} from "../_features/session/session-state";
import {
  sessionIdentityQueryOptions,
  sessionMenuQueryOptions,
  sessionPermissionsQueryOptions,
} from "../_features/session/session.queries";
import { useMocksReady } from "./providers";

/**
 * Session and permissions for the client.
 *
 * The permission MATH is imported from `@repo/contracts` — the same module the
 * API enforces with. A second implementation here would drift, and the drift
 * would surface as a button the UI offers and the server then refuses.
 *
 * FAILURE POSTURE, which is the part worth getting right:
 *   while loading, and when the query errors, `canViewMenu` falls back to
 *   showing everything that is not explicitly permission-gated. The opposite
 *   choice — fail closed — empties the entire sidebar on a transient network
 *   blip and the app looks broken rather than degraded. Nothing is protected by
 *   hiding it: every gated route is enforced by the API and by middleware, so
 *   an over-generous nav costs a 403, not a leak.
 */

const SessionContext = createContext<SessionState>({
  session: null,
  permissions: {},
  menu: null,
  role: null,
  isLoading: true,
  isError: false,
});

export function SessionProvider({ children }: { children: ReactNode }) {
  /*
   * Disabled entirely while mocks are on. A clean checkout runs with no API and
   * no database, and a session query firing into nothing would put the whole
   * app in a permanent error state on first `pnpm dev`.
   */
  const mocksReady = useMocksReady();
  const enabled =
    mocksReady && process.env.NEXT_PUBLIC_ENABLE_MOCKS === "false";

  const sessionQuery = useQuery(sessionIdentityQueryOptions(enabled));
  const permissionsQuery = useQuery(sessionPermissionsQueryOptions(enabled));
  const menuQuery = useQuery(sessionMenuQueryOptions(enabled));

  const value = useMemo<SessionState>(
    () =>
      deriveSessionState({
        enabled,
        session: sessionQuery.data ?? null,
        permissions: permissionsQuery.data ?? null,
        menu: menuQuery.data ?? null,
        loading:
          sessionQuery.isLoading ||
          permissionsQuery.isLoading ||
          menuQuery.isLoading,
        error:
          sessionQuery.isError || permissionsQuery.isError || menuQuery.isError,
      }),
    [
      enabled,
      sessionQuery.data,
      sessionQuery.isLoading,
      sessionQuery.isError,
      permissionsQuery.data,
      permissionsQuery.isLoading,
      permissionsQuery.isError,
      menuQuery.data,
      menuQuery.isLoading,
      menuQuery.isError,
    ],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}

/** True when the permission is granted. False while loading — see below. */
export function useHasPermission(key: PermissionKey): boolean {
  const { permissions } = useSession();
  return hasPermission(permissions, key);
}

/**
 * Whether a nav entry should render.
 *
 * Returns true for everything during the initial live load. Hiding items on
 * first paint would make the sidebar visibly reshuffle after every sign-in.
 * Once loading has settled, a missing menu falls back to known local
 * permissions so a failed menu request does not leave the rail empty forever.
 */
export function useCanViewMenu(): (key: MenuKey) => boolean {
  const { menu, permissions, isLoading } = useSession();

  return useMemo(() => {
    if (menu === null && isLoading) {
      // The session, permissions, and server menu load in parallel. Do not
      // interpret the initial empty permission snapshot as a denial while
      // those requests are pending, or the rail visibly shrinks immediately
      // after sign-in and expands again once the session settles.
      return () => true;
    }
    if (menu === null) {
      // Not known yet (or mocks are on): fall back to the local computation,
      // which still respects any permissions already loaded and shows the
      // always-visible entries.
      return (key: MenuKey) =>
        canViewMenu(key, { can: (k) => hasPermission(permissions, k) });
    }
    const allowed = new Set(menu);
    return (key: MenuKey) => allowed.has(key);
  }, [isLoading, menu, permissions]);
}

/** Conditional render helper: `<Can permission="can_view_users">…</Can>`. */
export function Can({
  permission,
  children,
  fallback = null,
}: {
  permission: PermissionKey;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return useHasPermission(permission) ? <>{children}</> : <>{fallback}</>;
}
