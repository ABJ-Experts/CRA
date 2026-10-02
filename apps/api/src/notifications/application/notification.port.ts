import type { z } from "zod";
import type {
  notificationCriticalRouteResponseSchema,
  notificationDeliveriesQuerySchema,
  notificationDeliveriesResponseSchema,
  notificationDeliveryMutationResponseSchema,
  notificationPreferencesResponseSchema,
  retryNotificationDeliveryInputSchema,
  updateNotificationCriticalRouteInputSchema,
  updateNotificationPreferencesInputSchema,
  notificationFeedRefSchema,
  notificationFeedQuerySchema,
  notificationFeedResponseSchema,
  notificationFeedUnreadCountResponseSchema,
  notificationFeedDestinationResponseSchema,
  markNotificationFeedReadInputSchema,
  markNotificationFeedReadResponseSchema,
} from "@repo/contracts/notifications";

export const NOTIFICATION_REPOSITORY = Symbol("NOTIFICATION_REPOSITORY");

export type NotificationPreferencesResponse = z.output<
  typeof notificationPreferencesResponseSchema
>;
export type NotificationCriticalRouteResponse = z.output<
  typeof notificationCriticalRouteResponseSchema
>;
export type NotificationDeliveriesQuery = z.output<
  typeof notificationDeliveriesQuerySchema
>;
export type NotificationDeliveriesResponse = z.output<
  typeof notificationDeliveriesResponseSchema
>;
export type NotificationDeliveryMutationResponse = z.output<
  typeof notificationDeliveryMutationResponseSchema
>;
export type UpdateNotificationPreferencesInput = z.output<
  typeof updateNotificationPreferencesInputSchema
>;
export type UpdateNotificationCriticalRouteInput = z.output<
  typeof updateNotificationCriticalRouteInputSchema
>;
export type RetryNotificationDeliveryInput = z.output<
  typeof retryNotificationDeliveryInputSchema
>;
export type NotificationFeedRef = z.output<typeof notificationFeedRefSchema>;
export type NotificationFeedQuery = z.output<
  typeof notificationFeedQuerySchema
>;
export type NotificationFeedResponse = z.output<
  typeof notificationFeedResponseSchema
>;
export type NotificationFeedUnreadCountResponse = z.output<
  typeof notificationFeedUnreadCountResponseSchema
>;
export type NotificationFeedDestinationResponse = z.output<
  typeof notificationFeedDestinationResponseSchema
>;
export type MarkNotificationFeedReadInput = z.output<
  typeof markNotificationFeedReadInputSchema
>;
export type MarkNotificationFeedReadResponse = z.output<
  typeof markNotificationFeedReadResponseSchema
>;

export type NotificationResult<T> = Readonly<
  | { outcome: "found" | "updated" | "replayed"; data: T }
  | {
      outcome: "not_found" | "forbidden" | "conflict" | "invalid_request";
    }
>;

export interface NotificationRepository {
  getPreferences(
    organizationId: string,
    actorId: string,
  ): Promise<NotificationResult<NotificationPreferencesResponse>>;
  updatePreferences(
    organizationId: string,
    actorId: string,
    input: UpdateNotificationPreferencesInput,
  ): Promise<NotificationResult<NotificationPreferencesResponse>>;
  getCriticalRoute(
    organizationId: string,
    actorId: string,
    userId: string,
  ): Promise<NotificationResult<NotificationCriticalRouteResponse>>;
  updateCriticalRoute(
    organizationId: string,
    actorId: string,
    userId: string,
    input: UpdateNotificationCriticalRouteInput,
  ): Promise<NotificationResult<NotificationCriticalRouteResponse>>;
  listDeliveries(
    organizationId: string,
    actorId: string,
    query: NotificationDeliveriesQuery,
  ): Promise<NotificationResult<NotificationDeliveriesResponse>>;
  retryDelivery(
    organizationId: string,
    actorId: string,
    deliveryRef: string,
    input: RetryNotificationDeliveryInput,
  ): Promise<NotificationResult<NotificationDeliveryMutationResponse>>;
  listFeed(
    organizationId: string,
    actorId: string,
    query: NotificationFeedQuery,
  ): Promise<NotificationResult<NotificationFeedResponse>>;
  countFeedUnread(
    organizationId: string,
    actorId: string,
  ): Promise<NotificationResult<NotificationFeedUnreadCountResponse>>;
  resolveFeedDestination(
    organizationId: string,
    actorId: string,
    ref: NotificationFeedRef,
  ): Promise<NotificationResult<NotificationFeedDestinationResponse>>;
  markFeedRead(
    organizationId: string,
    actorId: string,
    input: MarkNotificationFeedReadInput,
  ): Promise<NotificationResult<MarkNotificationFeedReadResponse>>;
}
