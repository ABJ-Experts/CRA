import type {
  NotificationDeliveriesQuery,
  NotificationRepository,
  RetryNotificationDeliveryInput,
  UpdateNotificationCriticalRouteInput,
  UpdateNotificationPreferencesInput,
} from "./notification.port";

/** Requests remain tied to the authenticated organization and actor. */
export class NotificationsUseCases {
  constructor(private readonly repository: NotificationRepository) {}

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
}
