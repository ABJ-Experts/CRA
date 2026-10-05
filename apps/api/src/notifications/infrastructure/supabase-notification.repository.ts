import { Injectable } from "@nestjs/common";
import {
  notificationCriticalRouteResponseSchema,
  notificationDeliveriesResponseSchema,
  notificationDeliveryMutationResponseSchema,
  notificationPreferencesResponseSchema,
  notificationFeedResponseSchema,
  notificationGroupedFeedResponseSchema,
  notificationBurstPolicyResponseSchema,
  notificationBurstBatchesResponseSchema,
  notificationFeedUnreadCountResponseSchema,
  notificationFeedDestinationResponseSchema,
  markNotificationFeedReadResponseSchema,
} from "@repo/contracts/notifications";
import { SupabaseService } from "../../supabase/supabase.service";
import type {
  NotificationDeliveriesQuery,
  NotificationRepository,
  NotificationResult,
  RetryNotificationDeliveryInput,
  UpdateNotificationCriticalRouteInput,
  UpdateNotificationPreferencesInput,
  NotificationFeedRef,
  NotificationFeedQuery,
  MarkNotificationFeedReadInput,
  UpdateNotificationBurstPolicyInput,
  NotificationBurstBatchesQuery,
} from "../application/notification.port";

type Rpc = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message?: string } | null }>;
};
type Row = Record<string, unknown>;
type Schema<T> = { parse(value: unknown): T };

/** Service-role calls remain org-first and policy-enforced by scoped SQL RPCs. */
@Injectable()
export class SupabaseNotificationRepository implements NotificationRepository {
  constructor(private readonly supabase: SupabaseService) {}

  listBurstBatches(
    organizationId: string,
    actorId: string,
    query: NotificationBurstBatchesQuery,
  ) {
    return this.call(
      "list_notification_burst_batches_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_cursor: query.cursor ?? null,
        p_limit: query.limit,
      },
      notificationBurstBatchesResponseSchema,
    );
  }

  getBurstPolicy(organizationId: string, actorId: string) {
    return this.call(
      "get_notification_burst_policy_atomic",
      { p_organization_id: organizationId, p_actor_user_id: actorId },
      notificationBurstPolicyResponseSchema,
    );
  }

  updateBurstPolicy(
    organizationId: string,
    actorId: string,
    input: UpdateNotificationBurstPolicyInput,
  ) {
    return this.call(
      "update_notification_burst_policy_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_expected_version: input.expectedVersion,
        p_enabled: input.enabled,
        p_idempotency_key: input.idempotencyKey,
      },
      notificationBurstPolicyResponseSchema,
    );
  }

  getPreferences(organizationId: string, actorId: string) {
    return this.call(
      "get_notification_preferences_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_user_id: actorId,
      },
      notificationPreferencesResponseSchema,
    );
  }

  updatePreferences(
    organizationId: string,
    actorId: string,
    input: UpdateNotificationPreferencesInput,
  ) {
    return this.call(
      "update_notification_preferences_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_user_id: actorId,
        p_expected_version: input.expectedVersion,
        p_modes: input.modes,
        p_schedule: input.schedule,
        p_idempotency_key: input.idempotencyKey,
        p_reason: null,
      },
      notificationPreferencesResponseSchema,
    );
  }

  getCriticalRoute(organizationId: string, actorId: string, userId: string) {
    return this.call(
      "get_critical_notification_route_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_user_id: userId,
      },
      notificationCriticalRouteResponseSchema,
    );
  }

  updateCriticalRoute(
    organizationId: string,
    actorId: string,
    userId: string,
    input: UpdateNotificationCriticalRouteInput,
  ) {
    return this.call(
      "update_critical_notification_route_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_user_id: userId,
        p_expected_version: input.expectedVersion,
        p_alternate_user_id: input.alternateUserId,
        p_idempotency_key: input.idempotencyKey,
      },
      notificationCriticalRouteResponseSchema,
    );
  }

  listDeliveries(
    organizationId: string,
    actorId: string,
    query: NotificationDeliveriesQuery,
  ) {
    return this.call(
      "list_notification_dispatches_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_status: query.status ?? null,
        p_category: query.category ?? null,
        p_recipient_user_id: query.recipientUserId ?? null,
        p_cursor: query.cursor ?? null,
        p_limit: query.limit,
      },
      notificationDeliveriesResponseSchema,
    );
  }

  retryDelivery(
    organizationId: string,
    actorId: string,
    deliveryRef: string,
    input: RetryNotificationDeliveryInput,
  ) {
    return this.call(
      "retry_notification_dispatch_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_delivery_ref: deliveryRef,
        p_expected_version: input.expectedVersion,
        p_idempotency_key: input.idempotencyKey,
      },
      notificationDeliveryMutationResponseSchema,
    );
  }

  listFeed(
    organizationId: string,
    actorId: string,
    query: NotificationFeedQuery,
  ) {
    if (query.view === "grouped") {
      return this.call(
        "list_notification_feed_grouped_atomic",
        {
          p_organization_id: organizationId,
          p_actor_user_id: actorId,
          p_category: query.category ?? null,
          p_severity: query.severity ?? null,
          p_read: query.read,
          p_cursor: query.cursor ?? null,
          p_limit: query.limit,
        },
        notificationGroupedFeedResponseSchema,
      );
    }
    if (query.batchId) {
      return this.call(
        "list_notification_feed_batch_atomic",
        {
          p_organization_id: organizationId,
          p_actor_user_id: actorId,
          p_batch_id: query.batchId,
          p_cursor: query.cursor ?? null,
          p_limit: query.limit,
        },
        notificationFeedResponseSchema,
      );
    }
    if (query.eventClass && query.windowStart) {
      return this.call(
        "list_notification_feed_cohort_atomic",
        {
          p_organization_id: organizationId,
          p_actor_user_id: actorId,
          p_event_class: query.eventClass,
          p_window_start: query.windowStart,
          p_cursor: query.cursor ?? null,
          p_limit: query.limit,
        },
        notificationFeedResponseSchema,
      );
    }
    return this.call(
      "list_notification_feed_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_category: query.category ?? null,
        p_severity: query.severity ?? null,
        p_read: query.read,
        p_cursor: query.cursor ?? null,
        p_limit: query.limit,
      },
      notificationFeedResponseSchema,
    );
  }

  countFeedUnread(organizationId: string, actorId: string) {
    return this.call(
      "count_notification_feed_unread_atomic",
      { p_organization_id: organizationId, p_actor_user_id: actorId },
      notificationFeedUnreadCountResponseSchema,
    );
  }

  resolveFeedDestination(
    organizationId: string,
    actorId: string,
    ref: NotificationFeedRef,
  ) {
    return this.call(
      "resolve_notification_feed_destination_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_ref: ref,
      },
      notificationFeedDestinationResponseSchema,
    );
  }

  markFeedRead(
    organizationId: string,
    actorId: string,
    input: MarkNotificationFeedReadInput,
  ) {
    return this.call(
      "mark_notification_feed_read_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_items: input.items,
        p_idempotency_key: input.idempotencyKey,
      },
      markNotificationFeedReadResponseSchema,
    );
  }

  private async call<T>(
    name: string,
    args: Record<string, unknown>,
    schema: Schema<T>,
  ): Promise<NotificationResult<T>> {
    const response = await (this.supabase.admin() as unknown as Rpc).rpc(
      name,
      args,
    );
    if (response.error) throw new Error("Notification storage is unavailable");
    const data: unknown = response.data;
    if (!Array.isArray(data) || data.length !== 1) {
      throw new Error("Notification storage returned an invalid response");
    }
    const row: unknown = (data as unknown[])[0];
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("Notification storage returned an invalid response");
    }
    return parseResult(row as Row, schema);
  }
}

function parseResult<T>(row: Row, schema: Schema<T>): NotificationResult<T> {
  switch (row.outcome) {
    case "found":
    case "updated":
    case "replayed":
      return { outcome: row.outcome, data: schema.parse(row.result) };
    case "queued":
      return { outcome: "updated", data: schema.parse(row.result) };
    case "not_found":
    case "forbidden":
    case "conflict":
    case "invalid_request":
      return { outcome: row.outcome };
    case "invalid_state":
      return { outcome: "invalid_request" };
    case "idempotency_conflict":
      return { outcome: "conflict" };
    default:
      throw new Error("Notification storage returned an invalid outcome");
  }
}
