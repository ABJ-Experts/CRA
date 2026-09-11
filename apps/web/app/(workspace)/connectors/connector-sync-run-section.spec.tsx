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

const runQueryResult: {
  data: { run: SyncRun } | undefined;
  isPending: boolean;
} = { data: undefined, isPending: false };

vi.mock("../../_features/connectors/connectors.queries", () => ({
  useConnectorSyncRunsQuery: () => ({
    data: { runs: { rows: [], total: 0, page: 1, pageSize: 5, pageCount: 1 } },
  }),
  useSyncRunQuery: () => runQueryResult,
  usePlanItemsQuery: () => ({
    data: {
      planItems: { rows: [], total: 0, page: 1, pageSize: 25, pageCount: 1 },
    },
    isPending: false,
    isError: false,
  }),
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
  }> = {},
) {
  return render(
    <ConnectorSyncRunSection
      connectorId={connectorId}
      canView
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
    runQueryResult.data = undefined;
    runQueryResult.isPending = false;
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

  it("offers retry only once the run has failed", async () => {
    runQueryResult.data = {
      run: baseRun({ status: "failed", errorCode: "provider_timeout" }),
    };
    renderSection();
    expect(screen.getByText("provider_timeout")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
  });

  it("keeps retry available to an editor without create permission", async () => {
    runQueryResult.data = {
      run: baseRun({ status: "failed", errorCode: "provider_timeout" }),
    };
    renderSection({ canStart: false, canManage: true });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
  });
});
