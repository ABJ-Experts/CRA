import { afterEach, describe, expect, it, vi } from "vitest";
import { notificationFeedRefSchema } from "@repo/contracts/notifications";

import { notificationsApi } from "./notifications.api";

const userId = "11111111-1111-4111-8111-111111111111";
const alternateUserId = "22222222-2222-4222-8222-222222222222";
const idempotencyKey = "33333333-3333-4333-8333-333333333333";
const deliveryRef = "delivery_123";
const feedRef = notificationFeedRefSchema.parse(
  "m6_55555555-5555-4555-8555-555555555555_event",
);
const fingerprint = "a".repeat(64);
const safeReportingPath =
  "/reporting?obligationId=66666666-6666-4666-8666-666666666666&stageId=77777777-7777-4777-8777-777777777777";

const preferences = {
  organizationId: "44444444-4444-4444-8444-444444444444",
  userId,
  version: 1,
  modes: {
    finding_triage: "immediate",
    evidence: "daily",
    supplier_owner: "off",
  },
  schedule: {
    timezone: "Asia/Kolkata",
    localTime: "09:00",
    weekday: 1,
    quietHours: { start: "22:00", end: "07:00" },
  },
} as const;

const delivery = {
  deliveryRef,
  category: "support_period",
  status: "failed",
  sourceType: "product_release",
  sourceId: "55555555-5555-4555-8555-555555555555",
  originalRecipientUserId: userId,
  effectiveRecipientUserId: alternateUserId,
  attemptCount: 2,
  lastAttemptAt: "2026-10-01T10:00:00.000Z",
  nextAttemptAt: "2026-10-01T11:00:00.000Z",
  safeErrorCode: "provider_unavailable",
  createdAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
  version: 2,
} as const;

describe("notificationsApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses parsed preference and critical-route boundaries", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/preferences")) {
        return new Response(JSON.stringify({ preferences }), { status: 200 });
      }
      expect(init?.method).toBe("PATCH");
      return new Response(
        JSON.stringify({
          route: {
            organizationId: preferences.organizationId,
            userId,
            alternateUserId,
            version: 2,
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetcher);

    await expect(notificationsApi.preferences()).resolves.toEqual({
      preferences,
    });
    await expect(
      notificationsApi.updateCriticalRoute(userId, {
        expectedVersion: 1,
        idempotencyKey,
        alternateUserId,
      }),
    ).resolves.toMatchObject({
      route: { userId, alternateUserId, version: 2 },
    });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/notifications/preferences",
      `/api/v1/notifications/critical-routes/${userId}`,
    ]);
  });

  it("rejects invalid inputs before transport", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    expect(() => notificationsApi.criticalRoute("bad")).toThrow();
    await expect(
      notificationsApi.updatePreferences({
        expectedVersion: 1,
        idempotencyKey: "bad",
        modes: preferences.modes,
        schedule: preferences.schedule,
      }),
    ).rejects.toThrow();
    expect(() =>
      notificationsApi.retryDelivery("../secret", {
        expectedVersion: 2,
        idempotencyKey,
      }),
    ).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("filters delivery history and retries without refresh replay", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith("/api/v1/notifications/deliveries?")) {
        return new Response(
          JSON.stringify({ rows: [delivery], nextCursor: null }),
          { status: 200 },
        );
      }
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({ delivery }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetcher);

    await notificationsApi.deliveries({
      status: "failed",
      category: "support_period",
      limit: 25,
    });
    await notificationsApi.retryDelivery(deliveryRef, {
      expectedVersion: 2,
      idempotencyKey,
    });

    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/v1/notifications/deliveries?status=failed&category=support_period&limit=25",
      `/api/v1/notifications/deliveries/${deliveryRef}/retry`,
    ]);
  });

  it("parses feed reads, validates references, and never replays mark-read after refresh", async () => {
    const item = {
      ref: feedRef,
      category: "reporting_deadline",
      severity: "critical",
      occurredAt: "2026-10-01T10:00:00.000Z",
      title: "Reporting deadline",
      summary: "A regulatory deadline needs attention.",
      read: false,
      fingerprint,
      sourceState: "available",
      noticeKind: "event",
    };
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith("/api/v1/notifications/feed?")) {
        return new Response(
          JSON.stringify({ items: [item], nextCursor: null }),
        );
      }
      if (String(url).endsWith("/unread-count")) {
        return new Response(JSON.stringify({ count: 1 }));
      }
      if (String(url).endsWith("/destination")) {
        return new Response(
          JSON.stringify({ state: "available", url: safeReportingPath }),
        );
      }
      expect(init?.method).toBe("POST");
      return new Response(
        JSON.stringify({
          items: [
            { ref: feedRef, fingerprint, readAt: "2026-10-01T10:05:00.000Z" },
          ],
          replayed: false,
        }),
      );
    });
    vi.stubGlobal("fetch", fetcher);

    await expect(
      notificationsApi.feed({ read: "unread", limit: 25 }),
    ).resolves.toMatchObject({ items: [item] });
    await expect(notificationsApi.unreadCount()).resolves.toEqual({ count: 1 });
    await expect(notificationsApi.destination(feedRef)).resolves.toEqual({
      state: "available",
      url: safeReportingPath,
    });
    await expect(
      notificationsApi.markRead({
        items: [{ ref: feedRef, expectedFingerprint: fingerprint }],
        idempotencyKey,
      }),
    ).resolves.toMatchObject({ replayed: false });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/v1/notifications/feed?read=unread&limit=25",
      "/api/v1/notifications/feed/unread-count",
      `/api/v1/notifications/feed/${feedRef}/destination`,
      "/api/v1/notifications/feed/mark-read",
    ]);
    expect(() => notificationsApi.destination("javascript:alert(1)")).toThrow();
    await expect(
      notificationsApi.markRead({ items: [], idempotencyKey }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("validates chat channel commands before sending and parses safe channel responses", async () => {
    const channel = {
      id: "77777777-7777-4777-8777-777777777777",
      organizationId: preferences.organizationId,
      mode: "slack_webhook",
      displayName: "Operations",
      eventClasses: ["high_severity_alert"],
      productIds: ["88888888-8888-4888-8888-888888888888"],
      includeOrganizationWide: false,
      enabled: false,
      verified: false,
      safeErrorCode: null,
      version: 1,
      createdAt: "2026-10-02T10:00:00.000Z",
      updatedAt: "2026-10-02T10:00:00.000Z",
    } as const;
    const fetcher = vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith("/chat-channels") && !url.includes("?")
              ? { channel }
              : { channels: [channel] },
          ),
        ),
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(
      notificationsApi.createChatChannel({
        displayName: "Operations",
        eventClasses: ["high_severity_alert"],
        productIds: [...channel.productIds],
        includeOrganizationWide: false,
        destination: {
          mode: "slack_webhook",
          webhookUrl: "https://hooks.slack.com/services/T/B/SECRET",
        },
        idempotencyKey,
      }),
    ).resolves.toMatchObject({ channel: { id: channel.id } });
    await expect(notificationsApi.chatChannels()).rejects.toThrow();
    expect(() =>
      notificationsApi.testChatChannel("../escape", {
        expectedVersion: 1,
        idempotencyKey,
      }),
    ).toThrow();
    await expect(
      notificationsApi.createChatChannel({
        displayName: "Operations",
        eventClasses: ["high_severity_alert"],
        productIds: [...channel.productIds],
        includeOrganizationWide: false,
        destination: {
          mode: "slack_webhook",
          webhookUrl: "http://127.0.0.1/private",
        },
        idempotencyKey,
      }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("uses parsed chat test, confirmation, enable, history, and retry boundaries", async () => {
    const channelId = "77777777-7777-4777-8777-777777777777";
    const chatDeliveryId = "88888888-8888-4888-8888-888888888888";
    const productId = "99999999-9999-4999-8999-999999999999";
    const testId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const channel = {
      id: channelId,
      organizationId: preferences.organizationId,
      mode: "slack_webhook",
      displayName: "Operations",
      eventClasses: ["high_severity_alert"],
      productIds: [productId],
      includeOrganizationWide: false,
      enabled: false,
      verified: true,
      safeErrorCode: null,
      version: 2,
      createdAt: "2026-10-02T10:00:00.000Z",
      updatedAt: "2026-10-02T10:00:00.000Z",
    };
    const chatDelivery = {
      id: chatDeliveryId,
      channelId,
      eventClass: "high_severity_alert",
      status: "exhausted",
      sourceType: "finding_assessment",
      sourceId: productId,
      sourceRevision: "2",
      attemptCount: 6,
      lastAttemptAt: "2026-10-02T10:00:00.000Z",
      nextAttemptAt: null,
      safeErrorCode: "vendor_unavailable",
      createdAt: "2026-10-02T09:00:00.000Z",
      updatedAt: "2026-10-02T10:00:00.000Z",
      version: 3,
    };
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      const body = path.endsWith("/test")
        ? {
            testId,
            expiresAt: "2026-10-02T10:15:00.000Z",
            status: "provider_accepted",
          }
        : path.startsWith("/api/v1/notifications/chat-deliveries?")
          ? { rows: [chatDelivery], nextCursor: null }
          : path.endsWith("/retry")
            ? { delivery: chatDelivery }
            : path.endsWith("/chat-channels") && init?.method === "GET"
              ? { channels: [channel] }
              : { channel };
      return new Response(JSON.stringify(body));
    });
    vi.stubGlobal("fetch", fetcher);

    await expect(notificationsApi.chatChannels()).resolves.toEqual({
      channels: [channel],
    });
    await expect(
      notificationsApi.updateChatChannel(channelId, {
        expectedVersion: 1,
        idempotencyKey,
        displayName: "Operations",
        eventClasses: ["high_severity_alert"],
        productIds: [productId],
        includeOrganizationWide: false,
      }),
    ).resolves.toEqual({ channel });
    await expect(
      notificationsApi.testChatChannel(channelId, {
        expectedVersion: 2,
        idempotencyKey,
      }),
    ).resolves.toMatchObject({ testId, status: "provider_accepted" });
    await expect(
      notificationsApi.confirmChatChannel(channelId, {
        expectedVersion: 2,
        idempotencyKey,
        testId,
        code: "123456",
      }),
    ).resolves.toEqual({ channel });
    await expect(
      notificationsApi.setChatChannelEnabled(channelId, {
        expectedVersion: 2,
        idempotencyKey,
        enabled: true,
      }),
    ).resolves.toEqual({ channel });
    await expect(
      notificationsApi.chatDeliveries({ status: "exhausted", limit: 25 }),
    ).resolves.toMatchObject({ rows: [chatDelivery] });
    await expect(
      notificationsApi.retryChatDelivery(chatDeliveryId, {
        expectedVersion: 3,
        idempotencyKey,
      }),
    ).resolves.toEqual({ delivery: chatDelivery });
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/v1/notifications/chat-channels",
      `/api/v1/notifications/chat-channels/${channelId}`,
      `/api/v1/notifications/chat-channels/${channelId}/test`,
      `/api/v1/notifications/chat-channels/${channelId}/confirm`,
      `/api/v1/notifications/chat-channels/${channelId}/enable`,
      "/api/v1/notifications/chat-deliveries?limit=25&status=exhausted",
      `/api/v1/notifications/chat-deliveries/${chatDeliveryId}/retry`,
    ]);
  });
});
