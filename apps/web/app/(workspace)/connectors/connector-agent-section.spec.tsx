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
import { ConnectorAgentSection } from "./connector-agent-section";

const connectorId = "11111111-1111-4111-8111-111111111111";
const agentId = "22222222-2222-4222-8222-222222222222";
const state = vi.hoisted(() => ({
  pending: false,
  error: null as unknown,
  data: {
    agent: null as null | Record<string, unknown>,
    batches: {
      rows: [] as Record<string, unknown>[],
      nextCursor: null as string | null,
    },
  },
  latestCursor: null as string | null,
  refetch: vi.fn(),
  issue: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock("../../_features/connectors/agents.queries", () => ({
  useAgentStatusQuery: (_connectorId: string, cursor: string | null) => {
    state.latestCursor = cursor;
    return {
      isPending: state.pending,
      isError: state.error !== null,
      error: state.error,
      data: state.data,
      refetch: state.refetch,
    };
  },
  useIssueAgentEnrollment: () => ({
    isPending: false,
    mutateAsync: state.issue,
  }),
  useRevokeAgent: () => ({ isPending: false, mutateAsync: state.revoke }),
}));

describe("ConnectorAgentSection", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    state.pending = false;
    state.error = null;
    state.data.agent = null;
    state.data.batches.rows = [];
    state.data.batches.nextCursor = null;
    state.latestCursor = null;
  });

  it("shows an empty state and restricts enrollment to an owner", () => {
    render(<ConnectorAgentSection connectorId={connectorId} isOwner={false} />);
    expect(screen.getByText(/No agent is enrolled/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Issue enrollment/ }),
    ).not.toBeInTheDocument();
  });

  it("shows a one-time token only after owner enrollment and lets the owner dismiss it", async () => {
    state.issue.mockResolvedValue({
      token: "one-time-token",
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
    });
    render(<ConnectorAgentSection connectorId={connectorId} isOwner />);
    fireEvent.click(screen.getByRole("button", { name: /Issue enrollment/ }));
    await waitFor(() =>
      expect(screen.getByText("one-time-token")).toBeInTheDocument(),
    );
    expect(state.issue).toHaveBeenCalledWith({
      idempotencyKey: expect.any(String),
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Hide enrollment token/ }),
    );
    expect(screen.queryByText("one-time-token")).not.toBeInTheDocument();
  });

  it("shows operational health and bounded batches without credential data", () => {
    state.data.agent = {
      id: agentId,
      status: "active",
      lastContactAt: "2026-10-01T12:00:00.000Z",
      version: "1.0.0",
      capabilities: ["canonical_file", "https_read"],
      backlogCount: 2,
      backlogBytes: 512,
      lastErrorCode: "source_unavailable",
    };
    state.data.batches.rows = [
      {
        id: "33333333-3333-4333-8333-333333333333",
        sequence: 1,
        status: "staged",
        receivedAt: "2026-10-01T12:01:00.000Z",
        recordCount: 10,
      },
    ];
    render(<ConnectorAgentSection connectorId={connectorId} isOwner={false} />);
    expect(screen.getByText("1.0.0")).toBeInTheDocument();
    expect(screen.getByText(/source_unavailable/)).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Revoke agent/ }),
    ).not.toBeInTheDocument();
  });

  it("explains forbidden and offline errors with retry", () => {
    state.data.agent = {
      id: agentId,
      status: "active",
      lastContactAt: null,
      version: "private-version",
      capabilities: ["canonical_file"],
      backlogCount: 0,
      backlogBytes: 0,
      lastErrorCode: null,
    };
    state.error = new ApiClientError("api", "Forbidden", 403);
    const { rerender } = render(
      <ConnectorAgentSection connectorId={connectorId} isOwner />,
    );
    expect(screen.getByText(/permission to view/)).toBeInTheDocument();
    expect(screen.queryByText("private-version")).not.toBeInTheDocument();
    state.error = new ApiClientError("network", "Network unavailable", 0);
    rerender(<ConnectorAgentSection connectorId={connectorId} isOwner />);
    expect(screen.getByText(/could not reach/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(state.refetch).toHaveBeenCalled();
  });

  it("requires explicit owner confirmation and explains a revocation conflict", async () => {
    state.data.agent = {
      id: agentId,
      status: "active",
      lastContactAt: null,
      version: "1.0.0",
      capabilities: ["canonical_file"],
      backlogCount: 0,
      backlogBytes: 0,
      lastErrorCode: null,
    };
    state.revoke.mockRejectedValueOnce(
      new ApiClientError("api", "Conflict", 409),
    );
    render(<ConnectorAgentSection connectorId={connectorId} isOwner />);
    fireEvent.click(screen.getByRole("button", { name: "Revoke agent" }));
    expect(state.revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm revoke" }));
    await waitFor(() =>
      expect(
        screen.getByText(/changed in another session/),
      ).toBeInTheDocument(),
    );
    expect(state.revoke).toHaveBeenCalledWith({
      agentId,
      input: { idempotencyKey: expect.any(String) },
    });
  });

  it("requires a new connector after revocation instead of offering enrollment", () => {
    state.data.agent = {
      id: agentId,
      status: "revoked",
      lastContactAt: null,
      version: "1.0.0",
      capabilities: ["canonical_file"],
      backlogCount: 0,
      backlogBytes: 0,
      lastErrorCode: null,
    };
    render(<ConnectorAgentSection connectorId={connectorId} isOwner />);
    expect(
      screen.queryByRole("button", { name: /Issue enrollment/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/new on-premises connector/)).toBeInTheDocument();
    expect(
      screen.getByText(/review the source checkpoint and retained queue/),
    ).toBeInTheDocument();
  });

  it("moves through bounded staged-page cursors", () => {
    state.data.batches.nextCursor = "opaque-cursor";
    render(<ConnectorAgentSection connectorId={connectorId} isOwner={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Older pages" }));
    expect(state.latestCursor).toBe("opaque-cursor");
    fireEvent.click(screen.getByRole("button", { name: "Newer pages" }));
    expect(state.latestCursor).toBeNull();
  });
});
