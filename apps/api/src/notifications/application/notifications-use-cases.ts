import type {
  NotificationDeliveriesQuery,
  NotificationChatRepository,
  NotificationRepository,
  RetryNotificationDeliveryInput,
  UpdateNotificationCriticalRouteInput,
  UpdateNotificationPreferencesInput,
  NotificationFeedRef,
  NotificationFeedQuery,
  MarkNotificationFeedReadInput,
  CreateNotificationChatChannelInput,
  UpdateNotificationChatChannelInput,
  TestNotificationChatChannelInput,
  ConfirmNotificationChatChannelInput,
  EnableNotificationChatChannelInput,
  NotificationChatDeliveriesQuery,
  RetryNotificationChatDeliveryInput,
  UpdateNotificationBurstPolicyInput,
  NotificationBurstBatchesQuery,
} from "./notification.port";

/** Requests remain tied to the authenticated organization and actor. */
export class NotificationsUseCases {
  constructor(
    private readonly repository: NotificationRepository,
    private readonly chatRepository: NotificationChatRepository,
  ) {}

  listBurstBatches(
    organizationId: string,
    actorId: string,
    query: NotificationBurstBatchesQuery,
  ) {
    return this.repository.listBurstBatches(organizationId, actorId, query);
  }

  getBurstPolicy(organizationId: string, actorId: string) {
    return this.repository.getBurstPolicy(organizationId, actorId);
  }

  updateBurstPolicy(
    organizationId: string,
    actorId: string,
    input: UpdateNotificationBurstPolicyInput,
  ) {
    return this.repository.updateBurstPolicy(organizationId, actorId, input);
  }

  getPreferences(organizationId: string, actorId: string) {
    return this.repository.getPreferences(organizationId, actorId);
  }

  updatePreferences(
    organizationId: string,
    actorId: string,
    input: UpdateNotificationPreferencesInput,
  ) {
    return this.repository.updatePreferences(organizationId, actorId, input);
  }

  getCriticalRoute(organizationId: string, actorId: string, userId: string) {
    return this.repository.getCriticalRoute(organizationId, actorId, userId);
  }

  updateCriticalRoute(
    organizationId: string,
    actorId: string,
    userId: string,
    input: UpdateNotificationCriticalRouteInput,
  ) {
    return this.repository.updateCriticalRoute(
      organizationId,
      actorId,
      userId,
      input,
    );
  }

  listDeliveries(
    organizationId: string,
    actorId: string,
    query: NotificationDeliveriesQuery,
  ) {
    return this.repository.listDeliveries(organizationId, actorId, query);
  }

  retryDelivery(
    organizationId: string,
    actorId: string,
    deliveryRef: string,
    input: RetryNotificationDeliveryInput,
  ) {
    return this.repository.retryDelivery(
      organizationId,
      actorId,
      deliveryRef,
      input,
    );
  }

  listFeed(
    organizationId: string,
    actorId: string,
    query: NotificationFeedQuery,
  ) {
    return this.repository.listFeed(organizationId, actorId, query);
  }

  countFeedUnread(organizationId: string, actorId: string) {
    return this.repository.countFeedUnread(organizationId, actorId);
  }

  resolveFeedDestination(
    organizationId: string,
    actorId: string,
    ref: NotificationFeedRef,
  ) {
    return this.repository.resolveFeedDestination(organizationId, actorId, ref);
  }

  markFeedRead(
    organizationId: string,
    actorId: string,
    input: MarkNotificationFeedReadInput,
  ) {
    return this.repository.markFeedRead(organizationId, actorId, input);
  }

  listChatChannels(organizationId: string, actorId: string) {
    return this.chatRepository.listChatChannels(organizationId, actorId);
  }

  createChatChannel(
    organizationId: string,
    actorId: string,
    input: CreateNotificationChatChannelInput,
  ) {
    return this.chatRepository.createChatChannel(
      organizationId,
      actorId,
      input,
    );
  }

  updateChatChannel(
    organizationId: string,
    actorId: string,
    channelId: string,
    input: UpdateNotificationChatChannelInput,
  ) {
    return this.chatRepository.updateChatChannel(
      organizationId,
      actorId,
      channelId,
      input,
    );
  }

  testChatChannel(
    organizationId: string,
    actorId: string,
    channelId: string,
    input: TestNotificationChatChannelInput,
  ) {
    return this.chatRepository.testChatChannel(
      organizationId,
      actorId,
      channelId,
      input,
    );
  }

  confirmChatChannel(
    organizationId: string,
    actorId: string,
    channelId: string,
    input: ConfirmNotificationChatChannelInput,
  ) {
    return this.chatRepository.confirmChatChannel(
      organizationId,
      actorId,
      channelId,
      input,
    );
  }

  enableChatChannel(
    organizationId: string,
    actorId: string,
    channelId: string,
    input: EnableNotificationChatChannelInput,
  ) {
    return this.chatRepository.enableChatChannel(
      organizationId,
      actorId,
      channelId,
      input,
    );
  }

  listChatDeliveries(
    organizationId: string,
    actorId: string,
    query: NotificationChatDeliveriesQuery,
  ) {
    return this.chatRepository.listChatDeliveries(
      organizationId,
      actorId,
      query,
    );
  }

  retryChatDelivery(
    organizationId: string,
    actorId: string,
    deliveryId: string,
    input: RetryNotificationChatDeliveryInput,
  ) {
    return this.chatRepository.retryChatDelivery(
      organizationId,
      actorId,
      deliveryId,
      input,
    );
  }
}
