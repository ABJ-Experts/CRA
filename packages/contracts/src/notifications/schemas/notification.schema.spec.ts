import { describe, expect, it } from "vitest";

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
} from "./notification.schema.js";

const orgId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
const alternateUserId = "00000000-0000-4000-8000-000000000003";
const idempotencyKey = "00000000-0000-4000-8000-000000000004";
const modes = {
  finding_triage: "immediate",
  evidence: "daily",
  supplier_owner: "off",
};
const schedule = {
  timezone: "Asia/Kolkata",
  localTime: "09:00",
  weekday: 1,
  quietHours: { start: "22:00", end: "07:00" },
};

describe("notification wire contracts", () => {
  it("accepts only optional category modes and complete local schedules", () => {
    const input = {
      expectedVersion: 1,
      idempotencyKey,
      modes,
      schedule,
    };
    expect(updateNotificationPreferencesInputSchema.safeParse(input).success).toBe(true);
    expect(updateNotificationPreferencesInputSchema.safeParse({
      ...input,
      modes: { ...modes, reporting_deadline: "off" },
    }).success).toBe(false);
    expect(updateNotificationPreferencesInputSchema.safeParse({
      ...input,
      schedule: { ...schedule, timezone: "Not a timezone" },
    }).success).toBe(false);
    expect(updateNotificationPreferencesInputSchema.safeParse({
      ...input,
      schedule: { ...schedule, timezone: "Mars/Olympus" },
    }).success).toBe(false);
    expect(updateNotificationPreferencesInputSchema.safeParse({
      ...input,
      schedule: { ...schedule, localTime: "24:00" },
    }).success).toBe(false);
    expect(updateNotificationPreferencesInputSchema.safeParse({
      ...input,
      schedule: { ...schedule, weekday: 0 },
    }).success).toBe(false);
    expect(updateNotificationPreferencesInputSchema.safeParse({
      ...input,
      schedule: { ...schedule, quietHours: { start: "22:00", end: "22:00" } },
    }).success).toBe(false);
    expect(updateNotificationPreferencesInputSchema.safeParse({
      ...input,
      expectedVersion: 0,
    }).success).toBe(false);
    expect(notificationPreferencesResponseSchema.safeParse({
      preferences: { organizationId: orgId, userId, version: 1, modes, schedule },
    }).success).toBe(true);
  });

  it("requires a scoped critical alternate recipient without an off switch", () => {
    expect(notificationCriticalRouteParamsSchema.safeParse({ userId }).success).toBe(true);
    expect(updateNotificationCriticalRouteInputSchema.safeParse({
      expectedVersion: 1, idempotencyKey, alternateUserId,
    }).success).toBe(true);
    expect(updateNotificationCriticalRouteInputSchema.safeParse({
      expectedVersion: 1, idempotencyKey, alternateUserId: null,
    }).success).toBe(true);
    expect(updateNotificationCriticalRouteInputSchema.safeParse({
      expectedVersion: 1, idempotencyKey, alternateUserId, enabled: false,
    }).success).toBe(false);
    expect(notificationCriticalRouteResponseSchema.safeParse({
      route: { organizationId: orgId, userId, alternateUserId: null, version: 1 },
    }).success).toBe(true);
  });

  it("bounds delivery filters, opaque references, and optimistic retries", () => {
    expect(notificationDeliveriesQuerySchema.parse({}).limit).toBe(50);
    expect(notificationDeliveriesQuerySchema.parse({ limit: "100" }).limit).toBe(100);
    expect(notificationDeliveriesQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(notificationDeliveriesQuerySchema.safeParse({ status: "sent" }).success).toBe(false);
    expect(notificationDeliveriesQuerySchema.safeParse({ category: "reporting_deadline" }).success).toBe(true);
    expect(notificationDeliveriesQuerySchema.safeParse({ unexpected: "value" }).success).toBe(false);
    expect(notificationDeliveryParamsSchema.safeParse({ deliveryRef: "Abc_123-xyz" }).success).toBe(true);
    expect(notificationDeliveryParamsSchema.safeParse({ deliveryRef: "../secret" }).success).toBe(false);
    expect(retryNotificationDeliveryInputSchema.safeParse({ expectedVersion: 2, idempotencyKey }).success).toBe(true);
    expect(retryNotificationDeliveryInputSchema.safeParse({ expectedVersion: 0, idempotencyKey }).success).toBe(false);
  });

  it("parses safe delivery metadata and rejects raw provider details", () => {
    const delivery = {
      deliveryRef: "Abc_123-xyz",
      category: "support_period",
      status: "failed",
      sourceType: "product_release",
      sourceId: orgId,
      originalRecipientUserId: userId,
      effectiveRecipientUserId: alternateUserId,
      attemptCount: 2,
      lastAttemptAt: "2026-10-01T00:00:00Z",
      nextAttemptAt: "2026-10-01T01:00:00Z",
      safeErrorCode: "provider_unavailable",
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-01T00:00:00Z",
      version: 2,
    };
    expect(notificationDeliveriesResponseSchema.safeParse({ rows: [delivery], nextCursor: null }).success).toBe(true);
    expect(notificationDeliveryMutationResponseSchema.safeParse({ delivery }).success).toBe(true);
    expect(notificationDeliveryMutationResponseSchema.safeParse({
      delivery: { ...delivery, providerResponse: "sensitive response" },
    }).success).toBe(false);
    expect(notificationDeliveryMutationResponseSchema.safeParse({
      delivery: { ...delivery, status: "unknown" },
    }).success).toBe(false);
  });
});
