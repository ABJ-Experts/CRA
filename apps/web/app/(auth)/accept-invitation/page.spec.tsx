// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { invitationsApi } from "../../_features/invitations/invitations.api";
import { ApiClientError } from "../../_lib/http/api-client";
import AcceptInvitationPage from "./page";

const push = vi.fn();
const navigation = vi.hoisted(() => ({ query: "token=invitation-token" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(navigation.query),
}));
vi.mock("../../_features/invitations/invitations.api", () => ({
  invitationsApi: { accept: vi.fn() },
}));

describe("AcceptInvitationPage", () => {
  afterEach(() => {
    cleanup();
    navigation.query = "token=invitation-token";
    vi.clearAllMocks();
  });

  it("accepts through invitationsApi and preserves the success outcome", async () => {
    vi.mocked(invitationsApi.accept).mockResolvedValue({
      ok: true,
      alreadyAccepted: false,
      organization: {
        id: "a05570d6-aa75-4b6a-9688-b5a82eb3a774",
        name: "Analytical Engines",
        slug: "analytical-engines",
      },
    });
    render(<AcceptInvitationPage />);

    expect(await screen.findByText("You are in")).toBeTruthy();
    expect(
      screen.getByText("You now have access to Analytical Engines."),
    ).toBeTruthy();
    expect(invitationsApi.accept).toHaveBeenCalledWith("invitation-token");
  });

  it("accepts a token only once when Strict Mode repeats effects", async () => {
    vi.mocked(invitationsApi.accept).mockResolvedValue({
      ok: true,
      alreadyAccepted: false,
      organization: {
        id: "a05570d6-aa75-4b6a-9688-b5a82eb3a774",
        name: "Analytical Engines",
        slug: "analytical-engines",
      },
    });
    render(
      <StrictMode>
        <AcceptInvitationPage />
      </StrictMode>,
    );

    expect(await screen.findByText("You are in")).toBeTruthy();
    expect(invitationsApi.accept).toHaveBeenCalledTimes(1);
  });

  it("rejects a link without a token before calling the API", async () => {
    navigation.query = "";
    render(<AcceptInvitationPage />);

    expect(
      await screen.findByText("That invitation link is missing its token."),
    ).toBeTruthy();
    expect(invitationsApi.accept).not.toHaveBeenCalled();
  });

  it("preserves the sign-in return URL after a 401", async () => {
    vi.mocked(invitationsApi.accept).mockRejectedValue(
      new ApiClientError("api", "Unauthorized", 401),
    );
    render(<AcceptInvitationPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));

    expect(push).toHaveBeenCalledWith(
      "/sign-in?returnUrl=%2Faccept-invitation%3Ftoken%3Dinvitation-token",
    );
  });

  it("preserves the invalid-link message when local parsing rejects the token", async () => {
    vi.mocked(invitationsApi.accept).mockRejectedValue(
      new ApiClientError("invalid_request", "Invalid request data."),
    );
    render(<AcceptInvitationPage />);

    expect(
      await screen.findByText("That invitation link is not valid."),
    ).toBeVisible();
  });

  it("can retry a server rejection and finish idempotently", async () => {
    vi.mocked(invitationsApi.accept)
      .mockRejectedValueOnce(new ApiClientError("api", "Try again.", 503))
      .mockResolvedValueOnce({
        ok: true,
        alreadyAccepted: true,
        organization: {
          id: "a05570d6-aa75-4b6a-9688-b5a82eb3a774",
          name: "Analytical Engines",
          slug: "analytical-engines",
        },
      });
    render(<AcceptInvitationPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByText("You are already a member")).toBeTruthy();
    expect(invitationsApi.accept).toHaveBeenCalledTimes(2);
  });
});
