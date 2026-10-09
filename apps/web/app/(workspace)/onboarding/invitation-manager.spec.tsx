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

import { InvitationManager } from "./invitation-manager";
import { ApiClientError } from "../../_lib/http/api-client";

const invitationQueries = vi.hoisted(() => ({
  useInvitationListQuery: vi.fn(),
  useCreateInvitationMutation: vi.fn(),
  useResendInvitationMutation: vi.fn(),
  useRevokeInvitationMutation: vi.fn(),
}));

vi.mock(
  "../../_features/invitations/invitations.queries",
  () => invitationQueries,
);

const pendingInvitation = {
  id: "a05570d6-aa75-4b6a-9688-b5a82eb3a774",
  email: "team@example.com",
  role: "member",
  status: "pending",
  expiresAt: "2026-08-17T10:00:00.000Z",
} as const;

const list = {
  isPending: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
  data: {
    rows: [pendingInvitation],
  },
};
const create = { mutateAsync: vi.fn(), isPending: false };
const resend = { mutateAsync: vi.fn(), isPending: false };
const revoke = { mutateAsync: vi.fn(), isPending: false };

beforeEach(() => {
  invitationQueries.useInvitationListQuery.mockReturnValue(list);
  invitationQueries.useCreateInvitationMutation.mockReturnValue(create);
  invitationQueries.useResendInvitationMutation.mockReturnValue(resend);
  invitationQueries.useRevokeInvitationMutation.mockReturnValue(revoke);
  create.mutateAsync.mockResolvedValue({ id: pendingInvitation.id });
  resend.mutateAsync.mockResolvedValue({
    id: pendingInvitation.id,
    delivery: "confirmed",
  });
  revoke.mutateAsync.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InvitationManager", () => {
  it("creates a role-assigned invitation and presents the existing pending invitation", async () => {
    render(<InvitationManager canView canCreate canDelete />);

    fireEvent.change(
      screen.getByRole("textbox", { name: "Team member email" }),
      {
        target: { value: "NEW@EXAMPLE.COM" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));

    await waitFor(() =>
      expect(create.mutateAsync).toHaveBeenCalledWith({
        email: "new@example.com",
        role: "member",
      }),
    );
    expect(screen.getByText("team@example.com")).toBeVisible();
    expect(
      screen.getByText("Invitation sent and delivery confirmed."),
    ).toBeVisible();
  });

  it("uses the same invitation row for resend and revoke", async () => {
    render(<InvitationManager canView canCreate canDelete />);

    fireEvent.click(screen.getByRole("button", { name: "Resend" }));
    await waitFor(() =>
      expect(resend.mutateAsync).toHaveBeenCalledWith(pendingInvitation.id),
    );
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(revoke.mutateAsync).toHaveBeenCalledWith(pendingInvitation.id),
    );
  });

  it("keeps invitation mutations unavailable to a viewer", () => {
    render(<InvitationManager canView canCreate={false} canDelete={false} />);

    expect(
      screen.getByText(/cannot send one with your current role/i),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Resend" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Revoke" }),
    ).not.toBeInTheDocument();
  });

  it("shows a forbidden message without reading invitations", () => {
    render(
      <InvitationManager canView={false} canCreate={false} canDelete={false} />,
    );

    expect(
      screen.getByText(/do not have access to the organization’s invitations/i),
    ).toBeVisible();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("handles invitation loading, retryable errors, and an empty list", () => {
    const refetch = vi.fn();
    invitationQueries.useInvitationListQuery.mockReturnValue({
      ...list,
      isPending: true,
    });
    const view = render(<InvitationManager canView canCreate canDelete />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading invitations");

    invitationQueries.useInvitationListQuery.mockReturnValue({
      ...list,
      isError: true,
      error: new ApiClientError(
        "api",
        "Invitation service is unavailable",
        503,
      ),
      refetch,
    });
    view.rerender(<InvitationManager canView canCreate canDelete />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Invitation service is unavailable",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledOnce();

    invitationQueries.useInvitationListQuery.mockReturnValue({
      ...list,
      data: { rows: [] },
    });
    view.rerender(<InvitationManager canView canCreate canDelete />);
    expect(
      screen.getByText("No invitations have been sent yet."),
    ).toBeVisible();
  });

  it("retains the invitation form value and shows the server field error", async () => {
    create.mutateAsync.mockRejectedValue(
      new ApiClientError("api", "Validation failed", 400, undefined, {
        email: "That email cannot be invited.",
      }),
    );
    render(<InvitationManager canView canCreate canDelete />);

    const email = screen.getByRole("textbox", { name: "Team member email" });
    fireEvent.change(email, { target: { value: "blocked@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));

    expect(
      await screen.findAllByText("That email cannot be invited."),
    ).toHaveLength(2);
    expect(email).toHaveValue("blocked@example.com");
  });
});
