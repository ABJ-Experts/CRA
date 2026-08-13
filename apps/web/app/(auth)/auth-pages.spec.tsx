// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ query: "", push: vi.fn() }));
const actions = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(),
  resendCode: vi.fn(),
  resetPassword: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
  unlock: vi.fn(),
  verifyCode: vi.fn(),
  verifyTwoFactor: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
  useSearchParams: () => new URLSearchParams(navigation.query),
  usePathname: () => "/sign-in",
}));
vi.mock("./_components/auth-actions", () => ({
  ...actions,
  lockedSession: { name: "Ada Lovelace", email: "ada@example.com" },
}));
vi.mock("@repo/ui/otp-input", () => ({
  OtpInput: ({
    value,
    onChange,
    onComplete,
    ariaLabel,
    disabled,
    error,
    ...props
  }: {
    value: string;
    onChange: (value: string) => void;
    onComplete?: (value: string) => void;
    ariaLabel: string;
    disabled?: boolean;
    error?: string | null;
  }) => (
    <label>
      {ariaLabel}
      <input
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next);
          if (next.length === 6) onComplete?.(next);
        }}
        {...props}
      />
      {error ? <span role="alert">{error}</span> : null}
    </label>
  ),
}));

import AuthLayout from "./layout";
import CheckEmailPage from "./check-email/page";
import ExpiredPage from "./expired/page";
import ForgotPasswordPage from "./forgot-password/page";
import LockPage from "./lock/page";
import ResetPasswordPage from "./reset-password/page";
import SignInPage from "./sign-in/page";
import SignUpPage from "./sign-up/page";
import SuccessPage from "./success/page";
import TwoFactorPage from "./two-factor/page";
import VerifyPage from "./verify/page";

beforeEach(() => {
  navigation.query = "";
  actions.requestPasswordReset.mockResolvedValue({ ok: true });
  actions.resendCode.mockResolvedValue({ ok: true });
  actions.resetPassword.mockResolvedValue({ ok: true });
  actions.signIn.mockResolvedValue({ ok: true, next: "dashboard" });
  actions.signUp.mockResolvedValue({ ok: true });
  actions.unlock.mockResolvedValue({ ok: true });
  actions.verifyCode.mockResolvedValue({ ok: true });
  actions.verifyTwoFactor.mockResolvedValue({ ok: true });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("auth pages", () => {
  it("renders the auth shell around the active page", () => {
    render(
      <AuthLayout>
        <p>Current auth page</p>
      </AuthLayout>,
    );

    expect(screen.getByRole("link", { name: "CRA" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("main")).toHaveTextContent("Current auth page");
    expect(screen.getByText(/CRA is Premium UI kits/)).toBeVisible();
  });

  it("renders the link-expired recovery choices", () => {
    render(<ExpiredPage />);

    expect(
      screen.getByRole("heading", { name: "This link has expired" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Request a new link" }),
    ).toHaveAttribute("href", "/forgot-password");
  });

  it("keeps password-reset email copy enumeration-safe", () => {
    navigation.query = "to=ada%40example.com";
    render(<CheckEmailPage />);

    expect(screen.getByText(/If ada@example.com has an account/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Open Gmail" })).toHaveAttribute(
      "rel",
      expect.stringContaining("noopener"),
    );
  });

  it.each([
    ["", "You are all set", "/dashboard"],
    ["of=password", "Password changed", "/sign-in"],
    ["of=account", "Account created", "/dashboard"],
  ])("renders the success outcome for %s", (query, title, href) => {
    navigation.query = query;
    render(<SuccessPage />);

    expect(screen.getByRole("heading", { name: title })).toBeVisible();
    expect(screen.getByTestId("success-cta")).toHaveAttribute("href", href);
  });

  it("submits sign-in credentials and routes to the dashboard", async () => {
    render(<SignInPage />);

    expect(screen.getByTestId("sign-in-form")).toHaveAttribute(
      "method",
      "post",
    );

    fireEvent.change(screen.getByTestId("si-identifier"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.change(screen.getByTestId("si-password"), {
      target: { value: "Password123" },
    });
    fireEvent.click(screen.getByTestId("si-submit"));

    await waitFor(() =>
      expect(actions.signIn).toHaveBeenCalledWith({
        identifier: "ada@example.com",
        password: "Password123",
        remember: true,
      }),
    );
    expect(navigation.push).toHaveBeenCalledWith("/dashboard");
  });

  it("rejects a whitespace-only sign-in identifier at the field boundary", async () => {
    render(<SignInPage />);

    fireEvent.change(screen.getByTestId("si-identifier"), {
      target: { value: "   " },
    });
    fireEvent.change(screen.getByTestId("si-password"), {
      target: { value: "Password123" },
    });
    fireEvent.click(screen.getByTestId("si-submit"));

    expect(
      await screen.findAllByText("Enter your email or user name"),
    ).not.toHaveLength(0);
    expect(actions.signIn).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("routes sign-in through two-factor and exposes provider errors", async () => {
    actions.signIn
      .mockResolvedValueOnce({ ok: true, next: "two-factor" })
      .mockResolvedValueOnce({ ok: false, message: "Account locked" });
    const view = render(<SignInPage />);
    const submit = async () => {
      fireEvent.change(screen.getByTestId("si-identifier"), {
        target: { value: "ada" },
      });
      fireEvent.change(screen.getByTestId("si-password"), {
        target: { value: "Password123" },
      });
      fireEvent.click(screen.getByTestId("si-submit"));
      await waitFor(() => expect(actions.signIn).toHaveBeenCalled());
    };

    await submit();
    expect(navigation.push).toHaveBeenCalledWith("/two-factor");
    view.unmount();
    vi.clearAllMocks();
    render(<SignInPage />);
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Account locked",
    );
  });

  it("creates an account and maps server field errors", async () => {
    actions.signUp.mockResolvedValueOnce({
      ok: false,
      message: "Please review the form",
      fieldErrors: { username: "Already taken" },
    });
    render(<SignUpPage />);

    fireEvent.change(screen.getByTestId("su-email"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.change(screen.getByTestId("su-username"), {
      target: { value: "ada" },
    });
    fireEvent.change(screen.getByTestId("su-password"), {
      target: { value: "Password123" },
    });
    fireEvent.change(screen.getByTestId("su-confirm"), {
      target: { value: "Password123" },
    });
    fireEvent.click(screen.getByTestId("su-submit"));

    expect(await screen.findAllByText("Already taken")).toHaveLength(2);
    expect(
      screen
        .getAllByRole("alert")
        .some((alert) => alert.textContent?.includes("Please review the form")),
    ).toBe(true);
  });

  it("routes a successful account creation to verification", async () => {
    render(<SignUpPage />);
    for (const [testId, value] of [
      ["su-email", "ada@example.com"],
      ["su-username", "ada"],
      ["su-password", "Password123"],
      ["su-confirm", "Password123"],
    ] as const) {
      fireEvent.change(screen.getByTestId(testId), { target: { value } });
    }
    fireEvent.click(screen.getByTestId("su-submit"));

    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith("/verify"),
    );
  });

  it("rejects overlong sign-up emails with the shared field contract", async () => {
    render(<SignUpPage />);
    fireEvent.change(screen.getByTestId("su-email"), {
      target: { value: `${"a".repeat(243)}@example.com` },
    });
    fireEvent.change(screen.getByTestId("su-username"), {
      target: { value: "ada" },
    });
    fireEvent.change(screen.getByTestId("su-password"), {
      target: { value: "Password123" },
    });
    fireEvent.change(screen.getByTestId("su-confirm"), {
      target: { value: "Password123" },
    });
    fireEvent.click(screen.getByTestId("su-submit"));

    expect(
      await screen.findAllByText("That is too long to be an email address"),
    ).not.toHaveLength(0);
    expect(actions.signUp).not.toHaveBeenCalled();
  });

  it("requests a reset without exposing whether the account exists", async () => {
    render(<ForgotPasswordPage />);
    fireEvent.change(screen.getByTestId("fp-email"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(screen.getByTestId("fp-submit"));

    await waitFor(() =>
      expect(actions.requestPasswordReset).toHaveBeenCalledWith({
        email: "ada@example.com",
      }),
    );
    expect(navigation.push).toHaveBeenCalledWith(
      "/check-email?to=ada%40example.com",
    );
  });

  it("does not navigate when the shared reset-email contract rejects input", async () => {
    render(<ForgotPasswordPage />);
    fireEvent.change(screen.getByTestId("fp-email"), {
      target: { value: `${"a".repeat(243)}@example.com` },
    });
    fireEvent.click(screen.getByTestId("fp-submit"));

    expect(
      await screen.findByText("That is too long to be an email address"),
    ).toBeVisible();
    expect(actions.requestPasswordReset).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("unlocks the known session and reports a rejected password", async () => {
    actions.unlock.mockResolvedValueOnce({
      ok: false,
      message: "Wrong password",
    });
    render(<LockPage />);
    expect(screen.getByText("Ada Lovelace")).toBeVisible();

    fireEvent.change(screen.getByTestId("lock-password"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByTestId("lock-submit"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Wrong password",
    );
  });

  it("resets a password and redirects expired tokens to recovery", async () => {
    navigation.query = "token=expired";
    actions.resetPassword.mockResolvedValueOnce({
      ok: false,
      message: "This link expired",
    });
    render(<ResetPasswordPage />);
    fireEvent.change(screen.getByTestId("rp-password"), {
      target: { value: "Password123" },
    });
    fireEvent.change(screen.getByTestId("rp-confirm"), {
      target: { value: "Password123" },
    });
    fireEvent.click(screen.getByTestId("rp-submit"));

    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith("/expired"),
    );
  });

  it("verifies an email code and clears a rejected-code error on edit", async () => {
    navigation.query = "to=ada%40example.com";
    actions.verifyCode.mockResolvedValueOnce({
      ok: false,
      message: "Code reused",
    });
    render(<VerifyPage />);
    const code = screen.getByRole("textbox", { name: "Verification code" });

    fireEvent.change(code, { target: { value: "123456" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Code reused");
    fireEvent.change(code, { target: { value: "12345" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("supports authenticator and recovery-code two-factor paths", async () => {
    const user = userEvent.setup();
    render(<TwoFactorPage />);
    const code = screen.getByRole("textbox", { name: "Authentication code" });
    fireEvent.change(code, { target: { value: "123456" } });
    await waitFor(() =>
      expect(actions.verifyTwoFactor).toHaveBeenCalledWith({
        code: "123456",
        recovery: false,
      }),
    );
    expect(navigation.push).toHaveBeenCalledWith("/dashboard");

    await user.click(screen.getByTestId("tf-switch"));
    fireEvent.change(screen.getByTestId("tf-recovery"), {
      target: { value: "RECOVERY-CODE" },
    });
    fireEvent.click(screen.getByTestId("tf-submit"));
    await waitFor(() =>
      expect(actions.verifyTwoFactor).toHaveBeenCalledWith({
        code: "RECOVERY-CODE",
        recovery: true,
      }),
    );
  });
});
