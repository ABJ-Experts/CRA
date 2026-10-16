"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  LicenseActivationInput,
  LicenseUsageOperationInput,
} from "@repo/contracts/licensing/types";
import { useSession } from "../../_providers/session-provider";
import { useMocksReady } from "../../_providers/providers";
import { ApiClientError } from "../../_lib/http/api-client";
import { LicensingGateway } from "./licensing-gateway";

const gateway = new LicensingGateway();
export function useLicensingQueries({
  management = true,
}: { management?: boolean } = {}) {
  const client = useQueryClient();
  const { session, permissions, isLoading, isError } = useSession();
  const ready = useMocksReady();
  const organizationId = session?.organization?.id;
  const scope = JSON.stringify([
    organizationId,
    session?.user.id,
    Object.entries(permissions).sort(),
  ]);
  const enabled =
    ready &&
    process.env.NEXT_PUBLIC_ENABLE_MOCKS === "false" &&
    !!organizationId &&
    !isLoading &&
    !isError;
  const common = {
    retry: false as const,
    gcTime: 0,
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: "always" as const,
  };
  const policy = useQuery({
    ...common,
    queryKey: ["licensing", scope, "policy"],
    enabled,
    queryFn: ({ signal }) => gateway.policy(signal),
  });
  const canView = permissions.can_view_licensing === true;
  const current = useQuery({
    ...common,
    queryKey: ["licensing", scope, "current"],
    enabled: enabled && canView && management,
    queryFn: ({ signal }) => gateway.current(signal),
  });
  const history = useQuery({
    ...common,
    queryKey: ["licensing", scope, "history"],
    enabled: enabled && canView && management,
    queryFn: ({ signal }) => gateway.history({}, signal),
  });
  const usage = useQuery({
    ...common,
    queryKey: ["licensing", scope, "usage"],
    enabled: enabled && canView && management,
    queryFn: ({ signal }) => gateway.usage(signal),
  });
  const usageExport = useMutation({
    mutationKey: ["licensing", scope, "export"],
    mutationFn: (input: LicenseUsageOperationInput) =>
      gateway.exportUsage(input),
    retry: false,
    onSettled: () => {
      // Do not defer a revoked POST error until this follow-up GET completes.
      void client.invalidateQueries({
        queryKey: ["licensing", scope, "usage"],
      });
    },
  });
  const reconciliation = useMutation({
    mutationKey: ["licensing", scope, "reconcile"],
    mutationFn: (input: LicenseUsageOperationInput) =>
      gateway.reconcileUsage(input),
    retry: false,
    onSettled: () => {
      // Do not defer a revoked POST error until this follow-up GET completes.
      void client.invalidateQueries({
        queryKey: ["licensing", scope, "usage"],
      });
    },
  });
  const activation = useMutation({
    mutationFn: (input: LicenseActivationInput) => gateway.activate(input),
    retry: false,
    onSettled: () =>
      client.invalidateQueries({ queryKey: ["licensing", scope] }),
  });
  const revoked = [
    policy.error,
    current.error,
    history.error,
    usage.error,
    usageExport.error,
    reconciliation.error,
  ].some(
    (error) =>
      error instanceof ApiClientError &&
      (error.status === 401 || error.status === 403),
  );
  return {
    policy: { ...policy, data: enabled && !revoked ? policy.data : undefined },
    current: {
      ...current,
      data: enabled && canView && !revoked ? current.data : undefined,
    },
    history: {
      ...history,
      data: enabled && canView && !revoked ? history.data : undefined,
    },
    usage: {
      ...usage,
      data:
        enabled && canView && management && !revoked ? usage.data : undefined,
    },
    usageExport,
    reconciliation,
    scope,
    activation,
    canView,
    canManage: permissions.can_manage_licensing === true && !revoked,
    organizationId,
    enabled,
    revoked,
  };
}
