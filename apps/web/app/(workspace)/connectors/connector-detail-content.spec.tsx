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

import {
  ConnectorDetailContent,
  DiagnosticsExportButton,
  isMappingIncomplete,
} from "./connector-detail-content";
import type { FieldAuthorityPolicy } from "../../_features/connectors/connectors.schemas";

const connectorId = "11111111-1111-4111-8111-111111111111";
const exportDiagnostics = vi.fn();

vi.mock("../../_features/connectors/connectors.queries", () => ({
  useConnectorQuery: () => ({
    isPending: true,
    isError: false,
    data: undefined,
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
      user: { id: "33333333-3333-4333-8333-333333333333" },
      organizations: [{ id: "22222222-2222-4222-8222-222222222222" }],
    },
    permissions: { can_view_connectors: false },
    role: "member",
    isLoading: false,
  }),
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
