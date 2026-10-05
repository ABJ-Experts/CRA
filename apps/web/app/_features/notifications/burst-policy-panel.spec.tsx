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
import { BurstPolicyPanel } from "./burst-policy-panel";

const state = vi.hoisted(() => ({
  organizationId: "11111111-1111-4111-8111-111111111111",
  policy: {
    organizationId: "11111111-1111-4111-8111-111111111111",
    enabled: false,
    version: 1,
    enabledAt: null as string | null,
    updatedAt: "2026-10-05T00:00:00.000Z",
    windowSeconds: 120,
    maxEmailMembers: 100,
  },
  loading: false,
  error: null as unknown,
  mutationError: null as unknown,
}));
const actions = vi.hoisted(() => ({
  update: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("../../_providers/session-provider", () => ({
  useSession: () => ({
    session: { organization: { id: state.organizationId } },
  }),
}));
vi.mock("./notifications.queries", () => ({
  useNotificationBurstPolicyQuery: () => ({
    data: state.error ? undefined : { policy: state.policy },
    isLoading: state.loading,
    isError: Boolean(state.error),
    error: state.error,
    refetch: actions.refetch,
  }),
  useUpdateNotificationBurstPolicyMutation: () => ({
    mutateAsync: actions.update,
    isPending: false,
  }),
}));

beforeEach(() => {
  state.organizationId = "11111111-1111-4111-8111-111111111111";
  state.policy = {
    organizationId: state.organizationId,
    enabled: false,
    version: 1,
    enabledAt: null,
    updatedAt: "2026-10-05T00:00:00.000Z",
    windowSeconds: 120,
    maxEmailMembers: 100,
  };
  state.loading = false;
  state.error = null;
  state.mutationError = null;
  actions.update.mockImplementation(async () => {
    if (state.mutationError) throw state.mutationError;
    return { policy: { ...state.policy, enabled: true, version: 2 } };
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BurstPolicyPanel", () => {
  it("shows the opt-in boundary and saves with optimistic version and idempotency", async () => {
    render(<BurstPolicyPanel canManage />);
    expect(screen.getByText(/two minutes or 100 email events/i)).toBeVisible();
    expect(
      screen.getAllByText(/critical alerts.*immediate/i).length,
    ).toBeGreaterThan(0);
    const toggle = screen.getByRole("checkbox", {
      name: /batch eligible notifications/i,
    });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Save burst policy" }));
    await waitFor(() =>
      expect(actions.update).toHaveBeenCalledWith({
        enabled: true,
        expectedVersion: 1,
        idempotencyKey: expect.any(String),
      }),
    );
    await waitFor(() =>
      expect(screen.getByText("Burst policy saved.")).toBeVisible(),
    );
    expect(toggle).toBeChecked();
  });

  it("retains the draft on conflict and offers a refresh", async () => {
    state.mutationError = new ApiClientError("api", "Changed", 409);
    render(<BurstPolicyPanel canManage />);
    fireEvent.click(
      screen.getByRole("checkbox", { name: /batch eligible notifications/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save burst policy" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/changed/i);
    expect(
      screen.getByRole("checkbox", { name: /batch eligible notifications/i }),
    ).toBeChecked();
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh burst policy" }),
    );
    expect(actions.refetch).toHaveBeenCalled();
  });

  it("does not offer mutation controls without management permission", () => {
    render(<BurstPolicyPanel canManage={false} />);
    expect(screen.getByText(/disabled/i)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Save burst policy" }),
    ).toBeNull();
    expect(
      screen.getByRole("checkbox", { name: /batch eligible notifications/i }),
    ).toBeDisabled();
  });

  it("shows loading and forbidden read states with a retry action", () => {
    state.loading = true;
    const view = render(<BurstPolicyPanel canManage />);
    expect(screen.getByRole("status")).toHaveTextContent(
      /Loading burst policy/i,
    );
    state.loading = false;
    state.error = new ApiClientError("api", "Forbidden", 403);
    view.rerender(<BurstPolicyPanel canManage />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      /no longer have permission/i,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry burst policy" }));
    expect(actions.refetch).toHaveBeenCalled();
  });

  it("keeps the enabled draft through a network failure and supports opt-out", async () => {
    state.policy = {
      ...state.policy,
      enabled: true,
      enabledAt: "2026-10-05T00:00:00.000Z",
    };
    state.mutationError = new ApiClientError("network", "Offline");
    render(<BurstPolicyPanel canManage />);
    const toggle = screen.getByRole("checkbox", {
      name: /batch eligible notifications/i,
    });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Save burst policy" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/offline/i);
    expect(toggle).not.toBeChecked();
    expect(actions.update).toHaveBeenCalledWith({
      enabled: false,
      expectedVersion: 1,
      idempotencyKey: expect.any(String),
    });
  });

  it("clears an unsaved draft when the active organization changes", () => {
    const view = render(<BurstPolicyPanel canManage />);
    const toggle = screen.getByRole("checkbox", {
      name: /batch eligible notifications/i,
    });
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    state.organizationId = "22222222-2222-4222-8222-222222222222";
    state.policy = { ...state.policy, organizationId: state.organizationId };
    view.rerender(<BurstPolicyPanel canManage />);
    expect(toggle).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: "Save burst policy" }),
    ).toBeDisabled();
  });
});
