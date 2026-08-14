"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useMocksReady } from "../../_providers/providers";
import { useSession } from "../../_providers/session-provider";

/**
 * Presentation-only onboarding entry guard. The API remains authoritative for
 * the session and every organization mutation; this merely routes a verified
 * authenticated user with no memberships to the creation screen.
 */
export function DashboardOnboardingGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const mocksReady = useMocksReady();
  const { session, isError, isLoading } = useSession();
  const liveApiEnabled =
    mocksReady && process.env.NEXT_PUBLIC_ENABLE_MOCKS === "false";
  const isOnboardingRoute = pathname === "/onboarding";
  const hasNoMemberships =
    session !== null && session.organizations.length === 0;

  useEffect(() => {
    if (
      liveApiEnabled &&
      !isLoading &&
      !isError &&
      hasNoMemberships &&
      !isOnboardingRoute
    ) {
      router.replace("/onboarding");
    }
  }, [
    hasNoMemberships,
    isError,
    isLoading,
    isOnboardingRoute,
    liveApiEnabled,
    router,
  ]);

  return <>{children}</>;
}
