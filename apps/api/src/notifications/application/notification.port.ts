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
  chatChannelParamsSchema,
  chatChannelMutationResponseSchema,
  chatChannelsResponseSchema,
  createChatChannelInputSchema,
  updateChatChannelInputSchema,
  testChatChannelInputSchema,
  chatChannelTestResponseSchema,
  confirmChatChannelInputSchema,
  setChatChannelEnabledInputSchema,
  chatDeliveriesQuerySchema,
  chatDeliveriesResponseSchema,
  chatDeliveryParamsSchema,
  retryChatDeliveryInputSchema,
  chatDeliveryMutationResponseSchema,
  notificationBurstPolicyResponseSchema,
  updateNotificationBurstPolicyInputSchema,
  notificationGroupedFeedResponseSchema,
  notificationBurstBatchesQuerySchema,
  notificationBurstBatchesResponseSchema,
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
export type NotificationBurstPolicyResponse = z.output<
  typeof notificationBurstPolicyResponseSchema
>;
export type NotificationBurstBatchesQuery = z.output<
  typeof notificationBurstBatchesQuerySchema
>;
export type NotificationBurstBatchesResponse = z.output<
  typeof notificationBurstBatchesResponseSchema
>;
export type UpdateNotificationBurstPolicyInput = z.output<
  typeof updateNotificationBurstPolicyInputSchema
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
export type NotificationGroupedFeedResponse = z.output<
  typeof notificationGroupedFeedResponseSchema
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
export type NotificationChatChannelParams = z.output<
  typeof chatChannelParamsSchema
>;
export type NotificationChatChannelsResponse = z.output<
  typeof chatChannelsResponseSchema
>;
export type NotificationChatChannelResponse = z.output<
  typeof chatChannelMutationResponseSchema
>;
export type CreateNotificationChatChannelInput = z.output<
  typeof createChatChannelInputSchema
>;
export type UpdateNotificationChatChannelInput = z.output<
  typeof updateChatChannelInputSchema
>;
export type TestNotificationChatChannelInput = z.output<
  typeof testChatChannelInputSchema
>;
export type NotificationChatChannelTestResponse = z.output<
  typeof chatChannelTestResponseSchema
>;
export type ConfirmNotificationChatChannelInput = z.output<
  typeof confirmChatChannelInputSchema
>;
export type EnableNotificationChatChannelInput = z.output<
  typeof setChatChannelEnabledInputSchema
>;
export type NotificationChatDeliveriesQuery = z.output<
  typeof chatDeliveriesQuerySchema
>;
export type NotificationChatDeliveriesResponse = z.output<
  typeof chatDeliveriesResponseSchema
>;
export type NotificationChatDeliveryParams = z.output<
  typeof chatDeliveryParamsSchema
>;
export type RetryNotificationChatDeliveryInput = z.output<
  typeof retryChatDeliveryInputSchema
>;
export type NotificationChatDeliveryMutationResponse = z.output<
  typeof chatDeliveryMutationResponseSchema
>;

export type NotificationResult<T> = Readonly<
  | { outcome: "found" | "updated" | "replayed"; data: T }
  | {
      outcome: "not_found" | "forbidden" | "conflict" | "invalid_request";
    }
>;

export interface NotificationRepository {
  listBurstBatches(
    organizationId: string,
    actorId: string,
    query: NotificationBurstBatchesQuery,
  ): Promise<NotificationResult<NotificationBurstBatchesResponse>>;
  getBurstPolicy(
    organizationId: string,
    actorId: string,
  ): Promise<NotificationResult<NotificationBurstPolicyResponse>>;
  updateBurstPolicy(
    organizationId: string,
    actorId: string,
    input: UpdateNotificationBurstPolicyInput,
  ): Promise<NotificationResult<NotificationBurstPolicyResponse>>;
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
  ): Promise<
    NotificationResult<
      NotificationFeedResponse | NotificationGroupedFeedResponse
    >
  >;
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

export interface NotificationChatRepository {
  listChatChannels(
    organizationId: string,
    actorId: string,
  ): Promise<NotificationResult<NotificationChatChannelsResponse>>;
  createChatChannel(
    organizationId: string,
    actorId: string,
    input: CreateNotificationChatChannelInput,
  ): Promise<NotificationResult<NotificationChatChannelResponse>>;
  updateChatChannel(
    organizationId: string,
    actorId: string,
    channelId: string,
    input: UpdateNotificationChatChannelInput,
  ): Promise<NotificationResult<NotificationChatChannelResponse>>;
  testChatChannel(
    organizationId: string,
    actorId: string,
    channelId: string,
    input: TestNotificationChatChannelInput,
  ): Promise<NotificationResult<NotificationChatChannelTestResponse>>;
  confirmChatChannel(
    organizationId: string,
    actorId: string,
    channelId: string,
    input: ConfirmNotificationChatChannelInput,
  ): Promise<NotificationResult<NotificationChatChannelResponse>>;
  enableChatChannel(
    organizationId: string,
    actorId: string,
    channelId: string,
    input: EnableNotificationChatChannelInput,
  ): Promise<NotificationResult<NotificationChatChannelResponse>>;
  listChatDeliveries(
    organizationId: string,
    actorId: string,
    query: NotificationChatDeliveriesQuery,
  ): Promise<NotificationResult<NotificationChatDeliveriesResponse>>;
  retryChatDelivery(
    organizationId: string,
    actorId: string,
    deliveryId: string,
    input: RetryNotificationChatDeliveryInput,
  ): Promise<NotificationResult<NotificationChatDeliveryMutationResponse>>;
}

export type NotificationDataRepository = NotificationRepository &
  NotificationChatRepository;
