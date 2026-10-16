// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebhooksContent } from "./webhooks-content";
import {
  delivery,
  endpoint,
  productId,
  page,
  secret,
  preview,
} from "../../../_features/connectors/test/webhook-fixtures";
import type {
  WebhookEndpoint,
  WebhookDelivery,
  WebhookDeliveryDetail,
} from "@repo/contracts/connectors/types";
interface SessionFixture {
  session: { organization: { id: string } | null };
  permissions: {
    can_view_connectors: boolean;
    can_create_connectors: boolean;
    can_edit_connectors: boolean;
  };
  role: string;
  isLoading: boolean;
}
interface FixtureQuery<T> {
  data: T;
  isPending: boolean;
  isError: boolean;
  refetch: ReturnType<typeof vi.fn>;
}
interface QueryFixtures {
  endpoints: FixtureQuery<{
    endpoints: ReturnType<typeof page<WebhookEndpoint>>;
  }>;
  endpoint: FixtureQuery<{ endpoint: WebhookEndpoint }>;
  catalogue: FixtureQuery<{
    eventTypes: { eventType: WebhookEndpoint["eventTypes"][number] }[];
  }>;
  products: FixtureQuery<{
    products: ReturnType<typeof page<{ id: string; name: string }>>;
  }>;
  deliveries: FixtureQuery<{
    deliveries: ReturnType<typeof page<WebhookDelivery>>;
  }>;
  detail: FixtureQuery<{ detail: WebhookDeliveryDetail }>;
}
const state = vi.hoisted(() => ({
  session: {} as SessionFixture,
  ready: true,
  queries: {} as QueryFixtures,
}));
const api = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
  test: vi.fn(),
  rotateSecret: vi.fn(),
  revokeSecret: vi.fn(),
  previewReplay: vi.fn(),
  replay: vi.fn(),
}));
vi.mock("../../../_providers/session-provider", () => ({
  useSession: () => state.session,
}));
vi.mock("../../../_providers/providers", () => ({
  useMocksReady: () => state.ready,
}));
vi.mock("../../../_features/connectors/webhooks.api", () => ({
  webhooksApi: api,
}));
vi.mock("../../../_features/connectors/webhooks.queries", () => ({
  useWebhookCommand: () => ({
    pending: false,
    run: (action: () => Promise<unknown>) => action(),
  }),
  useWebhookQueries: (endpointId: string, deliveryId: string) => ({
    ...state.queries,
    endpoint: {
      ...state.queries.endpoint,
      data: endpointId ? state.queries.endpoint.data : undefined,
    },
    detail: {
      ...state.queries.detail,
      data: deliveryId ? state.queries.detail.data : undefined,
    },
  }),
}));
function query<T>(data: T) {
  return { data, isPending: false, isError: false, refetch: vi.fn() };
}
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCKS", "false");
  state.ready = true;
  state.session = {
    session: { organization: { id: endpoint.organizationId } },
    permissions: {
      can_view_connectors: true,
      can_create_connectors: true,
      can_edit_connectors: true,
    },
    role: "owner",
    isLoading: false,
  };
  state.queries = {
    endpoints: query({ endpoints: page([endpoint], 1, 2) }),
    endpoint: query({ endpoint }),
    catalogue: query({ eventTypes: [{ eventType: endpoint.eventTypes[0]! }] }),
    products: query({
      products: page([{ id: productId, name: "Sensor" }], 1, 2),
    }),
    deliveries: query({ deliveries: page([delivery], 1, 2) }),
    detail: query({ detail: { delivery, attempts: page([], 1, 2) } }),
  };
  for (const operation of [
    api.create,
    api.update,
    api.enable,
    api.disable,
    api.rotateSecret,
    api.revokeSecret,
  ])
    operation.mockResolvedValue({ endpoint });
  api.test.mockResolvedValue({ delivery });
  api.previewReplay.mockResolvedValue({ preview });
  api.replay.mockResolvedValue({ delivery });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
function open() {
  fireEvent.click(
    screen.getByRole("button", { name: "Open webhook Compliance receiver" }),
  );
}
describe("outbound webhook workspace states", () => {
  it.each(["offline", "loading", "membership", "forbidden"])(
    "renders %s without configuration access",
    (mode) => {
      if (mode === "offline") state.ready = false;
      if (mode === "loading") state.session.isLoading = true;
      if (mode === "membership") state.session.session.organization = null;
      if (mode === "forbidden")
        state.session.permissions.can_view_connectors = false;
      render(<WebhooksContent />);
      const messages = {
        offline: "Outbound webhooks require the live backend.",
        loading: "Loading workspace…",
        membership: "Select an organization before managing webhooks.",
        forbidden: "You do not have permission to view webhooks.",
      };
      expect(
        screen.getByText(messages[mode as keyof typeof messages]),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Add webhook/ }),
      ).not.toBeInTheDocument();
    },
  );
  it("shows receiver loading, errors, explicit retry and empty guidance", () => {
    state.queries.endpoints.isPending = true;
    const view = render(<WebhooksContent />);
    expect(screen.getByText("Loading receivers…")).toBeInTheDocument();
    state.queries.endpoints.isPending = false;
    state.queries.endpoints.isError = true;
    view.rerender(<WebhooksContent />);
    fireEvent.click(screen.getByRole("button", { name: "Retry loading" }));
    expect(state.queries.endpoints.refetch).toHaveBeenCalled();
    state.queries.endpoints.isError = false;
    state.queries.endpoints.data = { endpoints: page([]) };
    view.rerender(<WebhooksContent />);
    expect(screen.getByText(/No endpoints configured/)).toBeInTheDocument();
  });
  it("hides edit/key controls from viewers while retaining safe diagnostics", () => {
    state.session.permissions.can_create_connectors = false;
    state.session.permissions.can_edit_connectors = false;
    state.session.role = "viewer";
    render(<WebhooksContent />);
    open();
    expect(
      screen.getByText(/Editing requires connector-edit permission/),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/New signing secret/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Send signed test" }),
    ).not.toBeInTheDocument();
  });
  it("handles endpoint, catalogue, products, delivery and attempt loading/errors", () => {
    state.queries.endpoint.isPending = true;
    const view = render(<WebhooksContent />);
    open();
    expect(screen.getByText("Loading receiver…")).toBeInTheDocument();
    state.queries.endpoint.isPending = false;
    state.queries.endpoint.isError = true;
    view.rerender(<WebhooksContent />);
    fireEvent.click(
      screen.getAllByRole("button", { name: "Retry loading" })[0]!,
    );
    expect(state.queries.endpoint.refetch).toHaveBeenCalled();
    state.queries.endpoint.isError = false;
    state.queries.catalogue.isError = true;
    view.rerender(<WebhooksContent />);
    fireEvent.click(
      screen.getAllByRole("button", { name: "Retry loading" })[0]!,
    );
    expect(state.queries.catalogue.refetch).toHaveBeenCalled();
    state.queries.catalogue.isError = false;
    state.queries.products.isError = true;
    view.rerender(<WebhooksContent />);
    fireEvent.click(
      screen.getAllByRole("button", { name: "Retry loading" })[0]!,
    );
    expect(state.queries.products.refetch).toHaveBeenCalled();
    state.queries.products.isError = false;
    state.queries.deliveries.isPending = true;
    view.rerender(<WebhooksContent />);
    expect(screen.getByText("Loading deliveries…")).toBeInTheDocument();
    state.queries.deliveries.isPending = false;
    state.queries.deliveries.isError = true;
    view.rerender(<WebhooksContent />);
    fireEvent.click(screen.getByRole("button", { name: "Retry loading" }));
    expect(state.queries.deliveries.refetch).toHaveBeenCalled();
    state.queries.deliveries.isError = false;
    state.queries.detail.isPending = true;
    view.rerender(<WebhooksContent />);
    fireEvent.click(
      screen.getByRole("button", {
        name: `Inspect delivery ${delivery.deliveryId}`,
      }),
    );
    expect(screen.getByText("Loading attempts…")).toBeInTheDocument();
    state.queries.detail.isPending = false;
    state.queries.detail.isError = true;
    view.rerender(<WebhooksContent />);
    fireEvent.click(screen.getByRole("button", { name: "Retry loading" }));
    expect(state.queries.detail.refetch).toHaveBeenCalled();
  });
  it("formats observed diagnostics and paginates each operational table", () => {
    state.queries.endpoints.data.endpoints.rows = [
      {
        ...endpoint,
        lastDeliveredAt: delivery.occurredAt,
        lastFailureCategory: "timeout",
      },
    ];
    state.queries.endpoint.data.endpoint = {
      ...endpoint,
      previousKeyExpiresAt: delivery.occurredAt,
    };
    state.queries.deliveries.data.deliveries.rows = [
      {
        ...delivery,
        nextAttemptAt: delivery.occurredAt,
        lastFailureCategory: null,
      },
    ];
    render(<WebhooksContent />);
    open();
    for (const label of [
      "Receiver pages",
      "Product selection pages",
      "Delivery pages",
    ]) {
      const pager = screen.getByRole("navigation", { name: label });
      fireEvent.click(within(pager).getByRole("button", { name: "Next" }));
      fireEvent.click(within(pager).getByRole("button", { name: "Previous" }));
    }
    fireEvent.click(
      screen.getByRole("button", {
        name: `Inspect delivery ${delivery.deliveryId}`,
      }),
    );
    const pager = screen.getByRole("navigation", { name: "Attempt pages" });
    fireEvent.click(within(pager).getByRole("button", { name: "Next" }));
    fireEvent.click(within(pager).getByRole("button", { name: "Previous" }));
    expect(screen.getByText("timeout")).toBeInTheDocument();
    expect(screen.getByText(/Previous key overlap/)).toBeInTheDocument();
  });
  it("shows delivery empty guidance and no-secret controls", () => {
    state.queries.endpoint.data.endpoint = {
      ...endpoint,
      hasSecret: false,
      signingKeyId: null,
    };
    state.queries.deliveries.data = { deliveries: page([]) };
    render(<WebhooksContent />);
    open();
    expect(screen.getByText(/No deliveries yet/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send signed test" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Enable endpoint" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Submit signing secret" }),
    ).toBeDisabled();
  });
});
describe("webhook operator commands", () => {
  it("creates without cache retention and saves current configuration", async () => {
    render(<WebhooksContent />);
    fireEvent.click(
      screen.getByRole("button", { name: "Add webhook endpoint" }),
    );
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "New receiver" },
    });
    fireEvent.change(screen.getByLabelText("HTTPS destination"), {
      target: { value: endpoint.url },
    });
    fireEvent.click(screen.getByLabelText(endpoint.eventTypes[0]!));
    fireEvent.click(screen.getByLabelText("Sensor"));
    fireEvent.click(
      screen.getByRole("button", { name: "Create disabled endpoint" }),
    );
    await waitFor(() => expect(api.create).toHaveBeenCalled());
    await screen.findByRole("button", { name: "Save configuration" });
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith(
        endpoint.id,
        expect.objectContaining({ expectedVersion: 1 }),
      ),
    );
  });
  it("queues a non-destructive test, enables, rotates with overlap and revokes with reason", async () => {
    render(<WebhooksContent />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Send signed test" }));
    await screen.findByText(/Signed test delivery queued/);
    expect(api.test).toHaveBeenCalledWith(
      endpoint.id,
      expect.objectContaining({ expectedVersion: 1 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Enable endpoint" }));
    await waitFor(() => expect(api.enable).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText(/New signing secret/), {
      target: { value: secret },
    });
    fireEvent.change(screen.getByLabelText(/Old\/new overlap/), {
      target: { value: "0" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Rotate signing secret" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText(/New signing secret/)).toHaveValue(""),
    );
    expect(api.rotateSecret).toHaveBeenCalledWith(
      endpoint.id,
      expect.objectContaining({ secretValue: secret, overlapSeconds: 0 }),
    );
    fireEvent.change(screen.getByLabelText("Change reason"), {
      target: { value: "Receiver revoked" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Revoke signing secret" }),
    );
    await waitFor(() =>
      expect(api.revokeSecret).toHaveBeenCalledWith(
        endpoint.id,
        expect.objectContaining({ reason: "Receiver revoked" }),
      ),
    );
  });
  it("disables future delivery and surfaces conflict without clearing non-secret drafts", async () => {
    state.queries.endpoint.data.endpoint = { ...endpoint, enabled: true };
    api.disable.mockRejectedValue(new Error("conflict"));
    render(<WebhooksContent />);
    open();
    fireEvent.change(screen.getByLabelText("Change reason"), {
      target: { value: "Stop delivery" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Disable and cancel pending" }),
    );
    await screen.findByText(/Action outcome is unavailable/);
    expect(screen.getByLabelText("Change reason")).toHaveValue("Stop delivery");
  });
  it("clears secret forms and old selection after organization change", () => {
    const view = render(<WebhooksContent />);
    open();
    fireEvent.change(screen.getByLabelText(/New signing secret/), {
      target: { value: secret },
    });
    state.session.session.organization!.id = "different-org";
    view.rerender(<WebhooksContent />);
    expect(
      screen.queryByLabelText(/New signing secret/),
    ).not.toBeInTheDocument();
  });
  it("allows closing create and reloading selected receiver without changing menu", () => {
    render(<WebhooksContent />);
    fireEvent.click(
      screen.getByRole("button", { name: "Add webhook endpoint" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close create form" }));
    expect(screen.queryByText("Create receiver")).not.toBeInTheDocument();
    open();
    expect(
      screen.getByRole("link", { name: "Integration hub" }),
    ).toHaveAttribute("href", "/connectors");
  });
});

import WebhooksPage from "./page";
it("exports the real functional route", () => {
  render(<WebhooksPage />);
  expect(
    screen.getByRole("heading", { name: "Outbound webhooks" }),
  ).toBeInTheDocument();
});
it("reuses the action identity after timeout without automatic mutation replay", async () => {
  api.enable.mockRejectedValue(new Error("timeout"));
  render(<WebhooksContent />);
  open();
  fireEvent.click(screen.getByRole("button", { name: "Enable endpoint" }));
  await screen.findByText(/Action outcome is unavailable/);
  const key = api.enable.mock.calls[0]![1].idempotencyKey;
  fireEvent.click(screen.getByRole("button", { name: "Enable endpoint" }));
  await waitFor(() => expect(api.enable).toHaveBeenCalledTimes(2));
  expect(api.enable.mock.calls[1]![1].idempotencyKey).toBe(key);
});

it("requires explicit discard before closing a modified form", () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<WebhooksContent />);
  fireEvent.click(screen.getByRole("button", { name: "Add webhook endpoint" }));
  fireEvent.change(screen.getByLabelText("Display name"), {
    target: { value: "Keep this draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Close create form" }));
  expect(confirm).toHaveBeenCalledWith("Discard unsaved webhook changes?");
  expect(screen.getByLabelText("Display name")).toHaveValue("Keep this draft");
  fireEvent.click(
    screen.getByRole("button", { name: "Open webhook Compliance receiver" }),
  );
  expect(screen.getByLabelText("Display name")).toHaveValue("Keep this draft");
  confirm.mockReturnValue(true);
  fireEvent.click(
    screen.getByRole("button", { name: "Open webhook Compliance receiver" }),
  );
  expect(screen.getByLabelText("Display name")).toHaveValue(
    "Compliance receiver",
  );
  confirm.mockRestore();
});

it("uses a fresh rotation command identity after the signing secret changes", async () => {
  api.rotateSecret.mockRejectedValue(new Error("timeout"));
  render(<WebhooksContent />);
  open();
  fireEvent.change(screen.getByLabelText(/New signing secret/), {
    target: { value: secret },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Rotate signing secret" }),
  );
  await screen.findByText(/Action outcome is unavailable/);
  const key = api.rotateSecret.mock.calls[0]![1].idempotencyKey;
  fireEvent.change(screen.getByLabelText(/New signing secret/), {
    target: { value: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Rotate signing secret" }),
  );
  await waitFor(() => expect(api.rotateSecret).toHaveBeenCalledTimes(2));
  expect(api.rotateSecret.mock.calls[1]![1].idempotencyKey).not.toBe(key);
});

it("refetches current receiver without discarding unsaved configuration", () => {
  render(<WebhooksContent />);
  open();
  fireEvent.change(screen.getByLabelText("Display name"), {
    target: { value: "Preserved draft" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Reload current receiver" }),
  );
  expect(state.queries.endpoint.refetch).toHaveBeenCalled();
  expect(state.queries.deliveries.refetch).toHaveBeenCalled();
  expect(screen.getByLabelText("Display name")).toHaveValue("Preserved draft");
});
