// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../../_lib/http/api-client";
import {
  ConnectorDetailContent,
  DiagnosticsExportButton,
  isMappingIncomplete,
} from "./connector-detail-content";
import type { FieldAuthorityPolicy } from "../../_features/connectors/connectors.schemas";

const connectorId = "11111111-1111-4111-8111-111111111111";
const exportDiagnostics = vi.fn();

const state = vi.hoisted(() => ({
  pending: true,
  hasData: true,
  failed: false,
  error: null as unknown,
  loading: false,
  canView: false,
  canExport: false,
  organizationId: "22222222-2222-4222-8222-222222222222",
  refetch: vi.fn(),
}));
const overview = {
  connector: {
    id: connectorId,
    organizationId: state.organizationId,
    connectorType: "reference_conformance",
    displayName: "Reference fixture",
    adapterVersion: "1.0.0",
    mappingVersion: "v1",
    connectionConfig: {},
    hasSecret: true,
    commitPolicy: "manual",
    enabled: true,
    lastTestedAt: null,
    lastTestOutcome: null,
    lastTestErrorCode: null,
    archivedAt: null,
    version: 1,
    createdAt: "2026-09-28T10:00:00.000Z",
    createdBy: connectorId,
    updatedAt: "2026-09-28T10:00:00.000Z",
    updatedBy: connectorId,
  },
  connection: { status: "healthy" },
};
vi.mock("../../_features/connectors/connectors.queries", () => ({
  useConnectorOverviewQuery: () => ({
    isPending: state.pending,
    isError: state.failed,
    error: state.error,
    data: state.hasData ? { overview } : undefined,
    refetch: state.refetch,
  }),
  useConnectorMappingQuery: () => ({ data: undefined }),
  useExportDiagnosticsMutation: () => ({
    isPending: false,
    mutateAsync: exportDiagnostics,
  }),
}));
vi.mock("../../_providers/providers", () => ({ useMocksReady: () => true }));
vi.mock("../../_providers/session-provider", () => ({
  useSession: () => ({
    session: {
      user: { id: connectorId },
      organization: { id: state.organizationId },
      organizations: [{ id: state.organizationId }],
    },
    permissions: {
      can_view_connectors: state.canView,
      can_export_connectors: state.canExport,
    },
    role: "owner",
    isLoading: state.loading,
  }),
}));
vi.mock("./connector-connection-section", () => ({
  ConnectorConnectionSection: () => <p>Connection section</p>,
}));
vi.mock("./connector-mapping-section", () => ({
  ConnectorMappingSection: () => <p>Mapping section</p>,
}));
vi.mock("./connector-sync-run-section", () => ({
  ConnectorSyncRunSection: ({
    onSelectRun,
  }: {
    onSelectRun: (id: string) => void;
  }) => <button onClick={() => onSelectRun("selected-run")}>Select run</button>,
}));
vi.mock("./connector-conflicts-section", () => ({
  ConnectorConflictsSection: ({ runId }: { runId: string | null }) => (
    <p>Conflicts: {runId ?? "none"}</p>
  ),
}));
vi.mock("./connector-dead-letters-section", () => ({
  ConnectorDeadLettersSection: () => <p>Dead letters section</p>,
}));

describe("DiagnosticsExportButton", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("downloads a redacted diagnostics report as a local JSON Blob", async () => {
    exportDiagnostics.mockResolvedValue({
      filename: "connector-diagnostic-reference-connector.json",
      report: {
        generatedAt: "2026-08-20T10:00:00.000Z",
        connectorId,
        connectorStatus: "completed",
        cursorAgeSeconds: 12,
        latestRun: null,
        counts: { openConflicts: 0, deadLetters: 0, retries: 0 },
      },
    });
    const createObjectUrl = vi.fn<(blob: Blob) => string>(
      () => "blob:connector-diagnostics",
    );
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    render(<DiagnosticsExportButton connectorId={connectorId} />);
    fireEvent.click(screen.getByRole("button", { name: "Export diagnostics" }));
    await waitFor(() => expect(exportDiagnostics).toHaveBeenCalledTimes(1));
    expect(createObjectUrl).toHaveBeenCalledOnce();
    const [blob] = createObjectUrl.mock.calls[0]!;
    expect(blob).toBeInstanceOf(Blob);
    expect((blob as Blob).type).toBe("application/json;charset=utf-8");
    expect((blob as Blob).size).toBeGreaterThan(0);
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:connector-diagnostics");
  });

  it("shows an error message when the export fails", async () => {
    exportDiagnostics.mockRejectedValue(new Error("boom"));
    render(<DiagnosticsExportButton connectorId={connectorId} />);
    fireEvent.click(screen.getByRole("button", { name: "Export diagnostics" }));
    await waitFor(() =>
      expect(
        screen.getByText("The diagnostics export failed."),
      ).toBeInTheDocument(),
    );
  });
});

describe("ConnectorDetailContent", () => {
  const environment = process.env.NEXT_PUBLIC_ENABLE_MOCKS;

  afterEach(() => {
    cleanup();
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = environment;
    state.hasData = true;
    state.pending = true;
    state.failed = false;
    state.loading = false;
    state.canView = false;
    state.canExport = false;
    state.organizationId = "22222222-2222-4222-8222-222222222222";
  });

  it("shows the forbidden state when the viewer cannot view this connector", () => {
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = "false";
    render(<ConnectorDetailContent connectorId={connectorId} />);
    expect(
      screen.getByText("You do not have permission to view this connector."),
    ).toBeInTheDocument();
  });

  it("requires an explicit authority policy for every supported sync field", () => {
    const productPolicies = [
      "name",
      "internalCode",
      "productType",
      "description",
      "parentExternalId",
    ].map((fieldName, index) => ({
      id: `11111111-1111-4111-8111-1111111111${String(index).padStart(2, "0")}`,
      connectorId,
      entityType: "product" as const,
      fieldName,
      policyValue: "external_authoritative" as const,
      protected: false,
      protectedReason: null,
      policyVersion: 1,
    })) as FieldAuthorityPolicy[];
    const releasePolicies = ["label", "releaseVersion", "description"].map(
      (fieldName, index) =>
        ({
          id: `22222222-2222-4222-8222-2222222222${String(index).padStart(2, "0")}`,
          connectorId,
          entityType: "release" as const,
          fieldName,
          policyValue: "external_authoritative" as const,
          protected: false,
          protectedReason: null,
          policyVersion: 1,
        }) as FieldAuthorityPolicy,
    );
    const complete = [...productPolicies, ...releasePolicies];

    expect(isMappingIncomplete(complete)).toBe(false);
    expect(isMappingIncomplete(complete.slice(0, -1))).toBe(true);
  });
});

describe("detail overview states and tenant draft lifetime", () => {
  const environment = process.env.NEXT_PUBLIC_ENABLE_MOCKS;
  afterEach(() => {
    cleanup();
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = environment;
    state.hasData = true;
    state.pending = true;
    state.failed = false;
    state.loading = false;
    state.canView = false;
    state.canExport = false;
    state.organizationId = "22222222-2222-4222-8222-222222222222";
  });
  it("renders live backend and loading states", () => {
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = "true";
    const { rerender } = render(
      <ConnectorDetailContent connectorId={connectorId} />,
    );
    expect(
      screen.getByText(
        "Connectors are available when the live backend is enabled.",
      ),
    ).toBeInTheDocument();
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = "false";
    state.canView = true;
    state.loading = true;
    rerender(<ConnectorDetailContent connectorId={connectorId} />);
    expect(screen.getByText("Loading connector…")).toBeInTheDocument();
    state.loading = false;
    rerender(<ConnectorDetailContent connectorId={connectorId} />);
    expect(screen.getByText("Loading connector…")).toBeInTheDocument();
  });
  it.each([
    [
      new ApiClientError("api", "Missing", 404),
      "This connector is unavailable.",
    ],
    [new ApiClientError("api", "Safe outage", 503), "Safe outage"],
    [new Error("upstream-canary"), "This connector could not be loaded."],
  ])("shows safe error recovery", (error, message) => {
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = "false";
    state.canView = true;
    state.pending = false;
    state.failed = true;
    state.error = error;
    state.hasData = false;
    render(<ConnectorDetailContent connectorId={connectorId} />);
    expect(screen.getByText(message)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(state.refetch).toHaveBeenCalled();
  });
  it("preserves operational sections and clears selected run on tenant change", () => {
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = "false";
    state.canView = true;
    state.pending = false;
    state.canExport = true;
    const { rerender } = render(
      <ConnectorDetailContent connectorId={connectorId} />,
    );
    expect(screen.getByText("Reference fixture")).toBeInTheDocument();
    expect(screen.getByText("Connection section")).toBeInTheDocument();
    expect(screen.getByText("Mapping section")).toBeInTheDocument();
    expect(screen.getByText("Dead letters section")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Export diagnostics" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select run" }));
    expect(screen.getByText("Conflicts: selected-run")).toBeInTheDocument();
    state.organizationId = "another-organization";
    state.canExport = false;
    rerender(<ConnectorDetailContent connectorId={connectorId} />);
    expect(screen.getByText("Conflicts: none")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Export diagnostics" }),
    ).not.toBeInTheDocument();
  });
});

it("preserves the connection workspace during a failed background refresh", () => {
  process.env.NEXT_PUBLIC_ENABLE_MOCKS = "false";
  state.pending = false;
  state.canView = true;
  state.failed = true;
  state.hasData = true;
  state.error = new ApiClientError("network", "Offline");
  render(<ConnectorDetailContent connectorId={connectorId} />);
  expect(screen.getByText("Connection section")).toBeInTheDocument();
  expect(
    screen.getByText(
      "Current data could not be refreshed. Your unsaved draft is preserved.",
    ),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
  expect(state.refetch).toHaveBeenCalled();
  cleanup();
  state.failed = false;
  state.canView = false;
  state.pending = true;
});

vi.mock("./connector-field-map-section", () => ({
  ConnectorFieldMapSection: () => <p>Source field mapping</p>,
}));
vi.mock("./connector-sync-history-section", () => ({
  ConnectorSyncHistorySection: () => <p>Sync history</p>,
}));
