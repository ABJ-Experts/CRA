import {
  notificationCriticalRouteParamsSchema,
  notificationCriticalRouteResponseSchema,
  notificationDeliveriesQuerySchema,
  notificationDeliveriesResponseSchema,
  notificationDeliveryMutationResponseSchema,
  notificationDeliveryParamsSchema,
  notificationPreferencesResponseSchema,
  retryNotificationDeliveryInputSchema,
  updateNotificationCriticalRouteInputSchema,
  updateNotificationPreferencesInputSchema,
} from "@repo/contracts/notifications";
import type {
  NotificationDeliveriesQuery,
  RetryNotificationDeliveryInput,
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

/** Browser gateway for durable notification preferences and delivery operations. */
export class NotificationsApi {
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
