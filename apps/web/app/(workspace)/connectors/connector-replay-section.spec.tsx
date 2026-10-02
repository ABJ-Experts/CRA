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
import { ConnectorReplaySection } from "./connector-replay-section";
const state = vi.hoisted(() => ({
  preview: vi.fn(),
  replay: vi.fn(),
  detail: {
    data: { run: { version: 4 } },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));
vi.mock("../../_features/connectors/sync-operations.queries", () => ({
  useSyncDetailQuery: () => state.detail,
  usePreviewReplayMutation: () => ({
    mutateAsync: state.preview,
    isPending: false,
  }),
  useReplayMutation: () => ({ mutateAsync: state.replay, isPending: false }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("reviewed batch replay", () => {
  it("requires a preview and reason and invalidates preview when choices change", async () => {
    state.preview.mockResolvedValue({
      preview: {
        canReplay: true,
        previewDigest: "a".repeat(64),
        runVersion: 4,
        mappingRevision: 2,
        recordCount: 3,
        issues: [],
      },
    });
    render(
      <ConnectorReplaySection connectorId="connector" runId="run" canEdit />,
    );
    expect(
      screen.getByRole("button", { name: "Request reviewed replay" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Replay reason"), {
      target: { value: "Corrected missing field" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview replay" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Request reviewed replay" }),
      ).toBeEnabled(),
    );
    expect(state.preview).toHaveBeenCalledWith({
      expectedVersion: 4,
      mappingMode: "preserve",
      sourceMode: "retained",
    });
    fireEvent.change(screen.getByLabelText("Mapping version"), {
      target: { value: "rebase" },
    });
    expect(
      screen.getByRole("button", { name: "Request reviewed replay" }),
    ).toBeDisabled();
  });
  it("submits reviewed metadata rather than blindly retrying the failed parent", async () => {
    state.preview.mockResolvedValue({
      preview: {
        canReplay: true,
        previewDigest: "a".repeat(64),
        runVersion: 4,
        mappingRevision: 2,
        recordCount: 3,
        issues: [],
      },
    });
    state.replay.mockResolvedValue({ run: { id: "child" } });
    render(
      <ConnectorReplaySection connectorId="connector" runId="run" canEdit />,
    );
    fireEvent.change(screen.getByLabelText("Replay reason"), {
      target: { value: "Reviewed repair" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview replay" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Request reviewed replay" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Request reviewed replay" }),
    );
    await waitFor(() =>
      expect(state.replay).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedVersion: 4,
          previewDigest: "a".repeat(64),
          mappingMode: "preserve",
          sourceMode: "retained",
          reason: "Reviewed repair",
          idempotencyKey: expect.any(String),
        }),
      ),
    );
  });
});

describe("replay failure boundaries", () => {
  afterEach(() => {
    state.detail.isPending = false;
    state.detail.isError = false;
  });
  it("denies unauthorized replay", () => {
    render(
      <ConnectorReplaySection
        connectorId="connector"
        runId="run"
        canEdit={false}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("permission");
  });
  it("supports version loading and outage recovery", () => {
    state.detail.isPending = true;
    const { rerender } = render(
      <ConnectorReplaySection connectorId="connector" runId="run" canEdit />,
    );
    expect(screen.getByText("Loading replay version…")).toBeInTheDocument();
    state.detail.isPending = false;
    state.detail.isError = true;
    rerender(
      <ConnectorReplaySection connectorId="connector" runId="run" canEdit />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Reload replay version" }),
    );
    expect(state.detail.refetch).toHaveBeenCalled();
  });
  it("discloses refetch review and blocks unsafe previews", async () => {
    state.preview.mockResolvedValue({
      preview: {
        canReplay: false,
        previewDigest: "a".repeat(64),
        runVersion: 4,
        mappingRevision: 2,
        recordCount: 3,
        issues: [
          { message: "Current access no longer permits this operation." },
        ],
      },
    });
    render(
      <ConnectorReplaySection connectorId="connector" runId="run" canEdit />,
    );
    fireEvent.change(screen.getByLabelText("Source records"), {
      target: { value: "refetch" },
    });
    expect(
      screen.getByText(/always requires a new review/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview replay" }));
    await waitFor(() =>
      expect(screen.getByText(/Replay blocked/)).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Request reviewed replay" }),
    ).toBeDisabled();
    expect(screen.getByText(/Current access/)).toBeInTheDocument();
  });
  it("preserves the reason and requires a new preview after request failure", async () => {
    state.preview.mockRejectedValueOnce(new Error("secret-canary"));
    render(
      <ConnectorReplaySection connectorId="connector" runId="run" canEdit />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview replay" }));
    await waitFor(() =>
      expect(
        screen.getByText("Replay preview could not be loaded."),
      ).toBeInTheDocument(),
    );
    state.preview.mockResolvedValue({
      preview: {
        canReplay: true,
        previewDigest: "a".repeat(64),
        runVersion: 4,
        mappingRevision: 2,
        recordCount: 3,
        issues: [],
      },
    });
    state.replay.mockRejectedValueOnce(new Error("provider payload"));
    fireEvent.change(screen.getByLabelText("Replay reason"), {
      target: { value: "Reviewed repair" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview replay" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Request reviewed replay" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Request reviewed replay" }),
    );
    await waitFor(() =>
      expect(
        screen.getByText("Replay could not be requested."),
      ).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Replay reason")).toHaveValue(
      "Reviewed repair",
    );
    expect(
      screen.getByRole("button", { name: "Request reviewed replay" }),
    ).toBeDisabled();
  });
});
