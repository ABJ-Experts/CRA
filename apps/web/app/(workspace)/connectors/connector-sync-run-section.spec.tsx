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

import { ApiClientError } from "../../_lib/http/api-client";
import { ConnectorSyncRunSection } from "./connector-sync-run-section";
import type { SyncRun } from "../../_features/connectors/connectors.schemas";

const connectorId = "11111111-1111-4111-8111-111111111111";
const runId = "66666666-6666-4666-8666-666666666666";

function baseRun(overrides: Partial<SyncRun> = {}): SyncRun {
  return {
    id: runId,
    organizationId: "22222222-2222-4222-8222-222222222222",
    connectorId,
    reconciliationKind: "incremental",
    workKind: "dry_run",
    status: "waiting_for_review",
    adapterVersion: "1.0.0",
    mappingVersion: "1.0.0",
    cursorFrom: null,
    cursorTo: null,
    fetchContentHash: null,
    planBasisDigest: null,
    rowCount: 6,
    counts: {
      create: 1,
      update: 2,
      unchanged: 3,
      skip: 0,
      conflict: 0,
      tombstone: 0,
      cycleBlocked: 0,
    },
    estimatedGraphImpact: {},
    errorCode: null,
    retryCount: 0,
    correlationId: "33333333-3333-4333-8333-333333333333",
    expiresAt: "2026-08-20T00:00:00.000Z",
    committedAt: null,
    canceledAt: null,
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T00:00:00.000Z",
    ...overrides,
  };
}

const start = vi.fn().mockResolvedValue({ run: baseRun() });
const requestCommit = vi.fn().mockResolvedValue({ run: baseRun() });
const cancel = vi.fn().mockResolvedValue({ run: baseRun() });
const retry = vi.fn().mockResolvedValue({ run: baseRun() });

const historyResult = {
  data: {
    runs: {
      rows: [] as SyncRun[],
      total: 0,
      page: 1,
      pageSize: 5,
      pageCount: 1,
    },
  },
};
const planQuery = vi.fn();
const planRefetch = vi.fn();
const planQueryResult = {
  data: {
    planItems: {
      rows: [] as {
        entityType: string;
        externalId: string;
        proposedAction: string;
        issues: { severity: string; message: string }[];
      }[],
      total: 0,
      page: 1,
      pageSize: 25,
      pageCount: 1,
    },
  },
  isPending: false,
  isError: false,
  refetch: planRefetch,
};

const runQueryResult: {
  data: { run: SyncRun } | undefined;
  isPending: boolean;
} = { data: undefined, isPending: false };

vi.mock("../../_features/connectors/connectors.queries", () => ({
  useConnectorSyncRunsQuery: () => historyResult,
  useSyncRunQuery: () => runQueryResult,
  usePlanItemsQuery: (...args: unknown[]) => {
    planQuery(...args);
    return planQueryResult;
  },
  useStartSyncRunMutation: () => ({ isPending: false, mutateAsync: start }),
  useRequestCommitMutation: () => ({
    isPending: false,
    mutateAsync: requestCommit,
  }),
  useCancelSyncRunMutation: () => ({ isPending: false, mutateAsync: cancel }),
  useRetrySyncRunMutation: () => ({ isPending: false, mutateAsync: retry }),
}));

function renderSection(
  props: Partial<{
    mappingIncomplete: boolean;
    canApprove: boolean;
    canStart: boolean;
    canManage: boolean;
    canView: boolean;
  }> = {},
) {
  return render(
    <ConnectorSyncRunSection
      connectorId={connectorId}
      canView={props.canView ?? true}
      canStart={props.canStart ?? true}
      canManage={props.canManage ?? true}
      canApprove={props.canApprove ?? true}
      mappingIncomplete={props.mappingIncomplete ?? false}
      onSelectRun={vi.fn()}
    />,
  );
}

describe("ConnectorSyncRunSection", () => {
  beforeEach(() => {
    start.mockResolvedValue({ run: baseRun() });
    requestCommit.mockResolvedValue({ run: baseRun() });
    cancel.mockResolvedValue({ run: baseRun() });
    historyResult.data.runs.rows = [];
    runQueryResult.data = undefined;
    runQueryResult.isPending = false;
    planQueryResult.isPending = false;
    planQueryResult.isError = false;
    planQueryResult.data = {
      planItems: { rows: [], total: 6, page: 1, pageSize: 25, pageCount: 1 },
    };
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("blocks starting a dry run while the mapping is incomplete", () => {
    renderSection({ mappingIncomplete: true });
    expect(
      screen.getByText(
        "Configure every required field authority policy before starting a sync.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start dry run (incremental)" }),
    ).toBeDisabled();
  });

  it("starts a dry run with the chosen reconciliation kind", async () => {
    start.mockResolvedValue({ run: baseRun({ status: "running" }) });
    renderSection();
    fireEvent.click(
      screen.getByRole("button", { name: "Start dry run (incremental)" }),
    );
    await waitFor(() =>
      expect(start).toHaveBeenCalledWith(
        expect.objectContaining({ reconciliationKind: "incremental" }),
      ),
    );
  });

  it("does not offer start to an editor without create permission", () => {
    renderSection({ canStart: false, canManage: true });
    expect(
      screen.queryByRole("button", { name: "Start dry run (incremental)" }),
    ).not.toBeInTheDocument();
  });

  it("disables Request commit while conflicts are open", () => {
    runQueryResult.data = {
      run: baseRun({
        status: "waiting_for_review",
        counts: {
          create: 1,
          update: 2,
          unchanged: 3,
          skip: 0,
          conflict: 2,
          tombstone: 0,
          cycleBlocked: 0,
        },
      }),
    };
    renderSection();
    expect(
      screen.getByRole("button", { name: "Request commit" }),
    ).toBeDisabled();
  });

  it("enables Request commit once waiting for review with no open conflicts", async () => {
    runQueryResult.data = {
      run: baseRun({ status: "waiting_for_review" }),
    };
    renderSection();
    const commitButton = screen.getByRole("button", { name: "Request commit" });
    expect(commitButton).toBeEnabled();
    fireEvent.click(commitButton);
    await waitFor(() => expect(requestCommit).toHaveBeenCalledTimes(1));
  });

  it("fetches the plan only after the selected dry run finishes planning", async () => {
    runQueryResult.data = { run: baseRun({ status: "queued" }) };
    const view = renderSection();
    fireEvent.click(
      screen.getByRole("button", { name: "Start dry run (incremental)" }),
    );
    await waitFor(() =>
      expect(planQuery).toHaveBeenLastCalledWith(
        connectorId,
        runId,
        { page: 1, pageSize: 25 },
        false,
      ),
    );
    runQueryResult.data = { run: baseRun() };
    view.rerender(
      <ConnectorSyncRunSection
        connectorId={connectorId}
        canView
        canStart
        canManage
        canApprove
        mappingIncomplete={false}
        onSelectRun={vi.fn()}
      />,
    );
    expect(planQuery).toHaveBeenLastCalledWith(
      connectorId,
      runId,
      { page: 1, pageSize: 25 },
      true,
    );
  });

  it.each(["loading", "error"])(
    "withholds commit while the plan is %s",
    (state) => {
      runQueryResult.data = { run: baseRun() };
      planQueryResult.isPending = state === "loading";
      planQueryResult.isError = state === "error";
      renderSection();
      expect(
        screen.getByRole("button", { name: "Request commit" }),
      ).toBeDisabled();
    },
  );

  it("blocks a stale cached empty plan until its count matches the current run", () => {
    runQueryResult.data = { run: baseRun({ rowCount: 1 }) };
    planQueryResult.data.planItems.total = 0;
    const view = renderSection();
    expect(
      screen.getByRole("button", { name: "Request commit" }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        "The plan changed. Reload all plan items before requesting commit.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry plan items" }));
    expect(planRefetch).toHaveBeenCalledOnce();
    planQueryResult.data = {
      planItems: { ...planQueryResult.data.planItems, total: 1 },
    };
    view.rerender(
      <ConnectorSyncRunSection
        connectorId={connectorId}
        canView
        canStart
        canManage
        canApprove
        mappingIncomplete={false}
        onSelectRun={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Request commit" }),
    ).toBeEnabled();
  });

  it("offers an explicit retry after the plan request fails", () => {
    runQueryResult.data = { run: baseRun() };
    planQueryResult.isError = true;
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Retry plan items" }));
    expect(planRefetch).toHaveBeenCalledOnce();
  });

  it("shows the selected record plan and preserves pagination controls", async () => {
    runQueryResult.data = { run: baseRun({ rowCount: 30 }) };
    planQueryResult.data.planItems = {
      rows: [
        {
          entityType: "product",
          externalId: "safe-1",
          proposedAction: "pending_required_fields",
          issues: [{ severity: "error", message: "Name required" }],
        },
        {
          entityType: "product",
          externalId: "safe-2",
          proposedAction: "create",
          issues: [],
        },
      ],
      total: 30,
      page: 1,
      pageSize: 25,
      pageCount: 2,
    };
    const view = renderSection();
    fireEvent.click(
      screen.getByRole("button", { name: "Start dry run (incremental)" }),
    );
    await waitFor(() =>
      expect(planQuery).toHaveBeenLastCalledWith(
        connectorId,
        runId,
        { page: 1, pageSize: 25 },
        true,
      ),
    );
    expect(screen.getByText("safe-1")).toBeInTheDocument();
    expect(screen.getByText("pending required fields")).toBeInTheDocument();
    expect(screen.getByText("error: Name required")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Previous page" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(planQuery).toHaveBeenLastCalledWith(
      connectorId,
      runId,
      { page: 2, pageSize: 25 },
      true,
    );
    planQueryResult.data = {
      planItems: { ...planQueryResult.data.planItems, page: 2 },
    };
    view.rerender(
      <ConnectorSyncRunSection
        connectorId={connectorId}
        canView
        canStart
        canManage
        canApprove
        mappingIncomplete={false}
        onSelectRun={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(planQuery).toHaveBeenLastCalledWith(
      connectorId,
      runId,
      { page: 1, pageSize: 25 },
      true,
    );
  });

  it("selects existing history and shows commit work while running", () => {
    historyResult.data.runs.rows = [
      baseRun({ status: "completed", reconciliationKind: "full" }),
    ];
    runQueryResult.data = {
      run: baseRun({ status: "running", workKind: "commit" }),
    };
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(planQuery).toHaveBeenLastCalledWith(
      connectorId,
      runId,
      { page: 1, pageSize: 25 },
      true,
    );
    expect(
      screen.getByText("Incremental reconciliation · Commit"),
    ).toBeInTheDocument();
    expect(screen.getByText("Full")).toBeInTheDocument();
  });

  it("denies viewing and approval independently", () => {
    runQueryResult.data = { run: baseRun() };
    renderSection({ canView: false });
    expect(
      screen.getByText("You do not have permission to view sync runs."),
    ).toBeInTheDocument();
    cleanup();
    renderSection({ canApprove: false });
    expect(
      screen.getByRole("button", { name: "Request commit" }),
    ).toBeDisabled();
  });

  it("cancels with an explicit reason and reports completion", async () => {
    runQueryResult.data = { run: baseRun() };
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(cancel).toHaveBeenCalledWith({
        reason: "Canceled from the sync run screen.",
      }),
    );
    expect(await screen.findByText("Sync run canceled.")).toBeInTheDocument();
  });

  it.each([
    [
      new ApiClientError("api", "denied", 403),
      "You do not have permission to perform that action.",
    ],
    [
      new ApiClientError("api", "stale", 409),
      "This sync run changed in another session. Refresh it before trying again.",
    ],
    [
      new ApiClientError("network", "offline"),
      "We could not reach the connector registry.",
    ],
    [
      new ApiClientError("api", "Safe provider unavailable", 503),
      "Safe provider unavailable",
    ],
    [new Error("internal"), "The sync run could not be started."],
  ])(
    "reports safe start failures with explicit retry possible",
    async (error, message) => {
      start.mockRejectedValueOnce(error);
      renderSection();
      fireEvent.click(
        screen.getByRole("button", { name: "Start dry run (full)" }),
      );
      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Start dry run (full)" }),
      ).toBeEnabled();
    },
  );

  it("reports a failed commit request without claiming success", async () => {
    requestCommit.mockRejectedValueOnce(new Error("internal"));
    runQueryResult.data = { run: baseRun() };
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Request commit" }));
    expect(
      await screen.findByText("The commit could not be requested."),
    ).toBeInTheDocument();
  });

  it("reports a failed cancellation without claiming success", async () => {
    cancel.mockRejectedValueOnce(new Error("internal"));
    runQueryResult.data = { run: baseRun({ status: "retrying" }) };
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      await screen.findByText("The sync run could not be canceled."),
    ).toBeInTheDocument();
  });

  it("offers cancel while running and hides it once completed", () => {
    runQueryResult.data = { run: baseRun({ status: "running" }) };
    const { rerender } = renderSection();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();

    runQueryResult.data = { run: baseRun({ status: "completed" }) };
    rerender(
      <ConnectorSyncRunSection
        connectorId={connectorId}
        canView
        canStart
        canManage
        canApprove
        mappingIncomplete={false}
        onSelectRun={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Cancel" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("directs failed runs to reviewed replay", async () => {
    runQueryResult.data = {
      run: baseRun({ status: "failed", errorCode: "provider_timeout" }),
    };
    renderSection();
    expect(screen.getByText("provider_timeout")).toBeInTheDocument();
    expect(
      screen.getByText(/Review failed records in Dead letters/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();
    expect(retry).not.toHaveBeenCalled();
  });

  it("directs editors without create permission to reviewed replay", async () => {
    runQueryResult.data = {
      run: baseRun({ status: "failed", errorCode: "provider_timeout" }),
    };
    renderSection({ canStart: false, canManage: true });
    expect(
      screen.getByText(/Review failed records in Dead letters/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();
    expect(retry).not.toHaveBeenCalled();
  });
});
