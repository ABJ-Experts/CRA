// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthArt } from "./_components/auth-art";
import {
  AuthDivider,
  AuthFooter,
  AuthLogo,
  AuthTitle,
} from "./_components/auth-chrome";
import { AuthFooterSlot } from "./_components/auth-footer-slot";
import { AuthOutcome } from "./_components/auth-outcome";
import { AuthQuote } from "./_components/auth-quote";
import { PasswordStrength } from "./_components/password-strength";
import { ResendButton } from "./_components/resend-button";
import { SocialButtons } from "./_components/social-buttons";

const navigation = vi.hoisted(() => ({ pathname: "/sign-in" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

beforeEach(() => {
  navigation.pathname = "/sign-in";
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("auth presentation components", () => {
  it("renders the shared chrome with accessible navigation and optional copy", () => {
    render(
      <>
        <AuthLogo className="custom-logo" />
        <AuthTitle title="Welcome back" description="Use your work account" />
        <AuthTitle title="Title only" />
        <AuthFooter prompt="New here?" href="/sign-up" action="Sign up" />
        <AuthDivider>or continue with</AuthDivider>
      </>,
    );

    expect(screen.getByRole("link", { name: "CRA" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("link", { name: "CRA" })).toHaveClass(
      "custom-logo",
    );
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    expect(screen.getByText("Use your work account")).toBeVisible();
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute(
      "href",
      "/sign-up",
    );
    expect(screen.getByText("or continue with")).toBeVisible();
  });

  it("selects the route-specific footer and omits unsupported routes", () => {
    const view = render(<AuthFooterSlot />);
    expect(screen.getByRole("link", { name: "Sign Up" })).toHaveAttribute(
      "href",
      "/sign-up",
    );

    navigation.pathname = "/verify";
    view.rerender(<AuthFooterSlot />);
    expect(screen.getByRole("link", { name: "Start over" })).toHaveAttribute(
      "href",
      "/sign-up",
    );

    navigation.pathname = "/forgot-password";
    view.rerender(<AuthFooterSlot />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it.each([
    ["accent", "bg-accent-subtle"],
    ["success", "bg-success-surface"],
    ["danger", "bg-danger-surface"],
    ["warning", "bg-warning-surface"],
  ] as const)("renders the %s outcome tone", (tone, token) => {
    const { container } = render(
      <AuthOutcome
        tone={tone}
        icon={<span>icon</span>}
        title={`${tone} result`}
        description="Helpful detail"
      >
        <button type="button">Continue</button>
      </AuthOutcome>,
    );

    expect(
      screen.getByRole("heading", { name: `${tone} result` }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Continue" })).toBeVisible();
    expect(container.querySelector("[aria-hidden='true']")).toHaveClass(token);
  });

  it("renders auth artwork with theme-specific images and without a product", () => {
    const view = render(
      <AuthArt image="/light.svg" imageDark={null} className="art" />,
    );
    const art = view.container.querySelector("svg");
    const images = view.container.querySelectorAll("image");

    expect(art).toHaveAttribute("aria-hidden", "true");
    expect(art).toHaveClass("art");
    expect(images).toHaveLength(2);
    expect(images[0]).toHaveAttribute("href", "/light.svg");
    expect(images[1]).toHaveAttribute("href", "/light.svg");

    view.rerender(<AuthArt image={null} />);
    expect(view.container.querySelector("image")).not.toBeInTheDocument();
  });

  it("reports password requirements for empty, weak, and strong values", () => {
    const view = render(<PasswordStrength value="" />);
    expect(screen.getByTestId("pw-strength-label")).toHaveTextContent(
      "Too short",
    );

    view.rerender(<PasswordStrength value="Password1" />);
    expect(screen.getByTestId("pw-strength-label")).toHaveTextContent("Good");
    expect(screen.getByTestId("pw-strength-label")).toHaveTextContent(
      "12 characters or more",
    );

    view.rerender(<PasswordStrength value="StrongPassword1" />);
    expect(screen.getByTestId("pw-strength-label")).toHaveTextContent("Strong");
    expect(screen.getByTestId("pw-strength-label")).not.toHaveTextContent(
      "add",
    );
  });

  it("supports quote selection, rotation, reduced motion, and a single quote", () => {
    vi.useFakeTimers();
    const quotes = ["First quote", "Second quote"];
    const view = render(<AuthQuote quotes={quotes} interval={1000} />);

    fireEvent.click(screen.getByRole("button", { name: "Show quote 2 of 2" }));
    expect(screen.getByText("Second quote")).toBeVisible();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText("First quote")).toBeVisible();

    view.rerender(<AuthQuote quotes={["Only quote"]} interval={0} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("pauses quote rotation when reduced motion is requested", () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    render(<AuthQuote quotes={["First", "Second"]} interval={100} />);

    act(() => vi.advanceTimersByTime(500));

    expect(screen.getByText("First")).toBeVisible();
  });

  it("counts down before resending and restarts after success", async () => {
    vi.useFakeTimers();
    const onResend = vi.fn(async () => undefined);
    render(<ResendButton seconds={1} onResend={onResend} />);

    expect(screen.getByTestId("resend")).toBeDisabled();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByTestId("resend")).toHaveTextContent("Resend");

    await act(async () => {
      fireEvent.click(screen.getByTestId("resend"));
      await Promise.resolve();
    });
    expect(onResend).toHaveBeenCalledOnce();
    expect(screen.getByTestId("resend")).toHaveTextContent("Resend in 1s");
  });

  it("dispatches provider actions and honors the disabled state", async () => {
    const user = userEvent.setup();
    const onGoogle = vi.fn();
    const onSso = vi.fn();
    const view = render(
      <SocialButtons action="Sign Up" onGoogle={onGoogle} onSso={onSso} />,
    );

    await user.click(
      screen.getByRole("button", { name: "Sign Up with Google" }),
    );
    await user.click(screen.getByRole("button", { name: "Sign Up with SSO" }));
    expect(onGoogle).toHaveBeenCalledOnce();
    expect(onSso).toHaveBeenCalledOnce();

    view.rerender(<SocialButtons disabled />);
    expect(
      screen.getByRole("button", { name: "Sign In with Google" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Sign In with SSO" }),
    ).toBeDisabled();
  });
});
