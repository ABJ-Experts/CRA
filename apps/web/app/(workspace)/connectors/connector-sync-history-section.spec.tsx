// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectorSyncHistorySection } from "./connector-sync-history-section";
const state = vi.hoisted(() => ({
  history: {
    data: {
      runs: {
        rows: [
          {
            run: {
              id: "run",
              status: "failed",
              correlationId: "correlation",
              adapterVersion: "1",
              mappingVersion: "v1",
            },
            startedAt: null,
            finishedAt: null,
            fieldMappingRevision: 2,
            counts: { succeeded: 0, skipped: 0, failed: 1, pending: 2 },
          },
        ],
        page: 1,
        pageCount: 1,
      },
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  detail: {
    data: {
      run: {
        run: { id: "run", status: "failed", correlationId: "correlation" },
      },
      attempts: {
        rows: [
          {
            id: "attempt",
            generation: 2,
            phase: "commit",
            startedAt: null,
            finishedAt: null,
            outcome: "failed",
            errorCategory: "invalid_data",
            errorCode: "invalid_record",
          },
        ],
        page: 1,
        pageCount: 1,
      },
      records: {
        rows: [
          {
            id: "record",
            externalId: "safe-id",
            outcome: "withheld",
            errorCategory: null,
            errorCode: null,
          },
        ],
        page: 1,
        pageCount: 1,
      },
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));
vi.mock("../../_features/connectors/sync-operations.queries", () => ({
  useSyncHistoryQuery: () => state.history,
  useSyncDetailQuery: () => state.detail,
}));
afterEach(cleanup);
describe("durable sync history", () => {
  it("shows reconciled outcomes and explicit unknown timestamps", () => {
    render(<ConnectorSyncHistorySection connectorId="connector" canView />);
    expect(screen.getByText(/0 succeeded/)).toBeInTheDocument();
    expect(screen.getAllByText("Not recorded").length).toBeGreaterThan(0);
    fireEvent.click(
      screen.getByRole("button", { name: "View run details run" }),
    );
    expect(screen.getByText(/invalid_record/)).toBeInTheDocument();
    expect(screen.getByText("withheld")).toBeInTheDocument();
    expect(screen.getByText("correlation")).toBeInTheDocument();
  });
});

describe("history recovery states", () => {
  afterEach(() => {
    state.history.isPending = false;
    state.history.isError = false;
    state.detail.isPending = false;
    state.detail.isError = false;
  });
  it("denies unauthorized history", () => {
    render(
      <ConnectorSyncHistorySection connectorId="connector" canView={false} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("permission");
  });
  it("shows loading and retryable errors", () => {
    state.history.isPending = true;
    const { rerender } = render(
      <ConnectorSyncHistorySection connectorId="connector" canView />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    state.history.isPending = false;
    state.history.isError = true;
    rerender(<ConnectorSyncHistorySection connectorId="connector" canView />);
    fireEvent.click(screen.getByRole("button", { name: "Retry sync history" }));
    expect(state.history.refetch).toHaveBeenCalled();
  });
  it("supports detail loading, outage recovery and close", () => {
    state.detail.isPending = true;
    const { rerender } = render(
      <ConnectorSyncHistorySection connectorId="connector" canView />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "View run details run" }),
    );
    expect(screen.getByText("Loading run details…")).toBeInTheDocument();
    state.detail.isPending = false;
    state.detail.isError = true;
    rerender(<ConnectorSyncHistorySection connectorId="connector" canView />);
    fireEvent.click(screen.getByRole("button", { name: "Retry run details" }));
    expect(state.detail.refetch).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close run details" }));
    expect(
      screen.queryByText("Run details could not be loaded."),
    ).not.toBeInTheDocument();
  });
  it("paginates both detail collections and preserves empty historical facts", () => {
    const originalAttempts = state.detail.data.attempts.rows;
    const originalRecords = state.detail.data.records.rows;
    state.detail.data.attempts.rows = [];
    state.detail.data.records.rows = [];
    state.detail.data.attempts.pageCount = 2;
    render(<ConnectorSyncHistorySection connectorId="connector" canView />);
    fireEvent.click(
      screen.getByRole("button", { name: "View run details run" }),
    );
    expect(screen.getByText(/No attempt details/)).toBeInTheDocument();
    expect(screen.getByText(/No record details/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    state.detail.data.attempts.rows = originalAttempts;
    state.detail.data.records.rows = originalRecords;
    state.detail.data.attempts.pageCount = 1;
  });
  it("renders empty run history and bounded pagination", () => {
    const rows = state.history.data.runs.rows;
    state.history.data.runs.pageCount = 2;
    const { rerender } = render(
      <ConnectorSyncHistorySection connectorId="connector" canView />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    state.history.data.runs.rows = [];
    rerender(<ConnectorSyncHistorySection connectorId="connector" canView />);
    expect(screen.getByText("No sync history yet.")).toBeInTheDocument();
    state.history.data.runs.rows = rows;
    state.history.data.runs.pageCount = 1;
  });
});

vi.mock("./connector-replay-section", () => ({
  ConnectorReplaySection: () => <p>Reviewed replay controls</p>,
}));
it("offers reviewed recovery for failed runs without dead-letter records", () => {
  state.detail.data.run.run = {
    ...state.detail.data.run.run,
    status: "failed",
  };
  render(
    <ConnectorSyncHistorySection connectorId="connector" canView canEdit />,
  );
  fireEvent.click(screen.getByRole("button", { name: "View run details run" }));
  fireEvent.click(screen.getByRole("button", { name: "Review replay" }));
  expect(screen.getByText("Reviewed replay controls")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close replay review" }));
  expect(
    screen.queryByText("Reviewed replay controls"),
  ).not.toBeInTheDocument();
});
