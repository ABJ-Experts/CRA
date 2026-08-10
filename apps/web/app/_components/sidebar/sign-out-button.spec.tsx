// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  signOut: vi.fn(),
  clear: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ clear: state.clear }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: state.replace, refresh: state.refresh }),
}));

vi.mock("../../_features/session/session.api", () => ({
  sessionApi: { signOut: state.signOut },
}));

import { SignOutButton } from "./sign-out-button";

beforeEach(() => {
  state.signOut.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SignOutButton", () => {
  it("revokes the server session and clears cached client data before replacing the dashboard route", async () => {
    const user = userEvent.setup();
    render(<SignOutButton collapsed={false} />);

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(state.signOut).toHaveBeenCalledOnce());
    expect(state.clear).toHaveBeenCalledOnce();
    expect(state.replace).toHaveBeenCalledWith("/sign-in");
    expect(state.refresh).toHaveBeenCalledOnce();
    expect(state.signOut.mock.invocationCallOrder[0]).toBeLessThan(
      state.clear.mock.invocationCallOrder[0]!,
    );
    expect(state.clear.mock.invocationCallOrder[0]).toBeLessThan(
      state.replace.mock.invocationCallOrder[0]!,
    );
  });

  it("keeps the user on the page and explains a sign-out failure", async () => {
    const user = userEvent.setup();
    state.signOut.mockRejectedValue(new Error("network unavailable"));
    render(<SignOutButton collapsed={false} />);

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(
      await screen.findByText("We couldn't sign you out. Try again."),
    ).toBeVisible();
    expect(state.clear).not.toHaveBeenCalled();
    expect(state.replace).not.toHaveBeenCalled();
  });

  it("keeps its accessible name when the sidebar is collapsed", () => {
    render(<SignOutButton collapsed />);

    expect(screen.getByRole("button", { name: "Sign out" })).toBeVisible();
  });
});
