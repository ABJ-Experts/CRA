// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { securityApi } from "../../_features/security/security.api";
import { ApiClientError } from "../../_lib/http/api-client";
import SecurityPage from "./page";

vi.mock("../../_features/security/security.api", async () => {
  const actual = await vi.importActual<
    typeof import("../../_features/security/security.api")
  >("../../_features/security/security.api");
  return {
    ...actual,
    securityApi: {
      listFactors: vi.fn(),
      enroll: vi.fn(),
      confirmEnrollment: vi.fn(),
    },
  };
});

describe("SecurityPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("completes enrollment through securityApi and still shows one-time codes", async () => {
    vi.mocked(securityApi.listFactors).mockResolvedValue({ enrolled: false });
    vi.mocked(securityApi.enroll).mockResolvedValue({
      factorId: "factor-1",
      qrCode: "data:image/svg+xml;base64,abc",
      secret: "ABC123",
      uri: "otpauth://totp/CRA",
    });
    vi.mocked(securityApi.confirmEnrollment).mockResolvedValue({
      recoveryCodes: ["code-one", "code-two"],
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    render(
      <QueryClientProvider client={queryClient}>
        <SecurityPage />
      </QueryClientProvider>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Set up two-factor" }),
    );
    expect(await screen.findByText("ABC123")).toBeTruthy();
    fireEvent.change(screen.getByTestId("mfa-confirm-code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));

    await waitFor(() =>
      expect(securityApi.confirmEnrollment).toHaveBeenCalledWith(
        "factor-1",
        "123456",
      ),
    );
    expect(await screen.findByText("code-one")).toBeTruthy();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["mfa"] });
  });

  it("surfaces an enrollment error without leaving the idle step", async () => {
    vi.mocked(securityApi.listFactors).mockResolvedValue({ enrolled: false });
    vi.mocked(securityApi.enroll).mockRejectedValue(
      new ApiClientError("api", "A factor already exists.", 409),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <SecurityPage />
      </QueryClientProvider>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Set up two-factor" }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "A factor already exists.",
    );
    expect(
      screen.getByRole("button", { name: "Set up two-factor" }),
    ).toBeTruthy();
  });

  it("keeps enrollment open when confirmation is rejected", async () => {
    vi.mocked(securityApi.listFactors).mockResolvedValue({ enrolled: false });
    vi.mocked(securityApi.enroll).mockResolvedValue({
      factorId: "factor-1",
      qrCode: "data:image/svg+xml;base64,abc",
      secret: "ABC123",
      uri: "otpauth://totp/CRA",
    });
    vi.mocked(securityApi.confirmEnrollment).mockRejectedValue(
      new ApiClientError("api", "Check your authenticator app.", 400),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <SecurityPage />
      </QueryClientProvider>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Set up two-factor" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Turn on" }));

    expect(
      await screen.findByText("Check your authenticator app."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByRole("button", { name: "Set up two-factor" }),
    ).toBeTruthy();
  });
});
