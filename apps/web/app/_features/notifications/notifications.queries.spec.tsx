// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { notificationFeedRefSchema } from "@repo/contracts/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  notificationKeys,
  useNotificationCriticalRouteQuery,
  useNotificationDeliveriesQuery,
  useNotificationPreferencesQuery,
  useNotificationFeedQuery,
  useNotificationUnreadCountQuery,
  useMarkNotificationReadMutation,
  useRetryNotificationDeliveryMutation,
  useChatChannelsQuery,
  useChatDeliveriesQuery,
  useChatProductsQuery,
  useCreateChatChannelMutation,
  useUpdateChatChannelMutation,
  useConfirmChatChannelMutation,
  useUpdateNotificationCriticalRouteMutation,
  useUpdateNotificationPreferencesMutation,
} from "./notifications.queries";

const userId = "11111111-1111-4111-8111-111111111111";
const alternateUserId = "22222222-2222-4222-8222-222222222222";
const commandId = "33333333-3333-4333-8333-333333333333";

const scope = vi.hoisted(() => ({
  organizationId: "org-a" as string | null,
  userId: "user-a" as string | null,
  permissions: { can_view_audit: true } as {
    can_view_audit: boolean;
    can_edit_organization?: boolean;
  },
  role: "admin" as "admin" | "viewer",
  isLoading: false,
  isError: false,
}));

const api = vi.hoisted(() => ({
  preferences: vi.fn(async () => ({ preferences: { version: 1 } })),
  deliveries: vi.fn(async () => ({ rows: [], nextCursor: null })),
  criticalRoute: vi.fn(async () => ({ route: { version: 1 } })),
  updatePreferences: vi.fn(async () => ({ preferences: { version: 2 } })),
  updateCriticalRoute: vi.fn(async () => ({ route: { version: 2 } })),
  retryDelivery: vi.fn(async () => ({ delivery: { version: 2 } })),
  feed: vi.fn(async () => ({ items: [] as unknown[], nextCursor: null })),
  unreadCount: vi.fn(async () => ({ count: 0 })),
  markRead: vi.fn(async () => ({ items: [], replayed: false })),
  chatChannels: vi.fn(async () => ({ channels: [] })),
  chatDeliveries: vi.fn(async () => ({ rows: [], nextCursor: null })),
  createChatChannel: vi.fn(async () => ({ channel: { id: "channel-a" } })),
  updateChatChannel: vi.fn(async () => ({ channel: { id: "channel-a" } })),
  confirmChatChannel: vi.fn(async () => ({ channel: { id: "channel-a" } })),
}));

const productApi = vi.hoisted(() => ({
  list: vi.fn(async () => ({ products: { rows: [], total: 0 } })),
}));

vi.mock("../products/products.api", () => ({ productsApi: productApi }));

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
    role: scope.role,
    isLoading: scope.isLoading,
    isError: scope.isError,
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
  scope.role = "admin";
  scope.isLoading = false;
  scope.isError = false;
});

describe("chat notification query scope", () => {
  it("gates channel and product reads to tenant admins and history to audit viewers", async () => {
    const { client, wrapper } = setup();
    scope.permissions = { can_view_audit: true, can_edit_organization: true };
    const view = renderHook(
      () => ({
        channels: useChatChannelsQuery(),
        products: useChatProductsQuery("device"),
        deliveries: useChatDeliveriesQuery({ status: "failed", limit: 25 }),
      }),
      { wrapper },
    );
    await waitFor(() =>
      expect(view.result.current.channels.isSuccess).toBe(true),
    );
    expect(api.chatChannels).toHaveBeenCalledTimes(1);
    expect(productApi.list).toHaveBeenCalledWith(
      { page: 1, pageSize: 25, archived: false, q: "device" },
      expect.any(AbortSignal),
    );
    expect(api.chatDeliveries).toHaveBeenCalledWith(
      { status: "failed", limit: 25 },
      expect.any(AbortSignal),
    );

    scope.organizationId = "org-b";
    view.rerender();
    expect(view.result.current.channels.data).toBeUndefined();
    expect(view.result.current.products.data).toBeUndefined();
    expect(view.result.current.deliveries.data).toBeUndefined();

    scope.role = "viewer";
    scope.permissions = { can_view_audit: true, can_edit_organization: true };
    view.rerender();
    expect(view.result.current.channels.data).toBeUndefined();
    expect(view.result.current.products.data).toBeUndefined();
    await waitFor(() =>
      expect(view.result.current.deliveries.isSuccess).toBe(true),
    );

    scope.permissions = { can_view_audit: false, can_edit_organization: false };
    view.rerender();
    expect(view.result.current.deliveries.data).toBeUndefined();
    client.clear();
  });

  it("does not retain credential-bearing create and update inputs in MutationCache", async () => {
    const { client, wrapper } = setup();
    scope.permissions = { can_view_audit: true, can_edit_organization: true };
    const view = renderHook(
      () => ({
        create: useCreateChatChannelMutation(),
        update: useUpdateChatChannelMutation(),
        confirm: useConfirmChatChannelMutation(),
      }),
      { wrapper },
    );
    const createInput = {
      displayName: "Operations",
      eventClasses: ["high_severity_alert" as const],
      productIds: ["11111111-1111-4111-8111-111111111111"],
      includeOrganizationWide: false,
      destination: {
        mode: "slack_webhook" as const,
        webhookUrl: "https://hooks.slack.com/services/test/secret",
      },
      idempotencyKey: commandId,
    };
    await act(async () => {
      await view.result.current.create.mutateAsync(createInput);
      await view.result.current.update.mutateAsync({
        channelId: "22222222-2222-4222-8222-222222222222",
        input: {
          ...createInput,
          expectedVersion: 1,
        },
      });
      await view.result.current.confirm.mutateAsync({
        channelId: "22222222-2222-4222-8222-222222222222",
        input: {
          expectedVersion: 2,
          idempotencyKey: commandId,
          testId: "33333333-3333-4333-8333-333333333333",
          code: "123456",
        },
      });
    });
    expect(api.createChatChannel).toHaveBeenCalledWith(createInput);
    expect(api.updateChatChannel).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
      expect.objectContaining({ destination: createInput.destination }),
    );
    expect(api.confirmChatChannel).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
      expect.objectContaining({ code: "123456" }),
    );
    expect(client.getMutationCache().getAll()).toHaveLength(0);

    let release: ((value: { channel: { id: string } }) => void) | undefined;
    api.createChatChannel.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const first = view.result.current.create.mutateAsync(createInput);
    await expect(
      view.result.current.create.mutateAsync(createInput),
    ).rejects.toThrow(/already being submitted/);
    release?.({ channel: { id: "channel-a" } });
    await first;
    expect(client.getMutationCache().getAll()).toHaveLength(0);
    client.clear();
  });
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

describe("in-app feed scope", () => {
  it("does not fetch while identity is missing, keeps tenant caches separate, and does not leak the previous feed on switch", async () => {
    const { client, wrapper } = setup();
    scope.organizationId = null;
    scope.userId = null;
    const view = renderHook(
      () => ({
        feed: useNotificationFeedQuery({ read: "all", limit: 25 }),
        count: useNotificationUnreadCountQuery(),
      }),
      { wrapper },
    );
    expect(api.feed).not.toHaveBeenCalled();
    expect(api.unreadCount).not.toHaveBeenCalled();

    scope.organizationId = "org-a";
    scope.userId = "user-a";
    view.rerender();
    await waitFor(() => expect(view.result.current.feed.isSuccess).toBe(true));
    expect(api.feed).toHaveBeenCalledWith(
      { read: "all", limit: 25 },
      expect.any(AbortSignal),
    );

    scope.organizationId = "org-b";
    view.rerender();
    expect(view.result.current.feed.data).toBeUndefined();
    await waitFor(() => expect(api.feed).toHaveBeenCalledTimes(2));
    expect(
      client
        .getQueryCache()
        .getAll()
        .map((entry) => entry.queryKey),
    ).toEqual(
      expect.arrayContaining([
        [
          "notifications",
          "org-a",
          "user-a",
          scope.permissions,
          "feed",
          { read: "all", limit: 25 },
        ],
        [
          "notifications",
          "org-b",
          "user-a",
          scope.permissions,
          "feed",
          { read: "all", limit: 25 },
        ],
      ]),
    );
    client.clear();
  });

  it("invalidates only the active feed scope after an explicit idempotent mark-read", async () => {
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const view = renderHook(() => useMarkNotificationReadMutation(), {
      wrapper,
    });
    const input = {
      items: [
        {
          ref: notificationFeedRefSchema.parse(
            "m6_11111111-1111-4111-8111-111111111111_event",
          ),
          expectedFingerprint: "a".repeat(64),
        },
      ],
      idempotencyKey: commandId,
    };
    await act(async () => {
      await view.result.current.mutateAsync(input);
    });
    expect(api.markRead).toHaveBeenCalledWith(input);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["notifications", "org-a", "user-a"],
    });
    client.clear();
  });

  it("masks cached feed and count while session verification fails", async () => {
    api.unreadCount.mockResolvedValue({ count: 3 });
    api.feed.mockResolvedValue({
      items: [{ ref: "old-tenant" }],
      nextCursor: null,
    });
    const { client, wrapper } = setup();
    const view = renderHook(
      () => ({
        feed: useNotificationFeedQuery({ read: "all", limit: 25 }),
        count: useNotificationUnreadCountQuery(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(view.result.current.count.data?.count).toBe(3));
    scope.isError = true;
    view.rerender();
    expect(view.result.current.feed.data).toBeUndefined();
    expect(view.result.current.count.data).toBeUndefined();
    scope.isError = false;
    scope.isLoading = true;
    view.rerender();
    expect(view.result.current.feed.data).toBeUndefined();
    expect(view.result.current.count.data).toBeUndefined();
    client.clear();
  });
});
