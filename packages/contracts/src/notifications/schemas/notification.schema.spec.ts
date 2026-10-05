import { describe, expect, it } from "vitest";

import {
  notificationCriticalRouteParamsSchema,
  notificationCriticalRouteResponseSchema,
  notificationDeliveriesQuerySchema,
  notificationDeliveriesResponseSchema,
  notificationDeliveryMutationResponseSchema,
  notificationDeliveryParamsSchema,
  notificationPreferencesResponseSchema,
  notificationFeedQuerySchema,
  notificationFeedResponseSchema,
  notificationFeedUnreadCountResponseSchema,
  notificationFeedDestinationParamsSchema,
  notificationFeedDestinationResponseSchema,
  markNotificationFeedReadInputSchema,
  markNotificationFeedReadResponseSchema,
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
  it("bounds and validates the personal feed query and item", () => {
    expect(notificationFeedQuerySchema.parse({})).toEqual({
      read: "all",
      limit: 25,
    });
    expect(
      notificationFeedQuerySchema.parse({
        limit: "50",
        category: "evidence",
        severity: "high",
        read: "unread",
      }),
    ).toEqual({
      limit: 50,
      category: "evidence",
      severity: "high",
      read: "unread",
    });
    expect(notificationFeedQuerySchema.safeParse({ limit: "51" }).success).toBe(
      false,
    );
    expect(
      notificationFeedQuerySchema.safeParse({ severity: "urgent" }).success,
    ).toBe(false);
    expect(
      notificationFeedQuerySchema.safeParse({ cursor: "../admin" }).success,
    ).toBe(false);
    expect(
      notificationFeedQuerySchema.safeParse({ unexpected: true }).success,
    ).toBe(false);
    const ref = `m6_${orgId}_event`;
    const item = {
      ref,
      category: "reporting_deadline",
      severity: "critical",
      occurredAt: "2026-10-02T00:00:00Z",
      title: "Reporting deadline",
      summary: "A reporting deadline needs attention.",
      read: false,
      fingerprint: "a".repeat(64),
      sourceState: "available",
      noticeKind: "event",
    };
    expect(
      notificationFeedResponseSchema.safeParse({
        items: [item],
        nextCursor: null,
      }).success,
    ).toBe(true);
    expect(
      notificationFeedResponseSchema.safeParse({
        items: [{ ...item, providerError: "secret" }],
        nextCursor: null,
      }).success,
    ).toBe(false);
    expect(
      notificationFeedUnreadCountResponseSchema.safeParse({ count: 0 }).success,
    ).toBe(true);
    expect(
      notificationFeedUnreadCountResponseSchema.safeParse({ count: -1 })
        .success,
    ).toBe(false);
    expect(
      notificationFeedDestinationParamsSchema.safeParse({ ref }).success,
    ).toBe(true);
    expect(
      notificationFeedDestinationParamsSchema.safeParse({
        ref: "https://evil.test",
      }).success,
    ).toBe(false);
    expect(
      notificationFeedDestinationResponseSchema.safeParse({
        state: "available",
        url: `/products/${orgId}`,
      }).success,
    ).toBe(true);
    expect(
      notificationFeedDestinationResponseSchema.safeParse({
        state: "available",
        url: `/findings?findingId=${orgId}&assessmentId=${userId}`,
      }).success,
    ).toBe(true);
    expect(
      notificationFeedDestinationResponseSchema.safeParse({
        state: "available",
        url: "https://evil.test",
      }).success,
    ).toBe(false);
    expect(
      notificationFeedDestinationResponseSchema.safeParse({
        state: "available",
        url: "/logout",
      }).success,
    ).toBe(false);
    expect(
      notificationFeedDestinationResponseSchema.safeParse({
        state: "unavailable",
        url: "/products/123",
      }).success,
    ).toBe(false);
  });

  it("accepts only bounded unique optimistic mark-read selections", () => {
    const ref = `m6_${orgId}_event`;
    const command = {
      items: [{ ref, expectedFingerprint: "a".repeat(64) }],
      idempotencyKey,
    };
    expect(markNotificationFeedReadInputSchema.safeParse(command).success).toBe(
      true,
    );
    expect(
      markNotificationFeedReadInputSchema.safeParse({ ...command, items: [] })
        .success,
    ).toBe(false);
    expect(
      markNotificationFeedReadInputSchema.safeParse({
        ...command,
        items: [command.items[0], command.items[0]],
      }).success,
    ).toBe(false);
    expect(
      markNotificationFeedReadInputSchema.safeParse({
        ...command,
        items: Array.from({ length: 51 }, (_, index) => ({
          ref: `m6_${String(index).padStart(8, "0")}-0000-4000-8000-000000000001_event`,
          expectedFingerprint: "a".repeat(64),
        })),
      }).success,
    ).toBe(false);
    expect(
      markNotificationFeedReadResponseSchema.safeParse({
        items: [
          { ref, fingerprint: "a".repeat(64), readAt: "2026-10-02T00:00:00Z" },
        ],
        replayed: false,
      }).success,
    ).toBe(true);
  });
  it("accepts only optional category modes and complete local schedules", () => {
    const input = {
      expectedVersion: 1,
      idempotencyKey,
      modes,
      schedule,
    };
    expect(
      updateNotificationPreferencesInputSchema.safeParse(input).success,
    ).toBe(true);
    expect(
      updateNotificationPreferencesInputSchema.safeParse({
        ...input,
        modes: { ...modes, reporting_deadline: "off" },
      }).success,
    ).toBe(false);
    expect(
      updateNotificationPreferencesInputSchema.safeParse({
        ...input,
        schedule: { ...schedule, timezone: "Not a timezone" },
      }).success,
    ).toBe(false);
    expect(
      updateNotificationPreferencesInputSchema.safeParse({
        ...input,
        schedule: { ...schedule, timezone: "Mars/Olympus" },
      }).success,
    ).toBe(false);
    expect(
      updateNotificationPreferencesInputSchema.safeParse({
        ...input,
        schedule: { ...schedule, localTime: "24:00" },
      }).success,
    ).toBe(false);
    expect(
      updateNotificationPreferencesInputSchema.safeParse({
        ...input,
        schedule: { ...schedule, weekday: 0 },
      }).success,
    ).toBe(false);
    expect(
      updateNotificationPreferencesInputSchema.safeParse({
        ...input,
        schedule: { ...schedule, quietHours: { start: "22:00", end: "22:00" } },
      }).success,
    ).toBe(false);
    expect(
      updateNotificationPreferencesInputSchema.safeParse({
        ...input,
        expectedVersion: 0,
      }).success,
    ).toBe(false);
    expect(
      notificationPreferencesResponseSchema.safeParse({
        preferences: {
          organizationId: orgId,
          userId,
          version: 1,
          modes,
          schedule,
        },
      }).success,
    ).toBe(true);
  });

  it("requires a scoped critical alternate recipient without an off switch", () => {
    expect(
      notificationCriticalRouteParamsSchema.safeParse({ userId }).success,
    ).toBe(true);
    expect(
      updateNotificationCriticalRouteInputSchema.safeParse({
        expectedVersion: 1,
        idempotencyKey,
        alternateUserId,
      }).success,
    ).toBe(true);
    expect(
      updateNotificationCriticalRouteInputSchema.safeParse({
        expectedVersion: 1,
        idempotencyKey,
        alternateUserId: null,
      }).success,
    ).toBe(true);
    expect(
      updateNotificationCriticalRouteInputSchema.safeParse({
        expectedVersion: 1,
        idempotencyKey,
        alternateUserId,
        enabled: false,
      }).success,
    ).toBe(false);
    expect(
      notificationCriticalRouteResponseSchema.safeParse({
        route: {
          organizationId: orgId,
          userId,
          alternateUserId: null,
          version: 1,
        },
      }).success,
    ).toBe(true);
  });

  it("bounds delivery filters, opaque references, and optimistic retries", () => {
    expect(notificationDeliveriesQuerySchema.parse({}).limit).toBe(50);
    expect(
      notificationDeliveriesQuerySchema.parse({ limit: "100" }).limit,
    ).toBe(100);
    expect(
      notificationDeliveriesQuerySchema.safeParse({ limit: "101" }).success,
    ).toBe(false);
    expect(
      notificationDeliveriesQuerySchema.safeParse({ status: "sent" }).success,
    ).toBe(false);
    expect(
      notificationDeliveriesQuerySchema.safeParse({
        category: "reporting_deadline",
      }).success,
    ).toBe(true);
    expect(
      notificationDeliveriesQuerySchema.safeParse({ unexpected: "value" })
        .success,
    ).toBe(false);
    expect(
      notificationDeliveryParamsSchema.safeParse({ deliveryRef: "Abc_123-xyz" })
        .success,
    ).toBe(true);
    expect(
      notificationDeliveryParamsSchema.safeParse({ deliveryRef: "../secret" })
        .success,
    ).toBe(false);
    expect(
      retryNotificationDeliveryInputSchema.safeParse({
        expectedVersion: 2,
        idempotencyKey,
      }).success,
    ).toBe(true);
    expect(
      retryNotificationDeliveryInputSchema.safeParse({
        expectedVersion: 0,
        idempotencyKey,
      }).success,
    ).toBe(false);
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
    expect(
      notificationDeliveriesResponseSchema.safeParse({
        rows: [delivery],
        nextCursor: null,
      }).success,
    ).toBe(true);
    expect(
      notificationDeliveryMutationResponseSchema.safeParse({ delivery })
        .success,
    ).toBe(true);
    expect(
      notificationDeliveryMutationResponseSchema.safeParse({
        delivery: { ...delivery, providerResponse: "sensitive response" },
      }).success,
    ).toBe(false);
    expect(
      notificationDeliveryMutationResponseSchema.safeParse({
        delivery: { ...delivery, status: "unknown" },
      }).success,
    ).toBe(false);
  });
});
