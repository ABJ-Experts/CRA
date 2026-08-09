"use client";

import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type {
  PermissionKey,
  PermissionSet,
  BaseRole,
} from "@repo/contracts/permissions";
import { hasPermission } from "@repo/contracts/permissions";
import type { MenuKey } from "@repo/contracts/menu";
import { canViewMenu } from "@repo/contracts/menu";
import type { SessionResponse } from "@repo/contracts/auth";

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

interface SessionState {
  session: SessionResponse | null;
  permissions: PermissionSet;
  menu: MenuKey[] | null;
  role: BaseRole | null;
  isLoading: boolean;
  isError: boolean;
}

const SessionContext = createContext<SessionState>({
  session: null,
  permissions: {},
  menu: null,
  role: null,
  isLoading: true,
  isError: false,
});

const MOCKS_ENABLED = process.env.NEXT_PUBLIC_ENABLE_MOCKS !== "false";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Request failed with ${res.status}`);
  return (await res.json()) as T;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  /*
   * Disabled entirely while mocks are on. A clean checkout runs with no API and
   * no database, and a session query firing into nothing would put the whole
   * app in a permanent error state on first `pnpm dev`.
   */
  const enabled = !MOCKS_ENABLED;

  const sessionQuery = useQuery({
    queryKey: ["session"],
    enabled,
    retry: false,
    // The session rarely changes within a visit, and every screen reads it.
    staleTime: 5 * 60_000,
    queryFn: () => getJson<SessionResponse>("/auth/session"),
  });

  const permissionsQuery = useQuery({
    queryKey: ["permissions"],
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: () =>
      getJson<{ role: BaseRole | null; permissions: PermissionSet }>(
        "/permissions/effective",
      ),
  });

  const menuQuery = useQuery({
    queryKey: ["permissions", "menu"],
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: () => getJson<{ menu: MenuKey[] }>("/permissions/menu"),
  });

  const value = useMemo<SessionState>(
    () => ({
      session: sessionQuery.data ?? null,
      permissions: permissionsQuery.data?.permissions ?? {},
      // `null` means "not known", which `useCanViewMenu` reads as show-everything.
      // An empty array would mean "known to be empty" and hide the whole rail.
      menu: enabled ? (menuQuery.data?.menu ?? null) : null,
      role: permissionsQuery.data?.role ?? null,
      isLoading:
        enabled &&
        (sessionQuery.isLoading ||
          permissionsQuery.isLoading ||
          menuQuery.isLoading),
      isError:
        enabled &&
        (sessionQuery.isError || permissionsQuery.isError || menuQuery.isError),
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
 * Returns true for everything until the menu is known. Hiding items during the
 * first paint would make the sidebar visibly reshuffle on every load, and it
 * would empty the rail whenever the request fails.
 */
export function useCanViewMenu(): (key: MenuKey) => boolean {
  const { menu, permissions } = useSession();

  return useMemo(() => {
    if (menu === null) {
      // Not known yet (or mocks are on): fall back to the local computation,
      // which still respects any permissions already loaded and shows the
      // always-visible entries.
      return (key: MenuKey) =>
        canViewMenu(key, { can: (k) => hasPermission(permissions, k) });
    }
    const allowed = new Set(menu);
    return (key: MenuKey) => allowed.has(key);
  }, [menu, permissions]);
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
