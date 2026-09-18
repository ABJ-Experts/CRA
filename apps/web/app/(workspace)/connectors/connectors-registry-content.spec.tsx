// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConnectorsRegistryContent } from "./connectors-registry-content";

const CONNECTOR = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  connectorType: "reference_conformance",
  displayName: "Reference PLM",
  adapterVersion: "1.0.0",
  mappingVersion: "1.0.0",
  connectionConfig: {},
  commitPolicy: "manual",
  enabled: false,
  lastTestedAt: null,
  lastTestOutcome: null,
  lastTestErrorCode: null,
  version: 1,
  createdAt: "2026-08-01T00:00:00.000Z",
  createdBy: "33333333-3333-4333-8333-333333333333",
  updatedAt: "2026-08-01T00:00:00.000Z",
  updatedBy: "33333333-3333-4333-8333-333333333333",
} as const;

const state = {
  session: {
    session: {
      user: { id: "33333333-3333-4333-8333-333333333333" },
      organizations: [{ id: "22222222-2222-4222-8222-222222222222" }],
    },
    permissions: { can_view_connectors: true, can_create_connectors: true },
    isLoading: false,
  },
  connectors: {
    isPending: false,
    isError: false,
    error: null as unknown,
    data: {
      connectors: {
        rows: [CONNECTOR],
        total: 1,
        page: 1,
        pageSize: 25,
        pageCount: 1,
      },
    },
    refetch: vi.fn(),
  },
};

vi.mock("../../_features/connectors/connectors.queries", () => ({
  useConnectorsQuery: () => state.connectors,
  useCreateConnectorMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
}));
vi.mock("../../_providers/providers", () => ({ useMocksReady: () => true }));
vi.mock("../../_providers/session-provider", () => ({
  useSession: () => state.session,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("ConnectorsRegistryContent", () => {
  const environment = process.env.NEXT_PUBLIC_ENABLE_MOCKS;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = "false";
    state.session.permissions = {
      can_view_connectors: true,
      can_create_connectors: true,
    };
  });

  afterEach(() => {
    cleanup();
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = environment;
  });

  it("renders the connector card with a disconnected badge when disabled", () => {
    render(<ConnectorsRegistryContent />);
    expect(screen.getByText("Reference PLM")).toBeInTheDocument();
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
  });

  it("shows the forbidden state when the viewer cannot view connectors", () => {
    state.session.permissions = {
      can_view_connectors: false,
      can_create_connectors: false,
    };
    render(<ConnectorsRegistryContent />);
    expect(
      screen.getByText("You do not have permission to view connectors."),
    ).toBeInTheDocument();
  });
});
