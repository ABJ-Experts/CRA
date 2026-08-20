// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectorConnectionSection } from "./connector-connection-section";
import type { Connector } from "../../_features/connectors/connectors.schemas";

const CONNECTOR: Connector = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  connectorType: "reference_conformance",
  displayName: "Reference PLM",
  adapterVersion: "1.0.0",
  mappingVersion: "1.0.0",
  connectionConfig: {},
  commitPolicy: "manual",
  enabled: true,
  lastTestedAt: null,
  lastTestOutcome: null,
  lastTestErrorCode: null,
  archivedAt: null,
  version: 1,
  createdAt: "2026-08-01T00:00:00.000Z",
  createdBy: "33333333-3333-4333-8333-333333333333",
  updatedAt: "2026-08-01T00:00:00.000Z",
  updatedBy: "33333333-3333-4333-8333-333333333333",
  hasSecret: false,
};

const test = vi.fn().mockResolvedValue(undefined);
let testPending = false;

vi.mock("../../_features/connectors/connectors.queries", () => ({
  useUpdateConnectorMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useSetConnectorSecretMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useTestConnectorMutation: () => ({
    isPending: testPending,
    mutateAsync: test,
  }),
}));

describe("ConnectorConnectionSection", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    testPending = false;
  });

  it("shows not-tested-yet before any test has run", () => {
    render(
      <ConnectorConnectionSection
        connector={CONNECTOR}
        canEdit
        isOwner
        onReload={vi.fn()}
      />,
    );
    expect(screen.getByText("Not tested yet")).toBeInTheDocument();
  });

  it("shows the testing state while the test mutation is pending", () => {
    testPending = true;
    render(
      <ConnectorConnectionSection
        connector={CONNECTOR}
        canEdit
        isOwner
        onReload={vi.fn()}
      />,
    );
    expect(screen.getByText("Testing…")).toBeInTheDocument();
  });

  it("shows unauthorized for an auth-flavoured failed test", () => {
    render(
      <ConnectorConnectionSection
        connector={{
          ...CONNECTOR,
          lastTestOutcome: "failure",
          lastTestErrorCode: "auth_failed",
        }}
        canEdit
        isOwner
        onReload={vi.fn()}
      />,
    );
    expect(screen.getByText("Unauthorized")).toBeInTheDocument();
  });

  it("shows connection successful after a successful test", () => {
    render(
      <ConnectorConnectionSection
        connector={{ ...CONNECTOR, lastTestOutcome: "success" }}
        canEdit
        isOwner
        onReload={vi.fn()}
      />,
    );
    expect(screen.getByText("Connection successful")).toBeInTheDocument();
  });

  it("calls the test mutation when Test connection is clicked", () => {
    render(
      <ConnectorConnectionSection
        connector={CONNECTOR}
        canEdit
        isOwner
        onReload={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(test).toHaveBeenCalledTimes(1);
  });

  it("shows the secret as not configured, then configured", () => {
    const { rerender } = render(
      <ConnectorConnectionSection
        connector={CONNECTOR}
        canEdit
        isOwner
        onReload={vi.fn()}
      />,
    );
    expect(screen.getByText("Not configured")).toBeInTheDocument();
    rerender(
      <ConnectorConnectionSection
        connector={{ ...CONNECTOR, hasSecret: true }}
        canEdit
        isOwner
        onReload={vi.fn()}
      />,
    );
    expect(screen.getByText("Configured")).toBeInTheDocument();
  });

  it("never renders the secret value, and hides the rotate form from non-owners", () => {
    render(
      <ConnectorConnectionSection
        connector={{ ...CONNECTOR, hasSecret: true }}
        canEdit
        isOwner={false}
        onReload={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        "Only the organization owner can set or rotate this connector's secret.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Rotate secret" }),
    ).not.toBeInTheDocument();
  });
});
