// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../../_lib/http/api-client";
import { NotificationAdminPanel } from "./notification-admin-panel";

const userId = "11111111-1111-4111-8111-111111111111";
const alternateUserId = "22222222-2222-4222-8222-222222222222";
const deliveryRef = "delivery_123";
const refetchDeliveries = vi.fn();
const refetchRoute = vi.fn();

const route = {
  organizationId: "33333333-3333-4333-8333-333333333333",
  userId,
  alternateUserId: null,
  version: 1,
} as const;

const delivery = {
  deliveryRef,
  category: "support_period",
  status: "failed",
  sourceType: "product_release",
  sourceId: "44444444-4444-4444-8444-444444444444",
  originalRecipientUserId: userId,
  effectiveRecipientUserId: null,
  attemptCount: 2,
  lastAttemptAt: "2026-10-01T10:00:00.000Z",
  nextAttemptAt: "2026-10-01T11:00:00.000Z",
  safeErrorCode: "provider_unavailable",
  createdAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
  version: 2,
} as const;

type TestDelivery = Omit<
  typeof delivery,
  "deliveryRef" | "category" | "status" | "version"
> & {
  deliveryRef: string;
  category: string;
  status: string;
  version: number;
};

type DeliveriesQueryState = Readonly<{
  data: { rows: TestDelivery[]; nextCursor: string | null } | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: typeof refetchDeliveries;
}>;
type RouteQueryState = Readonly<{
  data: { route: typeof route } | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: typeof refetchRoute;
}>;

const mutations = vi.hoisted(() => ({
  updateRoute: { mutateAsync: vi.fn(), isPending: false },
  retry: { mutateAsync: vi.fn(), isPending: false },
}));

const sessionScope = vi.hoisted(() => ({
  organizationId: "33333333-3333-4333-8333-333333333333",
  canViewAudit: true,
}));

vi.mock("../../_providers/session-provider", () => ({
  useSession: () => ({
    session: { organization: { id: sessionScope.organizationId } },
    permissions: { can_view_audit: sessionScope.canViewAudit },
  }),
}));

const queries = vi.hoisted(() => ({
  deliveries: null as DeliveriesQueryState | null,
  route: null as RouteQueryState | null,
  deliveryQueryArgs: [] as unknown[],
  deliveryEnabledArgs: [] as unknown[],
}));

vi.mock("./notifications.queries", () => ({
  useNotificationDeliveriesQuery: (query: unknown, enabled: unknown) => {
    queries.deliveryQueryArgs.push(query);
    queries.deliveryEnabledArgs.push(enabled);
    return queries.deliveries!;
  },
  useNotificationCriticalRouteQuery: () => queries.route!,
  useUpdateNotificationCriticalRouteMutation: () => mutations.updateRoute,
  useRetryNotificationDeliveryMutation: () => mutations.retry,
}));

vi.mock("./chat-channel-panel", () => ({
  ChatChannelPanel: () => <div>Chat channel settings</div>,
}));
vi.mock("./burst-policy-panel", () => ({
  BurstPolicyPanel: () => <div>Burst policy settings</div>,
}));
vi.mock("./burst-batch-history-panel", () => ({
  BurstBatchHistoryPanel: () => <div>Burst delivery history</div>,
}));

describe("NotificationAdminPanel", () => {
  beforeEach(() => {
    sessionScope.organizationId = "33333333-3333-4333-8333-333333333333";
    sessionScope.canViewAudit = true;
    queries.deliveries = {
      data: { rows: [delivery], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchDeliveries,
    };
    queries.route = {
      data: { route },
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchRoute,
    };
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    queries.deliveryQueryArgs = [];
    queries.deliveryEnabledArgs = [];
  });

  it("updates critical alternate routing without muting critical categories", async () => {
    mutations.updateRoute.mutateAsync.mockResolvedValue({
      route: { ...route, alternateUserId, version: 2 },
    });
    render(<NotificationAdminPanel canManage />);

    fireEvent.change(screen.getByLabelText("Accountable recipient user ID"), {
      target: { value: userId },
    });
    fireEvent.change(screen.getByLabelText("Fallback recipient user ID"), {
      target: { value: alternateUserId },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save critical route" }),
    );

    await waitFor(() =>
      expect(mutations.updateRoute.mutateAsync).toHaveBeenCalledWith({
        userId,
        input: {
          expectedVersion: 1,
          idempotencyKey: expect.any(String),
          alternateUserId,
        },
      }),
    );
    expect(
      screen.getByText(/Critical regulatory alerts remain immediate/),
    ).toBeVisible();
  });

  it("retries exhausted deliveries with optimistic version but leaves retrying failures to the worker", async () => {
    mutations.retry.mutateAsync.mockResolvedValue({
      delivery: { ...delivery, status: "exhausted" },
    });
    queries.deliveries = {
      ...queries.deliveries!,
      data: {
        rows: [
          delivery,
          {
            ...delivery,
            deliveryRef: "delivery_exhausted",
            status: "exhausted",
          },
        ],
        nextCursor: null,
      },
    };
    render(<NotificationAdminPanel canManage />);

    expect(screen.getAllByText(/provider unavailable/)).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: "Retry delivery delivery_123" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry delivery delivery_exhausted" }),
    );

    await waitFor(() =>
      expect(mutations.retry.mutateAsync).toHaveBeenCalledWith({
        deliveryRef: "delivery_exhausted",
        input: { expectedVersion: 2, idempotencyKey: expect.any(String) },
      }),
    );
  });

  it("filters every logged delivery outcome", () => {
    render(<NotificationAdminPanel canManage />);

    const status = screen.getByLabelText("Delivery status");
    for (const state of [
      "Queued",
      "Attempted",
      "Failed",
      "Exhausted",
      "Provider accepted",
      "Delivered",
      "Cancelled",
    ]) {
      expect(status).toHaveTextContent(state);
    }
    fireEvent.change(status, { target: { value: "provider_accepted" } });
    expect(queries.deliveryQueryArgs.at(-1)).toEqual(
      expect.objectContaining({ status: "provider_accepted", limit: 25 }),
    );
  });

  it("offers all notification categories with readable labels", () => {
    render(<NotificationAdminPanel canManage />);

    const category = screen.getByLabelText("Category");
    expect(category).toHaveTextContent("All categories");
    expect(category).toHaveTextContent("Finding triage");
    expect(category).toHaveTextContent("Evidence expiry");
    expect(category).toHaveTextContent("Supplier owner requests");
    expect(category).toHaveTextContent("Support period");
    expect(category).toHaveTextContent("Reporting deadline");

    fireEvent.change(category, { target: { value: "evidence" } });
    expect(queries.deliveryQueryArgs.at(-1)).toEqual(
      expect.objectContaining({ category: "evidence", limit: 25 }),
    );
  });

  it("loads the next delivery page with the active filters and avoids duplicate rows on refresh", () => {
    queries.deliveries = {
      data: { rows: [delivery], nextCursor: "cursor_next" },
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchDeliveries,
    };
    const view = render(<NotificationAdminPanel canManage />);

    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "evidence" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(queries.deliveryQueryArgs.at(-1)).toEqual(
      expect.objectContaining({
        status: "failed",
        category: "evidence",
        cursor: "cursor_next",
        limit: 25,
      }),
    );

    queries.deliveries = {
      data: {
        rows: [
          delivery,
          {
            ...delivery,
            deliveryRef: "delivery_456",
            category: "evidence",
            version: 3,
          },
        ],
        nextCursor: null,
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchDeliveries,
    };
    view.rerender(<NotificationAdminPanel canManage />);
    view.rerender(<NotificationAdminPanel canManage />);

    expect(screen.getAllByText("Delivery delivery_123")).toHaveLength(1);
    expect(screen.getAllByText("Delivery delivery_456")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("hides prior organization rows and cursors immediately after organization switch", () => {
    queries.deliveries = {
      ...queries.deliveries!,
      data: { rows: [delivery], nextCursor: "cursor_next" },
    };
    const view = render(<NotificationAdminPanel canManage />);
    expect(screen.getByText("Delivery delivery_123")).toBeVisible();

    sessionScope.organizationId = "55555555-5555-4555-8555-555555555555";
    queries.deliveries = {
      ...queries.deliveries!,
      data: undefined,
      isLoading: true,
    };
    view.rerender(<NotificationAdminPanel canManage />);

    expect(screen.queryByText("Delivery delivery_123")).toBeNull();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    expect(queries.deliveryQueryArgs.at(-1)).toEqual(
      expect.objectContaining({ cursor: undefined }),
    );
  });

  it("filters delivery history by recipient without reusing another recipient's rows or cursor", () => {
    queries.deliveries = {
      ...queries.deliveries!,
      data: { rows: [delivery], nextCursor: "cursor_next" },
    };
    const view = render(<NotificationAdminPanel canManage />);
    fireEvent.change(screen.getByLabelText("Delivery recipient user ID"), {
      target: { value: userId },
    });
    expect(screen.getByText("Delivery delivery_123")).toBeVisible();

    queries.deliveries = {
      ...queries.deliveries!,
      data: undefined,
      isLoading: true,
    };
    fireEvent.change(screen.getByLabelText("Delivery recipient user ID"), {
      target: { value: alternateUserId },
    });
    expect(screen.queryByText("Delivery delivery_123")).toBeNull();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    expect(queries.deliveryQueryArgs.at(-1)).toEqual(
      expect.objectContaining({
        recipientUserId: alternateUserId,
        cursor: undefined,
      }),
    );

    fireEvent.change(screen.getByLabelText("Delivery recipient user ID"), {
      target: { value: "invalid" },
    });
    view.rerender(<NotificationAdminPanel canManage />);
    expect(screen.getByText(/Enter a valid recipient user ID/)).toBeVisible();
    expect(queries.deliveryEnabledArgs.at(-1)).toBe(false);
    expect(screen.queryByText("Delivery delivery_123")).toBeNull();
  });

  it("preserves route draft after a conflict and shows read-only copy without manage access", async () => {
    mutations.updateRoute.mutateAsync.mockRejectedValue(
      new ApiClientError("api", "Conflict", 409),
    );
    render(<NotificationAdminPanel canManage />);

    fireEvent.change(screen.getByLabelText("Accountable recipient user ID"), {
      target: { value: userId },
    });
    fireEvent.change(screen.getByLabelText("Fallback recipient user ID"), {
      target: { value: alternateUserId },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save critical route" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("changed");
    expect(screen.getByLabelText("Fallback recipient user ID")).toHaveValue(
      alternateUserId,
    );

    cleanup();
    render(<NotificationAdminPanel canManage={false} />);
    expect(screen.getByText(/Only organization administrators/)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Save critical route" }),
    ).toBeNull();
  });

  it("hides delivery history when audit access is revoked, without hiding route management", () => {
    const view = render(<NotificationAdminPanel canManage />);
    expect(screen.getByText("Delivery delivery_123")).toBeVisible();

    sessionScope.canViewAudit = false;
    view.rerender(<NotificationAdminPanel canManage />);

    expect(queries.deliveryEnabledArgs.at(-1)).toBe(false);
    expect(screen.queryByText("Delivery delivery_123")).toBeNull();
    expect(
      screen.getByText(/permission to view notification delivery history/),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Save critical route" }),
    ).toBeVisible();
  });

  it("shows delivery history to an audit-only reader without offering mutation controls", () => {
    render(<NotificationAdminPanel canManage={false} />);

    expect(queries.deliveryEnabledArgs.at(-1)).toBe(true);
    expect(screen.getByText("Delivery delivery_123")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Save critical route" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /Retry delivery/ })).toBeNull();
  });

  it("shows delivery loading, empty, and retry states", () => {
    queries.deliveries = {
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: refetchDeliveries,
    };
    const view = render(<NotificationAdminPanel canManage />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading notification deliveries",
    );

    queries.deliveries = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiClientError("network", "Offline"),
      refetch: refetchDeliveries,
    };
    view.rerender(<NotificationAdminPanel canManage />);
    expect(screen.getByRole("alert")).toHaveTextContent("offline");

    queries.deliveries = {
      data: { rows: [], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchDeliveries,
    };
    view.rerender(<NotificationAdminPanel canManage />);
    expect(
      screen.getByText("No notification deliveries match these filters."),
    ).toBeVisible();
  });
});
