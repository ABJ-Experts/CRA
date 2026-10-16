import { z } from "zod";

import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import { utcZDateTimeSchema } from "../../products/schemas/release-market-lifecycle.schema.js";

const versionSchema = z.number().int().positive();
const safeCodeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/);
const uniqueIdsSchema = z
  .array(z.uuid())
  .max(100)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    "Select each product once",
  );
const publicHttpsUrlSchema = z
  .string()
  .trim()
  .min(8)
  .max(2_048)
  .refine(
    (value) => /^https:\/\/[^/?#@:]+(?:[/?][^#]*)?$/i.test(value),
    "Use an HTTPS hostname without credentials, port or fragment",
  )
  .pipe(
    z.url({
      protocol: /^https$/,
      hostname:
        /^(?!.*(?:^|\.)localhost$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?$/i,
    }),
  )
  .pipe(z.string().max(2_048));

export const chatChannelModeSchema = z.enum([
  "slack_webhook",
  "slack_bot",
  "teams_workflow_webhook",
  "teams_bot_proactive",
]);
export const chatEventClassSchema = z.enum([
  "high_severity_alert",
  "countdown_warning",
  "approval_prompt",
]);
export const chatDeliveryStatusSchema = z.enum([
  "queued",
  "attempted",
  "failed",
  "exhausted",
  "provider_accepted",
  "uncertain",
  "cancelled",
]);
export const chatEventClassesSchema = z
  .array(chatEventClassSchema)
  .min(1)
  .max(3)
  .refine(
    (classes) => new Set(classes).size === classes.length,
    "Select each event class once",
  );

export const chatDestinationInputSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("slack_webhook"),
      webhookUrl: publicHttpsUrlSchema.refine(
        (value) => /^https:\/\/hooks\.slack\.com(?:[/?]|$)/i.test(value),
        "Use a Slack incoming webhook URL",
      ),
    })
    .strict(),
  z
    .object({
      mode: z.literal("slack_bot"),
      botToken: z
        .string()
        .trim()
        .min(12)
        .max(512)
        .regex(/^xoxb-[A-Za-z0-9-]+$/),
      channelId: z
        .string()
        .trim()
        .regex(/^[CGD][A-Z0-9]{8,25}$/),
    })
    .strict(),
  z
    .object({
      mode: z.literal("teams_workflow_webhook"),
      webhookUrl: publicHttpsUrlSchema,
    })
    .strict(),
  z
    .object({
      mode: z.literal("teams_bot_proactive"),
      tenantId: z.uuid(),
      appId: z.uuid(),
      clientSecret: z.string().trim().min(8).max(2_048),
      serviceUrl: publicHttpsUrlSchema,
      conversationId: z.string().trim().min(1).max(512),
    })
    .strict(),
]);

const channelConfigSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(
        /^[\p{L}\p{N} &().,_-]+$/u,
        "Use a single-line name without mentions or markup",
      ),
    eventClasses: chatEventClassesSchema,
    productIds: uniqueIdsSchema,
    includeOrganizationWide: z.boolean().default(false),
  })
  .strict();
const hasExplicitScope = (value: {
  productIds: readonly string[];
  includeOrganizationWide: boolean;
}) => value.productIds.length > 0 || value.includeOrganizationWide;
const mutationFieldsSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
});

export const createChatChannelInputSchema = channelConfigSchema
  .extend({
    destination: chatDestinationInputSchema,
    ...mutationFieldsSchema.shape,
  })
  .refine(hasExplicitScope, {
    path: ["productIds"],
    message: "Select a product or organization-wide deadline alerts",
  });
export const updateChatChannelInputSchema = channelConfigSchema
  .extend({
    expectedVersion: versionSchema,
    destination: chatDestinationInputSchema.optional(),
    ...mutationFieldsSchema.shape,
  })
  .refine(hasExplicitScope, {
    path: ["productIds"],
    message: "Select a product or organization-wide deadline alerts",
  });
export const chatChannelParamsSchema = z
  .object({ channelId: z.uuid() })
  .strict();
export const testChatChannelInputSchema = z
  .object({ expectedVersion: versionSchema, ...mutationFieldsSchema.shape })
  .strict();
export const confirmChatChannelInputSchema = z
  .object({
    expectedVersion: versionSchema,
    testId: z.uuid(),
    code: z.string().regex(/^\d{6}$/),
    ...mutationFieldsSchema.shape,
  })
  .strict();
export const setChatChannelEnabledInputSchema = z
  .object({
    expectedVersion: versionSchema,
    enabled: z.boolean(),
    ...mutationFieldsSchema.shape,
  })
  .strict();

export const chatChannelSchema = channelConfigSchema
  .extend({
    id: z.uuid(),
    organizationId: z.uuid(),
    mode: chatChannelModeSchema,
    enabled: z.boolean(),
    verified: z.boolean(),
    safeErrorCode: safeCodeSchema.nullable(),
    version: versionSchema,
    createdAt: utcZDateTimeSchema,
    updatedAt: utcZDateTimeSchema,
    includeOrganizationWide: z.boolean(),
  })
  .refine(hasExplicitScope, { path: ["productIds"] });
export const chatChannelsResponseSchema = z
  .object({ channels: z.array(chatChannelSchema).max(100) })
  .strict();
export const chatChannelMutationResponseSchema = z
  .object({ channel: chatChannelSchema })
  .strict();
export const chatChannelTestResponseSchema = z
  .object({
    testId: z.uuid(),
    expiresAt: utcZDateTimeSchema,
    status: z.literal("provider_accepted"),
  })
  .strict();

const cursorSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/);
export const chatDeliveriesQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(25),
    cursor: cursorSchema.optional(),
    status: chatDeliveryStatusSchema.optional(),
    eventClass: chatEventClassSchema.optional(),
    channelId: z.uuid().optional(),
  })
  .strict();
export const chatDeliveryParamsSchema = z
  .object({ deliveryId: z.uuid() })
  .strict();
export const chatDeliverySchema = z
  .object({
    id: z.uuid(),
    channelId: z.uuid(),
    eventClass: chatEventClassSchema,
    status: chatDeliveryStatusSchema,
    sourceType: safeCodeSchema,
    sourceId: z.uuid(),
    sourceRevision: z.string().min(1).max(128),
    attemptCount: z.number().int().nonnegative(),
    lastAttemptAt: utcZDateTimeSchema.nullable(),
    nextAttemptAt: utcZDateTimeSchema.nullable(),
    safeErrorCode: safeCodeSchema.nullable(),
    createdAt: utcZDateTimeSchema,
    updatedAt: utcZDateTimeSchema,
    version: versionSchema,
  })
  .strict();
export const chatDeliveriesResponseSchema = z
  .object({
    rows: z.array(chatDeliverySchema).max(50),
    nextCursor: cursorSchema.nullable(),
  })
  .strict();
export const chatDeliveryMutationResponseSchema = z
  .object({ delivery: chatDeliverySchema })
  .strict();
export const retryChatDeliveryInputSchema = testChatChannelInputSchema;
