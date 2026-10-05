import {
  chatChannelMutationResponseSchema,
  chatChannelParamsSchema,
  chatChannelTestResponseSchema,
  chatChannelsResponseSchema,
  chatDeliveriesQuerySchema,
  chatDeliveriesResponseSchema,
  chatDeliveryMutationResponseSchema,
  chatDeliveryParamsSchema,
  confirmChatChannelInputSchema,
  createChatChannelInputSchema,
  notificationCriticalRouteParamsSchema,
  notificationCriticalRouteResponseSchema,
  notificationDeliveriesQuerySchema,
  notificationDeliveriesResponseSchema,
  notificationDeliveryMutationResponseSchema,
  notificationDeliveryParamsSchema,
  notificationFeedDestinationParamsSchema,
  notificationFeedDestinationResponseSchema,
  notificationFeedQuerySchema,
  notificationFeedResponseSchema,
  notificationFeedUnreadCountResponseSchema,
  markNotificationFeedReadInputSchema,
  markNotificationFeedReadResponseSchema,
  notificationPreferencesResponseSchema,
  retryNotificationDeliveryInputSchema,
  retryChatDeliveryInputSchema,
  setChatChannelEnabledInputSchema,
  testChatChannelInputSchema,
  updateChatChannelInputSchema,
  updateNotificationCriticalRouteInputSchema,
  updateNotificationPreferencesInputSchema,
} from "@repo/contracts/notifications";
import type {
  ChatDeliveriesQuery,
  ConfirmChatChannelInput,
  CreateChatChannelInput,
  NotificationDeliveriesQuery,
  NotificationFeedQuery,
  MarkNotificationFeedReadInput,
  RetryNotificationDeliveryInput,
  RetryChatDeliveryInput,
  SetChatChannelEnabledInput,
  TestChatChannelInput,
  UpdateChatChannelInput,
  UpdateNotificationCriticalRouteInput,
  UpdateNotificationPreferencesInput,
} from "@repo/contracts/notifications";

import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
import { apiClient } from "../../_lib/http/api-client";

function queryPath(
  query: Partial<NotificationDeliveriesQuery> = {},
): `/${string}` {
  const parsed = apiClient.parseInput(notificationDeliveriesQuerySchema, query);
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== undefined) search.set(key, String(value));
  }
  return `/api/v1/notifications/deliveries?${search.toString()}`;
}

function criticalRoutePath(userId: string): `/${string}` {
  const parsed = apiClient.parseInput(notificationCriticalRouteParamsSchema, {
    userId,
  });
  return `/api/v1/notifications/critical-routes/${parsed.userId}`;
}

function deliveryPath(deliveryRef: string): `/${string}` {
  const parsed = apiClient.parseInput(notificationDeliveryParamsSchema, {
    deliveryRef,
  });
  return `/api/v1/notifications/deliveries/${parsed.deliveryRef}/retry`;
}

function feedPath(query: Partial<NotificationFeedQuery> = {}): `/${string}` {
  const parsed = apiClient.parseInput(notificationFeedQuerySchema, query);
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== undefined) search.set(key, String(value));
  }
  return `/api/v1/notifications/feed?${search.toString()}`;
}

function feedDestinationPath(ref: string): `/${string}` {
  const parsed = apiClient.parseInput(notificationFeedDestinationParamsSchema, {
    ref,
  });
  return `/api/v1/notifications/feed/${parsed.ref}/destination`;
}

function chatChannelPath(channelId: string): `/${string}` {
  const parsed = apiClient.parseInput(chatChannelParamsSchema, { channelId });
  return `/api/v1/notifications/chat-channels/${parsed.channelId}`;
}

function chatDeliveryPath(deliveryId: string): `/${string}` {
  const parsed = apiClient.parseInput(chatDeliveryParamsSchema, { deliveryId });
  return `/api/v1/notifications/chat-deliveries/${parsed.deliveryId}`;
}

function chatDeliveriesPath(query: Partial<ChatDeliveriesQuery>): `/${string}` {
  const parsed = apiClient.parseInput(chatDeliveriesQuerySchema, query);
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== undefined) search.set(key, String(value));
  }
  return `/api/v1/notifications/chat-deliveries?${search.toString()}`;
}

/** Browser gateway for durable notification preferences and delivery operations. */
export class NotificationsApi {
  chatChannels(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/notifications/chat-channels",
      schema: chatChannelsResponseSchema,
      signal,
    });
  }

  createChatChannel(input: CreateChatChannelInput) {
    return authenticatedRequestJson({
      path: "/api/v1/notifications/chat-channels",
      method: "POST",
      body: input,
      inputSchema: createChatChannelInputSchema,
      schema: chatChannelMutationResponseSchema,
    });
  }

  updateChatChannel(channelId: string, input: UpdateChatChannelInput) {
    return authenticatedRequestJson({
      path: chatChannelPath(channelId),
      method: "PATCH",
      body: input,
      inputSchema: updateChatChannelInputSchema,
      schema: chatChannelMutationResponseSchema,
    });
  }

  testChatChannel(channelId: string, input: TestChatChannelInput) {
    return authenticatedRequestJson({
      path: `${chatChannelPath(channelId)}/test`,
      method: "POST",
      body: input,
      inputSchema: testChatChannelInputSchema,
      schema: chatChannelTestResponseSchema,
    });
  }

  confirmChatChannel(channelId: string, input: ConfirmChatChannelInput) {
    return authenticatedRequestJson({
      path: `${chatChannelPath(channelId)}/confirm`,
      method: "POST",
      body: input,
      inputSchema: confirmChatChannelInputSchema,
      schema: chatChannelMutationResponseSchema,
    });
  }

  setChatChannelEnabled(channelId: string, input: SetChatChannelEnabledInput) {
    return authenticatedRequestJson({
      path: `${chatChannelPath(channelId)}/enable`,
      method: "PATCH",
      body: input,
      inputSchema: setChatChannelEnabledInputSchema,
      schema: chatChannelMutationResponseSchema,
    });
  }

  chatDeliveries(
    query: Partial<ChatDeliveriesQuery> = {},
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: chatDeliveriesPath(query),
      schema: chatDeliveriesResponseSchema,
      signal,
    });
  }

  retryChatDelivery(deliveryId: string, input: RetryChatDeliveryInput) {
    return authenticatedRequestJson({
      path: `${chatDeliveryPath(deliveryId)}/retry`,
      method: "POST",
      body: input,
      inputSchema: retryChatDeliveryInputSchema,
      schema: chatDeliveryMutationResponseSchema,
    });
  }

  feed(query: Partial<NotificationFeedQuery> = {}, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: feedPath(query),
      schema: notificationFeedResponseSchema,
      signal,
    });
  }

  unreadCount(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/notifications/feed/unread-count",
      schema: notificationFeedUnreadCountResponseSchema,
      signal,
    });
  }

  destination(ref: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: feedDestinationPath(ref),
      schema: notificationFeedDestinationResponseSchema,
      signal,
    });
  }

  markRead(input: MarkNotificationFeedReadInput) {
    return authenticatedRequestJson({
      path: "/api/v1/notifications/feed/mark-read",
      method: "POST",
      body: input,
      inputSchema: markNotificationFeedReadInputSchema,
      schema: markNotificationFeedReadResponseSchema,
    });
  }

  preferences(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/notifications/preferences",
      schema: notificationPreferencesResponseSchema,
      signal,
    });
  }

  updatePreferences(input: UpdateNotificationPreferencesInput) {
    return authenticatedRequestJson({
      path: "/api/v1/notifications/preferences",
      method: "PATCH",
      body: input,
      inputSchema: updateNotificationPreferencesInputSchema,
      schema: notificationPreferencesResponseSchema,
    });
  }

  criticalRoute(userId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: criticalRoutePath(userId),
      schema: notificationCriticalRouteResponseSchema,
      signal,
    });
  }

  updateCriticalRoute(
    userId: string,
    input: UpdateNotificationCriticalRouteInput,
  ) {
    return authenticatedRequestJson({
      path: criticalRoutePath(userId),
      method: "PATCH",
      body: input,
      inputSchema: updateNotificationCriticalRouteInputSchema,
      schema: notificationCriticalRouteResponseSchema,
    });
  }

  deliveries(
    query: Partial<NotificationDeliveriesQuery> = {},
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: queryPath(query),
      schema: notificationDeliveriesResponseSchema,
      signal,
    });
  }

  retryDelivery(deliveryRef: string, input: RetryNotificationDeliveryInput) {
    return authenticatedRequestJson({
      path: deliveryPath(deliveryRef),
      method: "POST",
      body: input,
      inputSchema: retryNotificationDeliveryInputSchema,
      schema: notificationDeliveryMutationResponseSchema,
    });
  }
}

export const notificationsApi = Object.freeze(new NotificationsApi());
