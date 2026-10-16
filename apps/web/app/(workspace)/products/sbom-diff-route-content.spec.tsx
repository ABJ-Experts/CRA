// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SbomDiffRouteContent } from "./sbom-diff-route-content";

const state = vi.hoisted(() => ({
  permissions: {},
  isLoading: false,
  mocksReady: true,
}));

vi.mock("../../_providers/session-provider", () => ({
  useSession: () => ({
    permissions: state.permissions,
    isLoading: state.isLoading,
  }),
}));

vi.mock("../../_providers/providers", () => ({
  useMocksReady: () => state.mocksReady,
}));

vi.mock("./sbom-diff-report", () => ({
  SbomDiffReport: ({
    canView,
    canStart,
    enabled,
  }: {
    canView: boolean;
    canStart: boolean;
    enabled: boolean;
  }) => (
    <div
      data-testid="diff-props"
      data-can-view={String(canView)}
      data-can-start={String(canStart)}
      data-enabled={String(enabled)}
    />
  ),
}));

describe("SbomDiffRouteContent", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    state.permissions = {};
    state.isLoading = false;
    state.mocksReady = true;
  });

  it("shows the loading comparison state instead of a false forbidden state while permissions load", () => {
    state.isLoading = true;

    render(
      <SbomDiffRouteContent
        productId="11111111-1111-4111-8111-111111111111"
        documentId="22222222-2222-4222-8222-222222222222"
        sourceId="33333333-3333-4333-8333-333333333333"
      />,
    );

    const props = screen.getByTestId("diff-props");
    expect(props).toHaveAttribute("data-can-view", "true");
    expect(props).toHaveAttribute("data-enabled", "false");
  });
});
