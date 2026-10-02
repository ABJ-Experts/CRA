import { afterEach, describe, expect, it, vi } from "vitest";

import { notificationsApi } from "./notifications.api";

const userId = "11111111-1111-4111-8111-111111111111";
const alternateUserId = "22222222-2222-4222-8222-222222222222";
const idempotencyKey = "33333333-3333-4333-8333-333333333333";
const deliveryRef = "delivery_123";

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
});
