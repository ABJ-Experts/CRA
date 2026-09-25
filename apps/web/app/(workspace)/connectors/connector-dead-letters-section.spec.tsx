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
    { runs: { rows: { id: string; errorCode: string | null }[] } } | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
};

vi.mock("../../_features/connectors/connectors.queries", () => ({
  useConnectorDeadLettersQuery: () => deadLettersResult,
  useRetrySyncRunMutation: () => ({ isPending: false, mutateAsync: retry }),
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
      data: { runs: { rows: [{ id: runId, errorCode: "provider_timeout" }] } },
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
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("provider_timeout")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();
  });

  it("retries a dead-lettered run when permitted", async () => {
    deadLettersResult = {
      data: { runs: { rows: [{ id: runId, errorCode: "provider_timeout" }] } },
      isPending: false,
      isError: false,
      refetch,
    };
    render(
      <ConnectorDeadLettersSection connectorId={connectorId} canView canEdit />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
    expect(refetch).toHaveBeenCalled();
  });
});
