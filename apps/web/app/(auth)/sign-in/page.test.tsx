import { render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import SignInPage from "./page";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  search: "",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

vi.mock("../_components/auth-actions", () => ({ signIn: mocks.signIn }));

describe("SignInPage", () => {
  it("uses the server sign-in POST as its no-JavaScript fallback", () => {
    render(createElement(SignInPage));

    const form = screen.getByTestId("sign-in-form");
    expect(form).toHaveAttribute("method", "post");
    expect(form).toHaveAttribute("action", "/api/auth/sign-in");
  });

  it("shows a generic native-form failure without rendering submitted credentials", () => {
    mocks.search = "error=invalid_credentials";
    render(createElement(SignInPage));

    expect(screen.getByTestId("sign-in-error")).toHaveTextContent(
      "That email and password do not match.",
    );
  });
});
