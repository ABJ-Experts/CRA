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
vi.mock("../../_features/notifications/notification-preferences-panel", () => ({
  NotificationPreferencesPanel: () => <div>Notification preferences panel</div>,
}));
vi.mock("../../_providers/session-provider", () => {
  const state = {
    session: {
      user: {
        email: "ada@example.com",
        firstName: "Ada",
        lastName: "Lovelace",
        jobTitle: "Mathematician",
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
    expect(screen.getByTestId("account-job-title")).toHaveValue(
      "Mathematician",
    );
    fireEvent.change(firstName, {
      target: { value: "Augusta" },
    });
    fireEvent.change(screen.getByTestId("account-job-title"), {
      target: { value: "Programmer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(accountApi.updateProfile).toHaveBeenCalledWith(
        {
          firstName: "Augusta",
          lastName: "Lovelace",
          jobTitle: "Programmer",
        },
        expect.objectContaining({
          idempotencyKey: expect.any(String),
          correlationId: expect.any(String),
        }),
      ),
    );
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["session"] });
    expect(screen.getByRole("status").textContent).toContain("Saved.");
  });

  it("keeps a key for explicit retry and rotates it after an edited profile", async () => {
    vi.mocked(accountApi.updateProfile)
      .mockRejectedValueOnce(new ApiClientError("network", "Connection lost"))
      .mockResolvedValue({ ok: true });
    render(<AccountPage />);
    const firstName = screen.getByTestId(
      "account-first-name",
    ) as HTMLInputElement;
    await waitFor(() => expect(firstName.value).toBe("Ada"));
    fireEvent.change(firstName, { target: { value: "Augusta" } });

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(accountApi.updateProfile).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save changes" }),
      ).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(accountApi.updateProfile).toHaveBeenCalledTimes(2),
    );

    const first = vi.mocked(accountApi.updateProfile).mock.calls[0]?.[1];
    expect(vi.mocked(accountApi.updateProfile).mock.calls[1]?.[1]).toEqual(
      first,
    );
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("Saved."),
    );

    fireEvent.change(firstName, { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(accountApi.updateProfile).toHaveBeenCalledTimes(3),
    );
    expect(
      vi.mocked(accountApi.updateProfile).mock.calls[2]?.[1]?.idempotencyKey,
    ).not.toBe(first?.idempotencyKey);
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
