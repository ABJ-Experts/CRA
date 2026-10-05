import { z } from "zod";

import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import { ianaTimezoneSchema } from "../../organizations/schemas/organization-settings.schema.js";
import { utcZDateTimeSchema } from "../../products/schemas/release-market-lifecycle.schema.js";
import { apiErrorSchema } from "../../shared/schemas/http.schema.js";

const versionSchema = z.number().int().positive();
const localTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const opaqueRefSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/);
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

/** The organization opt-in is independently versioned from user preferences. */
export const notificationBurstPolicySchema = z
  .object({
    organizationId: z.uuid(),
    enabled: z.boolean(),
    version: versionSchema,
    enabledAt: utcZDateTimeSchema.nullable(),
    updatedAt: utcZDateTimeSchema,
    windowSeconds: z.literal(120),
    maxEmailMembers: z.literal(100),
  })
  .strict()
  .refine(({ enabled, enabledAt }) => enabled === (enabledAt !== null), {
    path: ["enabledAt"],
    message: "The enabled timestamp must match the current policy state",
  });
export const notificationBurstPolicyResponseSchema = z
  .object({ policy: notificationBurstPolicySchema })
  .strict();
export const updateNotificationBurstPolicyInputSchema = z
  .object({
    enabled: z.boolean(),
    expectedVersion: versionSchema,
    idempotencyKey: idempotencyKeySchema,
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

export const notificationDeliveryRefSchema =
  opaqueRefSchema.brand<"NotificationDeliveryRef">();
export const notificationDeliveryCursorSchema =
  opaqueRefSchema.brand<"NotificationDeliveryCursor">();
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
    sourceType: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9_]*$/),
    sourceId: z.uuid(),
    originalRecipientUserId: z.uuid(),
    effectiveRecipientUserId: z.uuid().nullable(),
    attemptCount: z.number().int().nonnegative(),
    lastAttemptAt: utcZDateTimeSchema.nullable(),
    nextAttemptAt: utcZDateTimeSchema.nullable(),
    safeErrorCode: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9_]*$/)
      .nullable(),
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
export const notificationBurstBatchesQuerySchema = z
  .object({
    cursor: notificationDeliveryCursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(25),
  })
  .strict();
export const notificationBurstBatchSchema = z
  .object({
    batchId: z.uuid(),
    category: notificationOptionalCategorySchema,
    eventClass: z.enum([
      "finding_suppression_expired",
      "finding_sla_breached",
      "evidence_validity_expiring",
      "supplier_owner_escalation",
    ]),
    status: notificationDeliveryStatusSchema,
    windowStartsAt: utcZDateTimeSchema,
    windowEndsAt: utcZDateTimeSchema,
    memberCount: z.number().int().min(2).max(100),
    preparedCount: z.number().int().min(0).max(100),
    attemptCount: z.number().int().nonnegative(),
    lastAttemptAt: utcZDateTimeSchema.nullable(),
    nextAttemptAt: utcZDateTimeSchema.nullable(),
    safeErrorCode: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9_]*$/)
      .nullable(),
    createdAt: utcZDateTimeSchema,
  })
  .strict()
  .refine((batch) => batch.preparedCount <= batch.memberCount, {
    path: ["preparedCount"],
  })
  .refine(
    (batch) =>
      new Date(batch.windowEndsAt).getTime() -
        new Date(batch.windowStartsAt).getTime() ===
      120_000,
    { path: ["windowEndsAt"] },
  );
export const notificationBurstBatchesResponseSchema = z
  .object({
    rows: z.array(notificationBurstBatchSchema).max(50),
    nextCursor: notificationDeliveryCursorSchema.nullable(),
  })
  .strict();
export const retryNotificationDeliveryInputSchema = z
  .object({
    expectedVersion: versionSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

const feedRefPattern =
  /^(?:m2|m5|m6|m8|m9)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_(?:event|failure)$/;
const fingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/);
const feedUuidPattern =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const trustedFeedRoutePattern = new RegExp(
  `^/(?:products/${feedUuidPattern}(?:/evidence\\?documentId=${feedUuidPattern}&versionId=${feedUuidPattern})?|findings\\?findingId=${feedUuidPattern}(?:&assessmentId=${feedUuidPattern})?|reporting\\?obligationId=${feedUuidPattern}&stageId=${feedUuidPattern}|suppliers/${feedUuidPattern}\\?requestId=${feedUuidPattern})$`,
);
const localAppUrlSchema = z.string().max(2_048).regex(trustedFeedRoutePattern);
export const trustedNotificationRouteSchema = localAppUrlSchema;

export const notificationFeedRefSchema = z
  .string()
  .regex(feedRefPattern)
  .brand<"NotificationFeedRef">();
export const notificationFeedCursorSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,512}$/)
  .brand<"NotificationFeedCursor">();
export const notificationFeedSeveritySchema = z.enum([
  "info",
  "warning",
  "high",
  "critical",
]);
export const notificationFeedReadFilterSchema = z.enum([
  "all",
  "read",
  "unread",
]);
export const notificationBurstEventClassSchema = z.enum([
  "finding_suppression_expired",
  "finding_sla_breached",
  "evidence_validity_expiring",
  "supplier_owner_escalation",
]);
export const notificationFeedViewSchema = z.enum(["events", "grouped"]);
export const notificationFeedQuerySchema = z
  .object({
    view: notificationFeedViewSchema.optional(),
    batchId: z.uuid().optional(),
    eventClass: notificationBurstEventClassSchema.optional(),
    windowStart: utcZDateTimeSchema.optional(),
    category: notificationCategorySchema.optional(),
    severity: notificationFeedSeveritySchema.optional(),
    read: notificationFeedReadFilterSchema.default("all"),
    cursor: notificationFeedCursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(25),
  })
  .strict()
  .superRefine(
    (
      { view, batchId, eventClass, windowStart, category, severity, read },
      context,
    ) => {
      if (view === "grouped" && (batchId || eventClass || windowStart)) {
        context.addIssue({
          code: "custom",
          path: ["view"],
          message: "Grouped view cannot be filtered to a single batch",
        });
      }
      if ((eventClass === undefined) !== (windowStart === undefined)) {
        context.addIssue({
          code: "custom",
          path: [eventClass === undefined ? "eventClass" : "windowStart"],
          message: "Event class and window start must be provided together",
        });
      }
      if (batchId && (eventClass || windowStart)) {
        context.addIssue({
          code: "custom",
          path: ["batchId"],
          message: "Choose a batch ID or an event window",
        });
      }
      if (
        (batchId || eventClass || windowStart) &&
        (category || severity || read !== "all")
      ) {
        context.addIssue({
          code: "custom",
          message: "Filtered cohorts cannot use additional feed filters",
        });
      }
    },
  );

/** Only scoped inbox cohort URLs may be emitted by a summary or email batch. */
export const trustedNotificationInboxUrlSchema = z
  .string()
  .max(2_048)
  .refine((value) => {
    const batchMatch = /^\/notifications\?batchId=([0-9a-f-]+)$/.exec(value);
    if (batchMatch) return z.uuid().safeParse(batchMatch[1]).success;
    const groupMatch =
      /^\/notifications\?eventClass=([a-z_]+)&windowStart=([0-9TZ:.-]+)$/.exec(
        value,
      );
    return Boolean(
      groupMatch &&
      notificationBurstEventClassSchema.safeParse(groupMatch[1]).success &&
      utcZDateTimeSchema.safeParse(groupMatch[2]).success,
    );
  }, "Use a filtered notification inbox URL");
export const notificationFeedDestinationParamsSchema = z
  .object({ ref: notificationFeedRefSchema })
  .strict();
export const notificationFeedItemSchema = z
  .object({
    ref: notificationFeedRefSchema,
    category: notificationCategorySchema,
    severity: notificationFeedSeveritySchema,
    occurredAt: utcZDateTimeSchema,
    title: z.string().trim().min(1).max(500),
    summary: z.string().trim().min(1).max(1_000),
    read: z.boolean(),
    fingerprint: fingerprintSchema,
    sourceState: z.enum(["available", "unavailable"]),
    noticeKind: z.enum(["event", "failure"]),
  })
  .strict();
export const notificationFeedResponseSchema = z
  .object({
    items: z.array(notificationFeedItemSchema).max(50),
    nextCursor: notificationFeedCursorSchema.nullable(),
  })
  .strict();
export const notificationGroupedFeedBatchItemSchema = z
  .object({
    kind: z.literal("batch"),
    eventClass: notificationBurstEventClassSchema,
    category: notificationOptionalCategorySchema,
    severity: z.enum(["info", "warning"]),
    occurredAt: utcZDateTimeSchema,
    windowStartsAt: utcZDateTimeSchema,
    windowEndsAt: utcZDateTimeSchema,
    title: z.string().trim().min(1).max(500),
    summary: z.string().trim().min(1).max(1_000),
    visibleCount: z.number().int().positive(),
    unreadCount: z.number().int().nonnegative(),
    previewCount: z.number().int().min(0).max(5),
    previewTruncated: z.boolean(),
    previewItems: z
      .array(
        z
          .object({
            ref: notificationFeedRefSchema,
            title: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .max(5),
    url: trustedNotificationInboxUrlSchema,
  })
  .strict()
  .superRefine((item, context) => {
    if (
      Date.parse(item.windowEndsAt) <= Date.parse(item.windowStartsAt) ||
      item.unreadCount > item.visibleCount ||
      item.previewCount !== item.previewItems.length ||
      item.previewCount > item.visibleCount ||
      item.previewTruncated !== item.previewItems.length < item.visibleCount ||
      new Set(item.previewItems.map((preview) => preview.ref)).size !==
        item.previewItems.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Batch window and visible counts must be consistent",
      });
    }
    const groupMatch =
      /^\/notifications\?eventClass=([a-z_]+)&windowStart=([0-9TZ:.-]+)$/.exec(
        item.url,
      );
    if (
      groupMatch?.[1] !== item.eventClass ||
      groupMatch?.[2] !== item.windowStartsAt
    ) {
      context.addIssue({
        code: "custom",
        path: ["url"],
        message: "Batch link must match the visible event window",
      });
    }
  });
export const notificationGroupedFeedItemSchema = z.union([
  notificationFeedItemSchema,
  notificationGroupedFeedBatchItemSchema,
]);
export const notificationGroupedFeedResponseSchema = z
  .object({
    items: z.array(notificationGroupedFeedItemSchema).max(50),
    nextCursor: notificationFeedCursorSchema.nullable(),
  })
  .strict();
export const notificationAnyFeedResponseSchema = z.union([
  notificationFeedResponseSchema,
  notificationGroupedFeedResponseSchema,
]);
export const notificationFeedUnreadCountResponseSchema = z
  .object({ count: z.number().int().nonnegative() })
  .strict();
export const notificationFeedDestinationResponseSchema = z.discriminatedUnion(
  "state",
  [
    z
      .object({ state: z.literal("available"), url: localAppUrlSchema })
      .strict(),
    z.object({ state: z.literal("unavailable"), url: z.null() }).strict(),
  ],
);
export const markNotificationFeedReadInputSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            ref: notificationFeedRefSchema,
            expectedFingerprint: fingerprintSchema,
          })
          .strict(),
      )
      .min(1)
      .max(50)
      .refine(
        (items) => new Set(items.map((item) => item.ref)).size === items.length,
        { message: "Select each notification only once" },
      ),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const markNotificationFeedReadResponseSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            ref: notificationFeedRefSchema,
            fingerprint: fingerprintSchema,
            readAt: utcZDateTimeSchema,
          })
          .strict(),
      )
      .min(1)
      .max(50),
    replayed: z.boolean(),
  })
  .strict();
export const notificationErrorResponseSchema = apiErrorSchema;
