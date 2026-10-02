import type { z } from "zod";

import type {
  notificationCategorySchema,
  notificationCriticalCategorySchema,
  notificationCriticalRouteMutationResponseSchema,
  notificationCriticalRouteParamsSchema,
  notificationCriticalRouteResponseSchema,
  notificationCriticalRouteSchema,
  notificationDeliveriesQuerySchema,
  notificationDeliveriesResponseSchema,
  notificationDeliveryCursorSchema,
  notificationDeliveryMutationResponseSchema,
  notificationDeliveryParamsSchema,
  notificationDeliveryRefSchema,
  notificationDeliverySchema,
  notificationDeliveryStatusSchema,
  notificationErrorResponseSchema,
  notificationFeedRefSchema,
  notificationFeedCursorSchema,
  notificationFeedSeveritySchema,
  notificationFeedReadFilterSchema,
  notificationFeedQuerySchema,
  notificationFeedDestinationParamsSchema,
  notificationFeedItemSchema,
  notificationFeedResponseSchema,
  notificationFeedUnreadCountResponseSchema,
  notificationFeedDestinationResponseSchema,
  markNotificationFeedReadInputSchema,
  markNotificationFeedReadResponseSchema,
  notificationModeSchema,
  notificationModesSchema,
  notificationOptionalCategorySchema,
  notificationPreferencesMutationResponseSchema,
  notificationPreferencesResponseSchema,
  notificationPreferencesSchema,
  notificationQuietHoursSchema,
  notificationScheduleSchema,
  retryNotificationDeliveryInputSchema,
  updateNotificationCriticalRouteInputSchema,
  updateNotificationPreferencesInputSchema,
} from "../schemas/index.js";

export type NotificationOptionalCategory = z.output<
  typeof notificationOptionalCategorySchema
>;
export type NotificationCriticalCategory = z.output<
  typeof notificationCriticalCategorySchema
>;
export type NotificationCategory = z.output<typeof notificationCategorySchema>;
export type NotificationMode = z.output<typeof notificationModeSchema>;
export type NotificationDeliveryStatus = z.output<
  typeof notificationDeliveryStatusSchema
>;
export type NotificationModes = z.output<typeof notificationModesSchema>;
export type NotificationQuietHours = z.output<
  typeof notificationQuietHoursSchema
>;
export type NotificationSchedule = z.output<typeof notificationScheduleSchema>;
export type NotificationPreferences = z.output<
  typeof notificationPreferencesSchema
>;
export type NotificationPreferencesResponse = z.output<
  typeof notificationPreferencesResponseSchema
>;
export type NotificationPreferencesMutationResponse = z.output<
  typeof notificationPreferencesMutationResponseSchema
>;
export type UpdateNotificationPreferencesInput = z.output<
  typeof updateNotificationPreferencesInputSchema
>;
export type NotificationCriticalRoute = z.output<
  typeof notificationCriticalRouteSchema
>;
export type NotificationCriticalRouteParams = z.output<
  typeof notificationCriticalRouteParamsSchema
>;
export type NotificationCriticalRouteResponse = z.output<
  typeof notificationCriticalRouteResponseSchema
>;
export type NotificationCriticalRouteMutationResponse = z.output<
  typeof notificationCriticalRouteMutationResponseSchema
>;
export type UpdateNotificationCriticalRouteInput = z.output<
  typeof updateNotificationCriticalRouteInputSchema
>;
export type NotificationDeliveryRef = z.output<
  typeof notificationDeliveryRefSchema
>;
export type NotificationDeliveryCursor = z.output<
  typeof notificationDeliveryCursorSchema
>;
export type NotificationDeliveriesQuery = z.output<
  typeof notificationDeliveriesQuerySchema
>;
export type NotificationDeliveryParams = z.output<
  typeof notificationDeliveryParamsSchema
>;
export type NotificationDelivery = z.output<typeof notificationDeliverySchema>;
export type NotificationDeliveriesResponse = z.output<
  typeof notificationDeliveriesResponseSchema
>;
export type NotificationDeliveryMutationResponse = z.output<
  typeof notificationDeliveryMutationResponseSchema
>;
export type RetryNotificationDeliveryInput = z.output<
  typeof retryNotificationDeliveryInputSchema
>;
export type NotificationErrorResponse = z.output<
  typeof notificationErrorResponseSchema
>;
export type NotificationFeedRef = z.output<typeof notificationFeedRefSchema>;
export type NotificationFeedCursor = z.output<
  typeof notificationFeedCursorSchema
>;
export type NotificationFeedSeverity = z.output<
  typeof notificationFeedSeveritySchema
>;
export type NotificationFeedReadFilter = z.output<
  typeof notificationFeedReadFilterSchema
>;
export type NotificationFeedQuery = z.output<
  typeof notificationFeedQuerySchema
>;
export type NotificationFeedDestinationParams = z.output<
  typeof notificationFeedDestinationParamsSchema
>;
export type NotificationFeedItem = z.output<typeof notificationFeedItemSchema>;
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
