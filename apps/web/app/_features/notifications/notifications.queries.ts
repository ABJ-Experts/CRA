"use client";

import type {
  MarkNotificationFeedReadInput,
  NotificationDeliveriesQuery,
  NotificationFeedQuery,
  RetryNotificationDeliveryInput,
  UpdateNotificationCriticalRouteInput,
  UpdateNotificationPreferencesInput,
} from "@repo/contracts/notifications";
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { useSession } from "../../_providers/session-provider";
import { organizationKeys } from "../organizations/organizations.keys";
import { notificationsApi } from "./notifications.api";

const all = Object.freeze(["notifications"] as const);

function useNotificationScope() {
  const { session, permissions, isLoading, isError } = useSession();
  const switchingOrganization =
    useIsMutating({ mutationKey: organizationKeys.switchMutation }) > 0;
  return {
    orgId: session?.organization?.id,
    userId: session?.user.id,
    permissions,
    feedReady:
      !isLoading &&
      !isError &&
      !switchingOrganization &&
      Boolean(session?.organization?.id && session?.user.id),
  };
}

export function useNotificationFeedQuery(
  query: Partial<NotificationFeedQuery>,
  enabled = true,
) {
  const { orgId, userId, permissions, feedReady } = useNotificationScope();
  const result = useQuery({
    queryKey: ["notifications", orgId, userId, permissions, "feed", query],
    enabled: enabled && feedReady,
    retry: false,
    refetchInterval: 30_000,
    queryFn: ({ signal }) => notificationsApi.feed(query, signal),
  });
  return feedReady ? result : { ...result, data: undefined };
}

export function useNotificationUnreadCountQuery(enabled = true) {
  const { orgId, userId, permissions, feedReady } = useNotificationScope();
  const result = useQuery({
    queryKey: ["notifications", orgId, userId, permissions, "unread-count"],
    enabled: enabled && feedReady,
    retry: false,
    refetchInterval: 30_000,
    queryFn: ({ signal }) => notificationsApi.unreadCount(signal),
  });
  return feedReady ? result : { ...result, data: undefined };
}

export function useMarkNotificationReadMutation() {
  const { orgId, userId } = useNotificationScope();
  const client = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (input: MarkNotificationFeedReadInput) =>
      notificationsApi.markRead(input),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["notifications", orgId, userId],
      });
    },
  });
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
    enabled: enabled && Boolean(orgId) && permissions.can_view_audit === true,
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
