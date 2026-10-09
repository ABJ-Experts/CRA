// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SiemContent } from "./siem-content";
import { AuditSiemGateway } from "./siem.api";
import { destination, id, delivery } from "./test/fixtures";
const state = vi.hoisted(() => ({
  session: {
    session: { organization: { id: "org" } },
    permissions: {
      can_view_audit: true,
      can_view_connectors: true,
      can_export_audit: true,
      can_edit_connectors: true,
      can_create_connectors: true,
    },
    isLoading: false,
    isError: false,
    role: "owner",
  },
  mocksReady: true,
  list: {
    data: { items: [] as unknown[] },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  catalogue: {
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  deliveries: {
    data: { items: [] as unknown[], nextCursor: null as string | null },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  command: {
    pending: false,
    error: null as string | null,
    run: vi.fn((command: () => Promise<unknown>) =>
      command().catch(() => undefined),
    ),
  },
}));
vi.mock("../../../_providers/session-provider", () => ({
  useSession: () => state.session,
}));
vi.mock("../../../_providers/providers", () => ({
  useMocksReady: () => state.mocksReady,
}));
vi.mock("./siem.queries", () => ({
  useSiemQueries: () => ({
    list: state.list,
    catalogue: state.catalogue,
    deliveries: state.deliveries,
  }),
  useSiemCommand: () => state.command,
}));
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCKS", "false");
  state.session.permissions = {
    can_view_audit: true,
    can_view_connectors: true,
    can_export_audit: true,
    can_edit_connectors: true,
    can_create_connectors: true,
  };
  state.session.isLoading = false;
  state.session.isError = false;
  state.session.role = "owner";
  state.session.session.organization.id = "org";
  state.list.data.items = [];
  state.list.isError = false;
  state.list.isLoading = false;
  state.deliveries.isError = false;
  state.deliveries.isLoading = false;
  state.deliveries.data = { items: [], nextCursor: null };
  state.command.pending = false;
  state.command.error = null;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it("requires audit and connector visibility independently", () => {
  state.session.permissions.can_view_audit = false;
  render(<SiemContent />);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Audit and connector read permissions are required",
  );
});
it("supports permission loading, unavailable and mock mode without forwarding", () => {
  state.session.isLoading = true;
  const view = render(<SiemContent />);
  expect(screen.getByText(/Loading SIEM permissions/)).toBeVisible();
  state.session.isLoading = false;
  state.session.isError = true;
  view.rerender(<SiemContent />);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Permissions are unavailable",
  );
  state.session.isError = false;
  vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCKS", "true");
  view.rerender(<SiemContent />);
  expect(screen.getByText(/Mock mode cannot forward/)).toBeVisible();
});
it("preserves public drafts and request IDs after ambiguous create failure", async () => {
  const create = vi
    .spyOn(AuditSiemGateway.prototype, "create")
    .mockRejectedValue(new Error("offline"));
  render(<SiemContent />);
  fireEvent.click(screen.getByRole("button", { name: "New destination" }));
  fireEvent.change(screen.getByLabelText("Destination name"), {
    target: { value: "Collector" },
  });
  fireEvent.change(screen.getByLabelText("Collector endpoint"), {
    target: { value: "https://collector.example.com/events" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save destination" }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "Save destination" }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  expect(create.mock.calls[0]?.[0]).toEqual(create.mock.calls[1]?.[0]);
  expect(screen.getByLabelText("Destination name")).toHaveValue("Collector");
});
it("creates a destination and clears tenant-bound work on organization switch", async () => {
  state.list.data.items = [destination];
  vi.spyOn(AuditSiemGateway.prototype, "create").mockResolvedValue(destination);
  const view = render(<SiemContent />);
  fireEvent.click(screen.getByRole("button", { name: "New destination" }));
  fireEvent.change(screen.getByLabelText("Destination name"), {
    target: { value: "New collector" },
  });
  fireEvent.change(screen.getByLabelText("Collector endpoint"), {
    target: { value: destination.endpoint },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save destination" }));
  await screen.findByText(/Authority user:/);
  state.session.session.organization.id = "other-org";
  view.rerender(<SiemContent />);
  expect(screen.queryByText(/Authority user:/)).not.toBeInTheDocument();
});
it("holds the command lifecycle until current optimistic versions refresh", async () => {
  let release!: () => void;
  let commandCompleted = false;
  state.list.refetch.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  state.command.run.mockImplementationOnce(
    async (operation: () => Promise<unknown>) => {
      const result = await operation();
      commandCompleted = true;
      return result;
    },
  );
  vi.spyOn(AuditSiemGateway.prototype, "create").mockResolvedValue(destination);
  render(<SiemContent />);
  fireEvent.click(screen.getByRole("button", { name: "New destination" }));
  fireEvent.change(screen.getByLabelText("Destination name"), {
    target: { value: "New collector" },
  });
  fireEvent.change(screen.getByLabelText("Collector endpoint"), {
    target: { value: destination.endpoint },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save destination" }));
  await waitFor(() => expect(release).toBeTypeOf("function"));
  expect(commandCompleted).toBe(false);
  release();
  await waitFor(() => expect(commandCompleted).toBe(true));
});
it("configures credentials, lifecycle operations and honest test feedback", async () => {
  state.list.data.items = [destination];
  const operation = vi
      .spyOn(AuditSiemGateway.prototype, "operation")
      .mockResolvedValue(destination),
    update = vi
      .spyOn(AuditSiemGateway.prototype, "update")
      .mockResolvedValue(destination),
    credential = vi
      .spyOn(AuditSiemGateway.prototype, "credential")
      .mockResolvedValue(destination);
  vi.spyOn(AuditSiemGateway.prototype, "test").mockResolvedValue({
    destination,
    state: "sent_unacknowledged",
    safeFailureCode: null,
  });
  render(<SiemContent />);
  fireEvent.change(screen.getByLabelText("Current destination"), {
    target: { value: id },
  });
  fireEvent.click(screen.getByRole("button", { name: "Test collector" }));
  await screen.findByText(/Test sent unacknowledged/);
  for (const name of [
    "Enable future events / take over",
    "Disable and cancel pending",
    "Revoke credentials",
  ])
    fireEvent.click(screen.getByRole("button", { name }));
  await waitFor(() => expect(operation).toHaveBeenCalledTimes(3));
  fireEvent.change(screen.getByLabelText("Bearer token"), {
    target: { value: "never-retained" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Rotate credentials" }));
  await waitFor(() => expect(credential).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText("Bearer token")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Configuration change reason"), {
    target: { value: "Update scope" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save destination" }));
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith(
      id,
      expect.objectContaining({
        backlogPolicy: "cancel_pending_start_future",
        reason: "Update scope",
      }),
    ),
  );
});
it("renders paused/degraded history and supports retry/paging", () => {
  state.list.data.items = [
    {
      ...destination,
      state: "paused",
      health: {
        ...destination.health,
        safeFailureCode: "authority_revoked",
        lastAcceptedAt: destination.updatedAt,
      },
    },
  ];
  state.deliveries.data = { items: [delivery], nextCursor: "cursor" };
  const view = render(<SiemContent />);
  fireEvent.change(screen.getByLabelText("Current destination"), {
    target: { value: id },
  });
  expect(screen.getByText(/Delivery is paused/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Next deliveries" }));
  fireEvent.click(screen.getByRole("button", { name: "Previous deliveries" }));
  state.deliveries.isError = true;
  view.rerender(<SiemContent />);
  fireEvent.click(screen.getByRole("button", { name: "Retry history" }));
  expect(state.deliveries.refetch).toHaveBeenCalled();
  state.deliveries.isError = false;
  state.deliveries.isLoading = true;
  view.rerender(<SiemContent />);
  expect(screen.getByText(/Loading delivery history/)).toBeVisible();
  state.list.isError = true;
  view.rerender(<SiemContent />);
  fireEvent.click(screen.getByRole("button", { name: "Retry destinations" }));
  expect(state.list.refetch).toHaveBeenCalled();
  state.list.isError = false;
  state.list.isLoading = true;
  view.rerender(<SiemContent />);
  expect(screen.getByText(/Loading destinations/)).toBeVisible();
});
it("keeps read-only controls and safe command errors separate", () => {
  state.list.data.items = [
    {
      ...destination,
      authorityUserId: null,
      health: { ...destination.health, oldestPendingAt: null },
    },
  ];
  state.session.permissions.can_edit_connectors = false;
  state.session.permissions.can_create_connectors = false;
  state.command.error = "SIEM action failed";
  state.command.pending = true;
  render(<SiemContent />);
  fireEvent.change(screen.getByLabelText("Current destination"), {
    target: { value: id },
  });
  expect(
    screen.queryByRole("button", { name: "Test collector" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/Your public draft is preserved/)).toBeVisible();
  expect(screen.getByText(/SIEM action in progress/)).toBeVisible();
  expect(screen.queryByLabelText("Bearer token")).not.toBeInTheDocument();
});
