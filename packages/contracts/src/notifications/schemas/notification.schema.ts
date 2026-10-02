import { z } from "zod";

import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import { ianaTimezoneSchema } from "../../organizations/schemas/organization-settings.schema.js";
import { utcZDateTimeSchema } from "../../products/schemas/release-market-lifecycle.schema.js";
import { apiErrorSchema } from "../../shared/schemas/http.schema.js";

const versionSchema = z.number().int().positive();
const localTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const opaqueRefSchema = z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/);
const supportedTimezoneSchema = ianaTimezoneSchema.refine(
  (timezone) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
      return true;
    } catch {
      return false;
    }
  },
  { message: "Use a supported IANA timezone" },
);

export const notificationOptionalCategorySchema = z.enum([
  "finding_triage",
  "evidence",
  "supplier_owner",
]);
export const notificationCriticalCategorySchema = z.enum([
  "support_period",
  "reporting_deadline",
]);
export const notificationCategorySchema = z.union([
  notificationOptionalCategorySchema,
  notificationCriticalCategorySchema,
]);
export const notificationModeSchema = z.enum([
  "immediate",
  "daily",
  "weekly",
  "off",
]);
export const notificationDeliveryStatusSchema = z.enum([
  "queued",
  "attempted",
  "failed",
  "exhausted",
  "provider_accepted",
  "delivered",
  "cancelled",
]);

export const notificationModesSchema = z
  .object({
    finding_triage: notificationModeSchema,
    evidence: notificationModeSchema,
    supplier_owner: notificationModeSchema,
  })
  .strict();

export const notificationQuietHoursSchema = z
  .object({ start: localTimeSchema, end: localTimeSchema })
  .strict()
  .refine(({ start, end }) => start !== end, {
    path: ["end"],
    message: "Quiet hours must have different start and end times",
  });

export const notificationScheduleSchema = z
  .object({
    timezone: supportedTimezoneSchema,
    localTime: localTimeSchema,
    weekday: z.number().int().min(1).max(7),
    quietHours: notificationQuietHoursSchema.nullable(),
  })
  .strict();

export const notificationPreferencesSchema = z
  .object({
    organizationId: z.uuid(),
    userId: z.uuid(),
    version: versionSchema,
    modes: notificationModesSchema,
    schedule: notificationScheduleSchema,
  })
  .strict();
export const notificationPreferencesResponseSchema = z
  .object({ preferences: notificationPreferencesSchema })
  .strict();
export const notificationPreferencesMutationResponseSchema =
  notificationPreferencesResponseSchema;
export const updateNotificationPreferencesInputSchema = z
  .object({
    expectedVersion: versionSchema,
    idempotencyKey: idempotencyKeySchema,
    modes: notificationModesSchema,
    schedule: notificationScheduleSchema,
  })
  .strict();

/** Critical routes keep the original accountable user and one alternate. */
export const notificationCriticalRouteSchema = z
  .object({
    organizationId: z.uuid(),
    userId: z.uuid(),
    alternateUserId: z.uuid().nullable(),
    version: versionSchema,
  })
  .strict();
export const notificationCriticalRouteParamsSchema = z
  .object({ userId: z.uuid() })
  .strict();
export const notificationCriticalRouteResponseSchema = z
  .object({ route: notificationCriticalRouteSchema })
  .strict();
export const notificationCriticalRouteMutationResponseSchema =
  notificationCriticalRouteResponseSchema;
export const updateNotificationCriticalRouteInputSchema = z
  .object({
    expectedVersion: versionSchema,
    idempotencyKey: idempotencyKeySchema,
    alternateUserId: z.uuid().nullable(),
  })
  .strict();

export const notificationDeliveryRefSchema = opaqueRefSchema.brand<
  "NotificationDeliveryRef"
>();
export const notificationDeliveryCursorSchema = opaqueRefSchema.brand<
  "NotificationDeliveryCursor"
>();
export const notificationDeliveriesQuerySchema = z
  .object({
    status: notificationDeliveryStatusSchema.optional(),
    category: notificationCategorySchema.optional(),
    recipientUserId: z.uuid().optional(),
    cursor: notificationDeliveryCursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export const notificationDeliveryParamsSchema = z
  .object({ deliveryRef: notificationDeliveryRefSchema })
  .strict();
export const notificationDeliverySchema = z
  .object({
    deliveryRef: notificationDeliveryRefSchema,
    category: notificationCategorySchema,
    status: notificationDeliveryStatusSchema,
    sourceType: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/),
    sourceId: z.uuid(),
    originalRecipientUserId: z.uuid(),
    effectiveRecipientUserId: z.uuid().nullable(),
    attemptCount: z.number().int().nonnegative(),
    lastAttemptAt: utcZDateTimeSchema.nullable(),
    nextAttemptAt: utcZDateTimeSchema.nullable(),
    safeErrorCode: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/).nullable(),
    createdAt: utcZDateTimeSchema,
    updatedAt: utcZDateTimeSchema,
    version: versionSchema,
  })
  .strict();
export const notificationDeliveriesResponseSchema = z
  .object({
    rows: z.array(notificationDeliverySchema).max(100),
    nextCursor: notificationDeliveryCursorSchema.nullable(),
  })
  .strict();
export const notificationDeliveryMutationResponseSchema = z
  .object({ delivery: notificationDeliverySchema })
  .strict();
export const retryNotificationDeliveryInputSchema = z
  .object({
    expectedVersion: versionSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const notificationErrorResponseSchema = apiErrorSchema;
