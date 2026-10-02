"use client";

import type {
  NotificationDeliveriesQuery,
  RetryNotificationDeliveryInput,
  UpdateNotificationCriticalRouteInput,
  UpdateNotificationPreferencesInput,
} from "@repo/contracts/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useSession } from "../../_providers/session-provider";
import { notificationsApi } from "./notifications.api";

const all = Object.freeze(["notifications"] as const);

function useNotificationScope() {
  const { session, permissions } = useSession();
  return {
    orgId: session?.organization?.id,
    userId: session?.user.id,
    permissions,
  };
}

export function useNotificationPreferencesQuery(enabled = true) {
  const { orgId, userId, permissions } = useNotificationScope();
  return useQuery({
    queryKey: ["notifications", orgId, userId, permissions, "preferences"],
    enabled: enabled && Boolean(orgId && userId),
    retry: false,
    queryFn: ({ signal }) => notificationsApi.preferences(signal),
  });
}

export function useUpdateNotificationPreferencesMutation() {
  const { orgId, userId } = useNotificationScope();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateNotificationPreferencesInput) =>
      notificationsApi.updatePreferences(input),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["notifications", orgId, userId],
      });
    },
  });
}

export function useNotificationDeliveriesQuery(
  query: Partial<NotificationDeliveriesQuery>,
  enabled = true,
) {
  const { orgId, userId, permissions } = useNotificationScope();
  return useQuery({
    queryKey: [
      "notifications",
      orgId,
      userId,
      permissions,
      "deliveries",
      query,
    ],
    enabled: enabled && Boolean(orgId),
    retry: false,
    refetchInterval: 30_000,
    queryFn: ({ signal }) => notificationsApi.deliveries(query, signal),
  });
}

export function useNotificationCriticalRouteQuery(
  userId: string | null,
  enabled = true,
) {
  const scope = useNotificationScope();
  return useQuery({
    queryKey: [
      "notifications",
      scope.orgId,
      scope.userId,
      scope.permissions,
      "critical-route",
      userId,
    ],
    enabled: enabled && Boolean(scope.orgId && userId),
    retry: false,
    queryFn: ({ signal }) => notificationsApi.criticalRoute(userId!, signal),
  });
}

export function useUpdateNotificationCriticalRouteMutation() {
  const { orgId } = useNotificationScope();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      input,
    }: Readonly<{
      userId: string;
      input: UpdateNotificationCriticalRouteInput;
    }>) => notificationsApi.updateCriticalRoute(userId, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["notifications", orgId] });
    },
  });
}

export function useRetryNotificationDeliveryMutation() {
  const { orgId } = useNotificationScope();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      deliveryRef,
      input,
    }: Readonly<{
      deliveryRef: string;
      input: RetryNotificationDeliveryInput;
    }>) => notificationsApi.retryDelivery(deliveryRef, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["notifications", orgId] });
    },
  });
}

export const notificationKeys = Object.freeze({ all });
