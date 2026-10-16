// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../_providers/session-provider", () => ({
  SessionProvider: ({ children }: { children: ReactNode }) => (
    <section data-testid="session-provider">{children}</section>
  ),
}));
vi.mock("./workspace-shell", () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => (
    <main data-testid="workspace-shell">{children}</main>
  ),
}));

import WorkspaceLayout from "./layout";

afterEach(() => {
  vi.clearAllMocks();
});

describe("WorkspaceLayout", () => {
  it("mounts the session boundary only for authenticated workspace routes", () => {
    render(
      <WorkspaceLayout>
        <p>workspace content</p>
      </WorkspaceLayout>,
    );

    expect(screen.getByTestId("session-provider")).toContainElement(
      screen.getByTestId("workspace-shell"),
    );
    expect(screen.getByText("workspace content")).toBeVisible();
  });
});
