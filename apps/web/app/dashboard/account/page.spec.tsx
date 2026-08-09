// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { accountApi } from "../../_features/account/account.api";
import { ApiClientError } from "../../_lib/http/api-client";
import AccountPage from "./page";

const invalidateQueries = vi.fn(async () => undefined);

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));
vi.mock("../../_features/account/account.api", () => ({
  accountApi: { updateProfile: vi.fn() },
}));
vi.mock("../../_providers/session-provider", () => {
  const state = {
    session: {
      user: {
        email: "ada@example.com",
        firstName: "Ada",
        lastName: "Lovelace",
      },
    },
    isLoading: false,
  };
  return { useSession: () => state };
});

describe("AccountPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("saves through accountApi and preserves session invalidation", async () => {
    vi.mocked(accountApi.updateProfile).mockResolvedValue({ ok: true });
    render(<AccountPage />);

    const firstName = screen.getByTestId(
      "account-first-name",
    ) as HTMLInputElement;
    await waitFor(() => expect(firstName.value).toBe("Ada"));
    fireEvent.change(firstName, {
      target: { value: "Augusta" },
    });
    fireEvent.change(screen.getByTestId("account-job-title"), {
      target: { value: "Programmer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(accountApi.updateProfile).toHaveBeenCalledWith({
        firstName: "Augusta",
        lastName: "Lovelace",
        jobTitle: "Programmer",
      }),
    );
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["session"] });
    expect(screen.getByRole("status").textContent).toContain("Saved.");
  });

  it("preserves a server-provided profile error", async () => {
    vi.mocked(accountApi.updateProfile).mockRejectedValue(
      new ApiClientError("api", "That name is unavailable.", 409),
    );
    render(<AccountPage />);

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect((await screen.findByRole("status")).textContent).toContain(
      "That name is unavailable.",
    );
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it("preserves the connection error copy", async () => {
    vi.mocked(accountApi.updateProfile).mockRejectedValue(
      new ApiClientError("network", "generic transport copy"),
    );
    render(<AccountPage />);

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect((await screen.findByRole("status")).textContent).toContain(
      "We could not reach the server.",
    );
  });
});
