// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  notificationKeys,
  useNotificationCriticalRouteQuery,
  useNotificationDeliveriesQuery,
  useNotificationPreferencesQuery,
  useRetryNotificationDeliveryMutation,
  useUpdateNotificationCriticalRouteMutation,
  useUpdateNotificationPreferencesMutation,
} from "./notifications.queries";

const userId = "11111111-1111-4111-8111-111111111111";
const alternateUserId = "22222222-2222-4222-8222-222222222222";
const commandId = "33333333-3333-4333-8333-333333333333";

const scope = vi.hoisted(() => ({
  organizationId: "org-a" as string | null,
  userId: "user-a" as string | null,
  permissions: { can_view_audit: true },
}));

const api = vi.hoisted(() => ({
  preferences: vi.fn(async () => ({ preferences: { version: 1 } })),
  deliveries: vi.fn(async () => ({ rows: [], nextCursor: null })),
  criticalRoute: vi.fn(async () => ({ route: { version: 1 } })),
  updatePreferences: vi.fn(async () => ({ preferences: { version: 2 } })),
  updateCriticalRoute: vi.fn(async () => ({ route: { version: 2 } })),
  retryDelivery: vi.fn(async () => ({ delivery: { version: 2 } })),
}));

vi.mock("../../_providers/session-provider", () => ({
  useSession: () => ({
    session:
      scope.organizationId && scope.userId
        ? {
            organization: { id: scope.organizationId },
            user: { id: scope.userId },
          }
        : null,
    permissions: scope.permissions,
  }),
}));

vi.mock("./notifications.api", () => ({ notificationsApi: api }));

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  scope.organizationId = "org-a";
  scope.userId = "user-a";
  scope.permissions = { can_view_audit: true };
});

describe("notification query scope", () => {
  it("does not fetch without session scope or when the caller disables a query", () => {
    const { client, wrapper } = setup();
    scope.organizationId = null;
    scope.userId = null;
    renderHook(
      () => [
        useNotificationPreferencesQuery(),
        useNotificationDeliveriesQuery({ status: "failed" }),
        useNotificationCriticalRouteQuery(userId),
      ],
      { wrapper },
    );
    expect(api.preferences).not.toHaveBeenCalled();
    expect(api.deliveries).not.toHaveBeenCalled();
    expect(api.criticalRoute).not.toHaveBeenCalled();

    scope.organizationId = "org-a";
    scope.userId = "user-a";
    renderHook(
      () => [
        useNotificationPreferencesQuery(false),
        useNotificationDeliveriesQuery({}, false),
        useNotificationCriticalRouteQuery(null),
        useNotificationCriticalRouteQuery(userId, false),
      ],
      { wrapper },
    );
    expect(api.preferences).not.toHaveBeenCalled();
    expect(api.deliveries).not.toHaveBeenCalled();
    expect(api.criticalRoute).not.toHaveBeenCalled();
    client.clear();
  });

  it("separates cached reads by organization, user, permissions, and delivery filter", async () => {
    const { client, wrapper } = setup();
    const filter = {
      status: "exhausted" as const,
      recipientUserId: alternateUserId,
      limit: 25,
    };
    const view = renderHook(
      () => ({
        preferences: useNotificationPreferencesQuery(),
        deliveries: useNotificationDeliveriesQuery(filter),
        route: useNotificationCriticalRouteQuery(userId),
      }),
      { wrapper },
    );
    await waitFor(() =>
      expect(Object.values(view.result.current).every((q) => q.isSuccess)).toBe(
        true,
      ),
    );
    expect(api.deliveries).toHaveBeenCalledWith(
      filter,
      expect.any(AbortSignal),
    );
    expect(api.criticalRoute).toHaveBeenCalledWith(
      userId,
      expect.any(AbortSignal),
    );
    expect(api.preferences).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    ).toEqual(
      expect.arrayContaining([
        ["notifications", "org-a", "user-a", scope.permissions, "preferences"],
        [
          "notifications",
          "org-a",
          "user-a",
          scope.permissions,
          "deliveries",
          filter,
        ],
        [
          "notifications",
          "org-a",
          "user-a",
          scope.permissions,
          "critical-route",
          userId,
        ],
      ]),
    );

    scope.organizationId = "org-b";
    view.rerender();
    expect(view.result.current.deliveries.data).toBeUndefined();
    await waitFor(() => expect(api.deliveries).toHaveBeenCalledTimes(2));
    scope.userId = "user-b";
    view.rerender();
    await waitFor(() => expect(api.deliveries).toHaveBeenCalledTimes(3));
    scope.permissions = { can_view_audit: false };
    view.rerender();
    expect(view.result.current.deliveries.data).toBeUndefined();
    expect(api.deliveries).toHaveBeenCalledTimes(3);
    expect(
      client
        .getQueryCache()
        .getAll()
        .some((query) => query.queryKey.includes("org-b")),
    ).toBe(true);
    client.clear();
  });
});

describe("notification mutation invalidation", () => {
  it("forwards commands and invalidates only the current scope", async () => {
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const view = renderHook(
      () => ({
        preferences: useUpdateNotificationPreferencesMutation(),
        route: useUpdateNotificationCriticalRouteMutation(),
        retry: useRetryNotificationDeliveryMutation(),
      }),
      { wrapper },
    );
    const preferenceInput = {
      expectedVersion: 1,
      idempotencyKey: commandId,
      modes: {
        finding_triage: "immediate" as const,
        evidence: "daily" as const,
        supplier_owner: "off" as const,
      },
      schedule: {
        timezone: "UTC",
        localTime: "09:00",
        weekday: 1,
        quietHours: null,
      },
    };
    const routeInput = {
      expectedVersion: 1,
      idempotencyKey: commandId,
      alternateUserId,
    };
    const retryInput = { expectedVersion: 1, idempotencyKey: commandId };

    await act(async () => {
      await view.result.current.preferences.mutateAsync(preferenceInput);
      await view.result.current.route.mutateAsync({
        userId,
        input: routeInput,
      });
      await view.result.current.retry.mutateAsync({
        deliveryRef: "delivery_123",
        input: retryInput,
      });
    });
    expect(api.updatePreferences).toHaveBeenCalledWith(preferenceInput);
    expect(api.updateCriticalRoute).toHaveBeenCalledWith(userId, routeInput);
    expect(api.retryDelivery).toHaveBeenCalledWith("delivery_123", retryInput);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["notifications", "org-a", "user-a"],
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["notifications", "org-a"],
    });
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: notificationKeys.all,
    });
    expect(Object.isFrozen(notificationKeys.all)).toBe(true);
    client.clear();
  });
});
