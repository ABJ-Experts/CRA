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

import { ConnectorConflictsSection } from "./connector-conflicts-section";
import type { SyncConflict } from "../../_features/connectors/connectors.schemas";
import { ApiClientError } from "../../_lib/http/api-client";

const connectorId = "11111111-1111-4111-8111-111111111111";
const runId = "66666666-6666-4666-8666-666666666666";

function baseConflict(overrides: Partial<SyncConflict> = {}): SyncConflict {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    organizationId: "22222222-2222-4222-8222-222222222222",
    connectorId,
    syncRunId: runId,
    entityType: "product",
    entityId: "88888888-8888-4888-8888-888888888888",
    externalIdentityId: "99999999-9999-4999-8999-999999999999",
    fieldPath: "name",
    craValue: "Sentinel",
    craValueSource: "cra_manual_entry",
    craValueObservedAt: "2026-08-19T00:00:00.000Z",
    externalValue: "Sentinel Pro",
    externalValueObservedAt: "2026-08-19T00:00:00.000Z",
    conflictKind: "field_value",
    authorityPolicyId: null,
    permittedActions: ["accept_external", "keep_cra", "enter_manual_value"],
    resolutionStatus: "open",
    resolutionChosenAction: null,
    resolutionReason: null,
    resolutionValue: null,
    resolvedAt: null,
    resolvedBy: null,
    detectedAt: "2026-08-19T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

const resolve = vi.fn();
let conflictsResult: {
  data: { conflicts: SyncConflict[] } | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
};

vi.mock("../../_features/connectors/connectors.queries", () => ({
  useConnectorSyncRunsQuery: () => ({
    data: {
      runs: {
        rows: [{ id: runId }],
        total: 1,
        page: 1,
        pageSize: 1,
        pageCount: 1,
      },
    },
  }),
  useRunConflictsQuery: () => conflictsResult,
  useResolveConflictMutation: () => ({
    isPending: false,
    mutateAsync: resolve,
  }),
}));

describe("ConnectorConflictsSection", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the forbidden state when the viewer cannot view conflicts", () => {
    conflictsResult = {
      data: undefined,
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    };
    render(
      <ConnectorConflictsSection
        connectorId={connectorId}
        runId={null}
        canView={false}
        canApprove={false}
      />,
    );
    expect(
      screen.getByText("You do not have permission to view sync conflicts."),
    ).toBeInTheDocument();
  });

  it("lists open conflicts with both values and defaults to the connector's most recent run", () => {
    conflictsResult = {
      data: { conflicts: [baseConflict()] },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    };
    render(
      <ConnectorConflictsSection
        connectorId={connectorId}
        runId={null}
        canView
        canApprove
      />,
    );
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText('"Sentinel"')).toBeInTheDocument();
    expect(screen.getByText('"Sentinel Pro"')).toBeInTheDocument();
  });

  it("submits the chosen action, manual value, and reason on resolve", async () => {
    conflictsResult = {
      data: { conflicts: [baseConflict()] },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    };
    resolve.mockResolvedValue({
      conflict: baseConflict({ resolutionStatus: "resolved" }),
    });
    render(
      <ConnectorConflictsSection
        connectorId={connectorId}
        runId={runId}
        canView
        canApprove
      />,
    );
    fireEvent.change(screen.getByLabelText("Resolution"), {
      target: { value: "enter_manual_value" },
    });
    fireEvent.change(screen.getByLabelText("Manual value"), {
      target: { value: "Sentinel Renamed" },
    });
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "Confirmed with vendor" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        conflictId: baseConflict().id,
        input: expect.objectContaining({
          chosenAction: "enter_manual_value",
          manualValue: "Sentinel Renamed",
          reason: "Confirmed with vendor",
          expectedVersion: 1,
        }),
      }),
    );
  });

  it("shows the reload prompt on a stale (409) resolve", async () => {
    conflictsResult = {
      data: { conflicts: [baseConflict()] },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    };
    resolve.mockRejectedValue(
      new ApiClientError("api", "Conflict changed", 409, "conflict"),
    );
    render(
      <ConnectorConflictsSection
        connectorId={connectorId}
        runId={runId}
        canView
        canApprove
      />,
    );
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "Confirmed with vendor" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Reload current data" }),
      ).toBeInTheDocument(),
    );
  });

  it("hides the resolve form and explains the missing permission for a viewer", () => {
    conflictsResult = {
      data: { conflicts: [baseConflict()] },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    };
    render(
      <ConnectorConflictsSection
        connectorId={connectorId}
        runId={runId}
        canView
        canApprove={false}
      />,
    );
    expect(
      screen.getByText("You do not have permission to resolve conflicts."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Resolve" }),
    ).not.toBeInTheDocument();
  });
});
