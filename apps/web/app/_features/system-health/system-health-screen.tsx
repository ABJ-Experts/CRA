"use client";
import { cn } from "@repo/ui/cn";
import { useSession } from "../../_providers/session-provider";
import { useMocksReady } from "../../_providers/providers";
import { SystemHealthContent } from "./system-health-content";

export function SystemHealthScreen() {
  const { session, permissions, isLoading, isError } = useSession();
  const ready = useMocksReady();
  if (!ready || isLoading)
    return (
      <p role="status" className={cn("text-subhead-regular")}>
        Loading system health access…
      </p>
    );
  if (process.env.NEXT_PUBLIC_ENABLE_MOCKS !== "false")
    return (
      <p role="status" className={cn("text-subhead-regular")}>
        System health is available when the live backend is enabled.
      </p>
    );
  if (isError)
    return (
      <p role="alert" className={cn("text-subhead-regular")}>
        System health access could not be verified. Reload this page to try
        again.
      </p>
    );
  const permissionRevision = JSON.stringify(
    Object.entries(permissions).sort(([a], [b]) => a.localeCompare(b)),
  );
  const scope = session?.organization
    ? {
        userId: session.user.id,
        organizationId: session.organization.id,
        permissionRevision,
      }
    : null;
  return (
    <SystemHealthContent
      scope={scope}
      canView={permissions.can_view_system_health === true}
    />
  );
}
