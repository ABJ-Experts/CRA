"use client";

import type {
  ChatDeliveriesQuery,
  ConfirmChatChannelInput,
  CreateChatChannelInput,
  MarkNotificationFeedReadInput,
  NotificationDeliveriesQuery,
  NotificationFeedQuery,
  RetryNotificationDeliveryInput,
  RetryChatDeliveryInput,
  SetChatChannelEnabledInput,
  TestChatChannelInput,
  UpdateChatChannelInput,
  UpdateNotificationCriticalRouteInput,
  UpdateNotificationPreferencesInput,
} from "@repo/contracts/notifications";
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useRef, useState } from "react";

import { useSession } from "../../_providers/session-provider";
import { organizationKeys } from "../organizations/organizations.keys";
import { productsApi } from "../products/products.api";
import { notificationsApi } from "./notifications.api";

const all = Object.freeze(["notifications"] as const);

function useNotificationScope() {
  const { session, permissions, role, isLoading, isError } = useSession();
  const switchingOrganization =
    useIsMutating({ mutationKey: organizationKeys.switchMutation }) > 0;
  return {
    orgId: session?.organization?.id,
    userId: session?.user.id,
    permissions,
    role,
    scopeReady:
      !isLoading &&
      !isError &&
      !switchingOrganization &&
      Boolean(session?.organization?.id && session?.user.id),
    feedReady:
      !isLoading &&
      !isError &&
      !switchingOrganization &&
      Boolean(session?.organization?.id && session?.user.id),
  };
}

export function useChatChannelsQuery(enabled = true) {
  const scope = useNotificationScope();
  const canManage =
    scope.permissions.can_edit_organization === true &&
    (scope.role === "owner" || scope.role === "admin");
  const result = useQuery({
    queryKey: [
      "notifications",
      scope.orgId,
      scope.userId,
      scope.permissions,
      scope.role,
      "chat-channels",
    ],
    enabled: enabled && scope.scopeReady && canManage,
    retry: false,
    queryFn: ({ signal }) => notificationsApi.chatChannels(signal),
  });
  return scope.scopeReady && canManage
    ? result
    : { ...result, data: undefined };
}

export function useChatProductsQuery(search: string, enabled = true) {
  const scope = useNotificationScope();
  const canManage =
    scope.permissions.can_edit_organization === true &&
    (scope.role === "owner" || scope.role === "admin");
  const result = useQuery({
    queryKey: [
      "notifications",
      scope.orgId,
      scope.userId,
      scope.permissions,
      "chat-products",
      search,
    ],
    enabled: enabled && scope.scopeReady && canManage,
    retry: false,
    queryFn: ({ signal }) =>
      productsApi.list(
        { page: 1, pageSize: 25, archived: false, q: search || undefined },
        signal,
      ),
  });
  return scope.scopeReady && canManage
    ? result
    : { ...result, data: undefined };
}

export function useChatDeliveriesQuery(
  query: Partial<ChatDeliveriesQuery>,
  enabled = true,
) {
  const scope = useNotificationScope();
  const canView = scope.permissions.can_view_audit === true;
  const result = useQuery({
    queryKey: [
      "notifications",
      scope.orgId,
      scope.userId,
      scope.permissions,
      "chat-deliveries",
      query,
    ],
    enabled: enabled && scope.scopeReady && canView,
    retry: false,
    refetchInterval: 30_000,
    queryFn: ({ signal }) => notificationsApi.chatDeliveries(query, signal),
  });
  return scope.scopeReady && canView ? result : { ...result, data: undefined };
}

function useChatMutation<TInput, TOutput>(
  mutationFn: (input: TInput) => Promise<TOutput>,
) {
  const { orgId } = useNotificationScope();
  const client = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["notifications", orgId] });
    },
  });
}

export function useCreateChatChannelMutation() {
  return useChatSecretCommand((input: CreateChatChannelInput) =>
    notificationsApi.createChatChannel(input),
  );
}

export function useUpdateChatChannelMutation() {
  return useChatSecretCommand(
    (args: Readonly<{ channelId: string; input: UpdateChatChannelInput }>) =>
      notificationsApi.updateChatChannel(args.channelId, args.input),
  );
}

/** Credential-bearing commands avoid MutationCache, including after a failed request. */
function useChatSecretCommand<TInput, TOutput>(
  command: (input: TInput) => Promise<TOutput>,
) {
  const { orgId, userId, scopeReady } = useNotificationScope();
  const currentScope = useRef(`${orgId ?? "none"}:${userId ?? "none"}`);
  currentScope.current = `${orgId ?? "none"}:${userId ?? "none"}`;
  const inFlight = useRef(false);
  const client = useQueryClient();
  const [isPending, setPending] = useState(false);
  return {
    isPending,
    async mutateAsync(input: TInput): Promise<TOutput> {
      const scope = `${orgId ?? "none"}:${userId ?? "none"}`;
      if (!scopeReady || !orgId || !userId || currentScope.current !== scope)
        throw new Error(
          "Organization changed. Reopen chat settings before submitting credentials.",
        );
      if (inFlight.current)
        throw new Error("A chat channel change is already being submitted.");
      inFlight.current = true;
      setPending(true);
      try {
        const result = await command(input);
        await client.invalidateQueries({ queryKey: ["notifications", orgId] });
        if (currentScope.current !== scope)
          throw new Error("Organization changed during credential submission.");
        return result;
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
  };
}

export function useTestChatChannelMutation() {
  return useChatMutation(
    (args: Readonly<{ channelId: string; input: TestChatChannelInput }>) =>
      notificationsApi.testChatChannel(args.channelId, args.input),
  );
}

export function useConfirmChatChannelMutation() {
  return useChatSecretCommand(
    (args: Readonly<{ channelId: string; input: ConfirmChatChannelInput }>) =>
      notificationsApi.confirmChatChannel(args.channelId, args.input),
  );
}

export function useSetChatChannelEnabledMutation() {
  return useChatMutation(
    (
      args: Readonly<{ channelId: string; input: SetChatChannelEnabledInput }>,
    ) => notificationsApi.setChatChannelEnabled(args.channelId, args.input),
  );
}

export function useRetryChatDeliveryMutation() {
  return useChatMutation(
    (args: Readonly<{ deliveryId: string; input: RetryChatDeliveryInput }>) =>
      notificationsApi.retryChatDelivery(args.deliveryId, args.input),
  );
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
