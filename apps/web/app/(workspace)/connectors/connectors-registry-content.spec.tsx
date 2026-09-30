// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  Connector,
  ConnectorConnectionState,
} from "@repo/contracts/connectors/types";

import { ApiClientError } from "../../_lib/http/api-client";
import { ConnectorsRegistryContent } from "./connectors-registry-content";

const CONNECTOR = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  connectorType: "reference_conformance",
  displayName: "Reference PLM",
  adapterVersion: "1.0.0",
  mappingVersion: "1.0.0",
  connectionConfig: {},
  archivedAt: null,
  hasSecret: false,
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
} satisfies Connector;

const CONNECTION: ConnectorConnectionState = {
  status: "not_connected",
  reason: "disabled",
  lastSyncAt: null,
  connectionRevision: 1,
  credentialRevision: 0,
  scope: {
    status: "not_applicable",
    policyVersion: "2026-09-28.1",
    requiredScopes: [],
    grantedScopes: [],
    missingScopes: [],
    excessScopes: [],
    warnings: [],
    checkedAt: null,
  },
  test: {
    category: "not_tested",
    message: "Test this connection after configuration or credential changes.",
    checkedAt: null,
  },
};

const create = vi.fn().mockResolvedValue({ connector: CONNECTOR });
const push = vi.fn();
const catalogue = {
  isPending: false,
  isError: false,
  error: null as unknown,
  refetch: vi.fn(),
  data: { catalogue: [] },
};
const state = {
  session: {
    session: {
      user: { id: "33333333-3333-4333-8333-333333333333" },
      organization: { id: "22222222-2222-4222-8222-222222222222" },
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
        rows: [
          {
            connector: CONNECTOR,
            connection: {
              ...CONNECTION,
              status: "not_connected",
              reason: "disabled",
              lastSyncAt: null as string | null,
              connectionRevision: 1,
              credentialRevision: 0,
            },
          },
        ],
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
  useConnectorOverviewsQuery: () => state.connectors,
  useConnectorCatalogueQuery: () => catalogue,
  useCreateConnectorMutation: () => ({
    isPending: false,
    mutateAsync: create,
  }),
}));
vi.mock("../../_providers/providers", () => ({ useMocksReady: () => true }));
vi.mock("../../_providers/session-provider", () => ({
  useSession: () => state.session,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

describe("ConnectorsRegistryContent", () => {
  const environment = process.env.NEXT_PUBLIC_ENABLE_MOCKS;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = "false";
    catalogue.isPending = false;
    catalogue.isError = false;
    state.connectors.isPending = false;
    state.connectors.isError = false;
    state.session.isLoading = false;
    state.connectors.data.connectors.rows = [
      {
        connector: CONNECTOR,
        connection: {
          ...CONNECTION,
          status: "not_connected",
          reason: "disabled",
          lastSyncAt: null,
          connectionRevision: 1,
          credentialRevision: 0,
        },
      },
    ];
    state.connectors.data.connectors.pageCount = 1;
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
    expect(screen.getByText("not connected")).toBeInTheDocument();
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

describe("registry operational states", () => {
  const environment = process.env.NEXT_PUBLIC_ENABLE_MOCKS;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = "false";
    state.session.permissions.can_view_connectors = true;
    state.session.permissions.can_create_connectors = true;
    state.session.isLoading = false;
    state.connectors.isError = false;
    state.connectors.isPending = false;
    catalogue.isError = false;
    catalogue.isPending = false;
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = environment;
  });
  it("renders loading and provider outage retry states independently", () => {
    catalogue.isPending = true;
    state.connectors.isPending = true;
    const { rerender } = render(<ConnectorsRegistryContent />);
    expect(
      screen.getByText("Loading integration catalogue…"),
    ).toBeInTheDocument();
    catalogue.isPending = false;
    catalogue.isError = true;
    state.connectors.isPending = false;
    state.connectors.isError = true;
    catalogue.error = new Error("provider canary");
    state.connectors.error = new ApiClientError("network", "Offline");
    rerender(<ConnectorsRegistryContent />);
    expect(
      screen.getByText("The integration catalogue could not be loaded."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("We could not reach the connector registry."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry catalogue" }));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(catalogue.refetch).toHaveBeenCalled();
    expect(state.connectors.refetch).toHaveBeenCalled();
  });
  it("supports empty search, bounded pagination and opening a connection", () => {
    state.connectors.data.connectors.rows = [];
    const { rerender } = render(<ConnectorsRegistryContent />);
    expect(
      screen.getByText("No connectors have been configured yet."),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "missing" },
    });
    expect(
      screen.getByText("No connectors match this search."),
    ).toBeInTheDocument();
    state.connectors.data.connectors.rows = [
      {
        connector: CONNECTOR,
        connection: {
          ...CONNECTION,
          status: "healthy",
          reason: "ready",
          lastSyncAt: "2026-09-28T10:00:00.000Z",
          connectionRevision: 1,
          credentialRevision: 1,
        },
      },
    ];
    state.connectors.data.connectors.pageCount = 2;
    rerender(<ConnectorsRegistryContent />);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Page 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Open connector Reference PLM" }),
    );
    expect(push).toHaveBeenCalledWith(`/connectors/${CONNECTOR.id}`);
  });
  it("creates the reference adapter with parsed metadata and preserves a rejected draft", async () => {
    state.connectors.data.connectors.rows = [];
    render(<ConnectorsRegistryContent />);
    fireEvent.click(screen.getByRole("button", { name: "Add connector" }));
    fireEvent.change(
      screen.getByLabelText("Connection config (JSON, no secrets)"),
      { target: { value: "{" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Add connector" }));
    expect(
      screen.getByText("Connection config must be valid JSON."),
    ).toBeInTheDocument();
    fireEvent.change(
      screen.getByLabelText("Connection config (JSON, no secrets)"),
      { target: { value: "{}" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Add connector" }));
    expect(create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Reference fixture" },
    });
    fireEvent.change(screen.getByLabelText("Adapter version"), {
      target: { value: "1.0.0" },
    });
    fireEvent.change(screen.getByLabelText("Mapping version"), {
      target: { value: "v1" },
    });
    fireEvent.change(screen.getByLabelText("Commit policy"), {
      target: { value: "auto" },
    });
    create.mockRejectedValueOnce(new Error("provider canary"));
    fireEvent.click(screen.getByRole("button", { name: "Add connector" }));
    expect(
      await screen.findByText("The connector could not be created."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Display name")).toHaveValue(
      "Reference fixture",
    );
    fireEvent.click(screen.getByRole("button", { name: "Add connector" }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(`/connectors/${CONNECTOR.id}`),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorType: "reference_conformance",
        idempotencyKey: expect.any(String),
      }),
    );
  });
  it("creates a scoped GitHub App connector without placing credentials in its config", async () => {
    state.connectors.data.connectors.rows = [];
    render(<ConnectorsRegistryContent />);
    fireEvent.click(screen.getByRole("button", { name: "Add connector" }));
    fireEvent.change(screen.getByLabelText("Connector type"), {
      target: { value: "github_actions" },
    });
    expect(
      screen.getByText(/Contents: read for release tag verification/i),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "GitHub App" },
    });
    fireEvent.change(screen.getByLabelText("GitHub App ID"), {
      target: { value: "123" },
    });
    fireEvent.change(screen.getByLabelText("GitHub installation ID"), {
      target: { value: "456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add connector" }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          connectorType: "github_actions",
          commitPolicy: "manual",
          connectionConfig: {
            providerHost: "github.com",
            appId: "123",
            installationId: "456",
          },
        }),
      ),
    );
    expect(JSON.stringify(create.mock.lastCall?.[0])).not.toContain(
      "secretValue",
    );
  });
  it("shows mocks and session loading without making availability claims", () => {
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = "true";
    const { rerender } = render(<ConnectorsRegistryContent />);
    expect(
      screen.getByText(
        "Connectors are available when the live backend is enabled.",
      ),
    ).toBeInTheDocument();
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = "false";
    state.session.isLoading = true;
    rerender(<ConnectorsRegistryContent />);
    expect(screen.getByText("Loading connectors…")).toBeInTheDocument();
  });
});
