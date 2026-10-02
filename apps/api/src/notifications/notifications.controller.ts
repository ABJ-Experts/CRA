import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
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
  type NotificationCriticalRouteParams,
  type NotificationDeliveryParams,
} from "@repo/contracts/notifications";
import {
  CurrentUser,
  RequirePermissions,
  RequireRole,
  SelfScoped,
  type RequestUser,
} from "../auth/auth.types";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import {
  zodBody,
  zodParams,
  zodQuery,
} from "../common/pipes/zod-validation.pipe";
import type {
  NotificationDeliveriesQuery,
  NotificationResult,
  RetryNotificationDeliveryInput,
  UpdateNotificationCriticalRouteInput,
  UpdateNotificationPreferencesInput,
} from "./application/notification.port";
import { NotificationsUseCases } from "./application/notifications-use-cases";

/** Preferences and delivery operations always derive scope from the session. */
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsUseCases) {}

  @SelfScoped("A member reads only their own notification preferences.")
  @Get("preferences")
  @ZodResponse(notificationPreferencesResponseSchema)
  preferences(@CurrentUser() user: RequestUser) {
    return unwrapNotification(
      this.notifications.getPreferences(organizationId(user), user.id),
    );
  }

  @SelfScoped("A member updates only their own optional notification modes.")
  @Patch("preferences")
  @ZodResponse(notificationPreferencesResponseSchema)
  updatePreferences(
    @Body(zodBody(updateNotificationPreferencesInputSchema))
    input: UpdateNotificationPreferencesInput,
    @CurrentUser() user: RequestUser,
  ) {
    return unwrapNotification(
      this.notifications.updatePreferences(
        organizationId(user),
        user.id,
        input,
      ),
    );
  }

  @RequireRole("admin")
  @RequirePermissions("can_edit_organization")
  @Get("critical-routes/:userId")
  @ZodResponse(notificationCriticalRouteResponseSchema)
  criticalRoute(
    @Param(zodParams(notificationCriticalRouteParamsSchema))
    params: NotificationCriticalRouteParams,
    @CurrentUser() user: RequestUser,
  ) {
    return unwrapNotification(
      this.notifications.getCriticalRoute(
        organizationId(user),
        user.id,
        params.userId,
      ),
    );
  }

  @RequireRole("admin")
  @RequirePermissions("can_edit_organization")
  @Patch("critical-routes/:userId")
  @ZodResponse(notificationCriticalRouteResponseSchema)
  updateCriticalRoute(
    @Param(zodParams(notificationCriticalRouteParamsSchema))
    params: NotificationCriticalRouteParams,
    @Body(zodBody(updateNotificationCriticalRouteInputSchema))
    input: UpdateNotificationCriticalRouteInput,
    @CurrentUser() user: RequestUser,
  ) {
    return unwrapNotification(
      this.notifications.updateCriticalRoute(
        organizationId(user),
        user.id,
        params.userId,
        input,
      ),
    );
  }

  @RequirePermissions("can_view_audit")
  @Get("deliveries")
  @ZodResponse(notificationDeliveriesResponseSchema)
  deliveries(
    @Query(zodQuery(notificationDeliveriesQuerySchema))
    query: NotificationDeliveriesQuery,
    @CurrentUser() user: RequestUser,
  ) {
    return unwrapNotification(
      this.notifications.listDeliveries(organizationId(user), user.id, query),
    );
  }

  @RequirePermissions("can_edit_organization")
  @Post("deliveries/:deliveryRef/retry")
  @ZodResponse(notificationDeliveryMutationResponseSchema)
  retry(
    @Param(zodParams(notificationDeliveryParamsSchema))
    params: NotificationDeliveryParams,
    @Body(zodBody(retryNotificationDeliveryInputSchema))
    input: RetryNotificationDeliveryInput,
    @CurrentUser() user: RequestUser,
  ) {
    return unwrapNotification(
      this.notifications.retryDelivery(
        organizationId(user),
        user.id,
        params.deliveryRef,
        input,
      ),
    );
  }
}

function organizationId(user: RequestUser): string {
  if (user.organizationId) return user.organizationId;
  throw new ForbiddenException({
    message: "An active organization is required.",
    code: "no_organization",
  });
}

export async function unwrapNotification<T>(
  promise: Promise<NotificationResult<T>>,
): Promise<T> {
  let result: NotificationResult<T>;
  try {
    result = await promise;
  } catch {
    throw new ServiceUnavailableException({
      message: "Notifications are temporarily unavailable.",
      code: "unavailable",
    });
  }
  switch (result.outcome) {
    case "found":
    case "updated":
    case "replayed":
      return result.data;
    case "forbidden":
      throw new ForbiddenException({
        message: "You are no longer allowed to access this notification.",
        code: "forbidden",
      });
    case "not_found":
      throw new NotFoundException({
        message: "Notification was not found.",
        code: "not_found",
      });
    case "conflict":
      throw new ConflictException({
        message: "The notification changed. Refresh and retry.",
        code: "conflict",
      });
    case "invalid_request":
      throw new BadRequestException({
        message: "This notification action is not valid.",
        code: "invalid_request",
      });
  }
}
