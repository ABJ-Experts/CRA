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

import { ConnectorDeadLettersSection } from "./connector-dead-letters-section";

const connectorId = "11111111-1111-4111-8111-111111111111";
const runId = "66666666-6666-4666-8666-666666666666";

const retry = vi
  .fn()
  .mockResolvedValue({ run: { id: runId, status: "retrying" } });
const refetch = vi.fn();

let deadLettersResult: {
  data:
    | {
        records: {
          rows: {
            id: string;
            runId: string;
            externalId: string;
            outcome: string;
            errorCode: string | null;
          }[];
        };
      }
    | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
};

vi.mock("../../_features/connectors/sync-operations.queries", () => ({
  useDeadLetterRecordsQuery: () => deadLettersResult,
}));
vi.mock("./connector-replay-section", () => ({
  ConnectorReplaySection: () => <p>Reviewed replay</p>,
}));

describe("ConnectorDeadLettersSection", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the forbidden state when the viewer cannot view dead letters", () => {
    deadLettersResult = {
      data: undefined,
      isPending: false,
      isError: false,
      refetch,
    };
    render(
      <ConnectorDeadLettersSection
        connectorId={connectorId}
        canView={false}
        canEdit={false}
      />,
    );
    expect(
      screen.getByText("You do not have permission to view dead letters."),
    ).toBeInTheDocument();
  });

  it("lists failed runs with their error code", () => {
    deadLettersResult = {
      data: {
        records: {
          rows: [
            {
              id: runId,
              runId,
              externalId: "record-1",
              outcome: "failed",
              errorCode: "provider_timeout",
            },
          ],
        },
      },
      isPending: false,
      isError: false,
      refetch,
    };
    render(
      <ConnectorDeadLettersSection
        connectorId={connectorId}
        canView
        canEdit={false}
      />,
    );
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByText(/provider_timeout/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();
  });

  it("opens a reviewed replay instead of blindly retrying", async () => {
    deadLettersResult = {
      data: {
        records: {
          rows: [
            {
              id: runId,
              runId,
              externalId: "record-1",
              outcome: "failed",
              errorCode: "provider_timeout",
            },
          ],
        },
      },
      isPending: false,
      isError: false,
      refetch,
    };
    render(
      <ConnectorDeadLettersSection connectorId={connectorId} canView canEdit />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Review replay for record-1" }),
    );
    await waitFor(() =>
      expect(screen.getByText("Reviewed replay")).toBeInTheDocument(),
    );
    expect(retry).not.toHaveBeenCalled();
  });
});

describe("dead letter recovery", () => {
  afterEach(cleanup);
  it("shows loading, outage retry and empty states", () => {
    deadLettersResult = {
      data: undefined,
      isPending: true,
      isError: false,
      refetch,
    };
    const { rerender } = render(
      <ConnectorDeadLettersSection connectorId={connectorId} canView canEdit />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    deadLettersResult.isPending = false;
    deadLettersResult.isError = true;
    rerender(
      <ConnectorDeadLettersSection connectorId={connectorId} canView canEdit />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalled();
    deadLettersResult.isError = false;
    rerender(
      <ConnectorDeadLettersSection connectorId={connectorId} canView canEdit />,
    );
    expect(screen.getByText("No failed sync records.")).toBeInTheDocument();
  });
  it("closes a reviewed replay without changing provider records", () => {
    deadLettersResult = {
      data: {
        records: {
          rows: [
            {
              id: runId,
              runId,
              externalId: "record",
              outcome: "failed",
              errorCode: null,
            },
          ],
        },
      },
      isPending: false,
      isError: false,
      refetch,
    };
    render(
      <ConnectorDeadLettersSection connectorId={connectorId} canView canEdit />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Review replay for record" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Close replay review" }),
    );
    expect(screen.queryByText("Reviewed replay")).not.toBeInTheDocument();
  });
});
