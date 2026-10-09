// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ApiClientError } from "../../_lib/http/api-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditRangePanel } from "./audit-range-panel";
const state = vi.hoisted(() => ({
  session: {
    session: { organization: { id: "org1" } },
    permissions: { can_view_audit: true },
    isLoading: false,
    isError: false,
  },
  create: vi.fn(),
  operation: vi.fn(),
  query: {
    data: undefined as unknown,
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  },
}));
vi.mock("../../_providers/session-provider", () => ({
  useSession: () => state.session,
}));
vi.mock("./audit-range.api", () => ({
  auditRangeGateway: { create: state.create, operation: state.operation },
}));
vi.mock("./audit-range.queries", () => ({
  useAuditRangeJob: () => state.query,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.query.data = undefined;
  state.query.isError = false;
  state.session.isLoading = false;
  state.session.isError = false;
  state.session.session.organization.id = "org1";
  state.session.permissions.can_view_audit = true;
});
describe("AuditRangePanel", () => {
  it("starts an independent range and retains request UUID on ambiguous retry", async () => {
    state.create.mockRejectedValue(new Error("offline"));
    render(<AuditRangePanel />);
    fireEvent.change(screen.getByLabelText("To sequence (optional)"), {
      target: { value: "12" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify range" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Verify range" }));
    await waitFor(() => expect(state.create).toHaveBeenCalledTimes(2));
    expect(state.create.mock.calls[0]?.[0]).toEqual(
      state.create.mock.calls[1]?.[0],
    );
    expect(screen.getByText(/independent of explorer filters/i)).toBeVisible();
  });
  it("denies users without audit permission", () => {
    state.session.permissions.can_view_audit = false;
    render(<AuditRangePanel />);
    expect(
      screen.queryByRole("button", { name: "Verify range" }),
    ).not.toBeInTheDocument();
  });
  it("creates, cancels, resumes, and refreshes a job", async () => {
    const job = {
      id: "job1",
      status: "queued",
      version: 1,
      result: null,
      failureCode: null,
    };
    state.create.mockResolvedValue(job);
    state.operation
      .mockResolvedValueOnce({ ...job, status: "cancelled", version: 2 })
      .mockResolvedValueOnce({ ...job, status: "queued", version: 3 });
    render(<AuditRangePanel />);
    fireEvent.change(screen.getByLabelText("From sequence"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText(/Prior checkpoint JSON/), {
      target: { value: " " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify range" }));
    await screen.findByText("Verification queued");
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel verification" }),
    );
    await screen.findByText("Verification cancelled");
    fireEvent.click(
      screen.getByRole("button", { name: "Resume verification" }),
    );
    await screen.findByText("Verification queued");
    expect(state.operation.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ expectedVersion: 1 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    expect(state.query.refetch).toHaveBeenCalled();
  });
  it.each([403, 409])(
    "handles %s mutation denial/conflict without losing drafts",
    async (code) => {
      state.create.mockResolvedValue({
        id: "job1",
        status: "failed",
        version: 1,
        result: null,
        failureCode: "provider_unavailable",
      });
      state.operation.mockRejectedValue(
        new ApiClientError("api", "safe", code),
      );
      render(<AuditRangePanel />);
      fireEvent.click(screen.getByRole("button", { name: "Verify range" }));
      await screen.findByRole("button", { name: "Resume verification" });
      fireEvent.click(
        screen.getByRole("button", { name: "Resume verification" }),
      );
      await screen.findByRole("alert");
      expect(screen.getByLabelText("From sequence")).toHaveValue("1");
    },
  );
  it("clears tenant jobs on organization switch and hides stale result after polling failure", async () => {
    const job = {
      id: "job1",
      status: "completed",
      version: 2,
      result: null,
      failureCode: null,
    };
    state.create.mockResolvedValue(job);
    const { rerender } = render(<AuditRangePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Verify range" }));
    await screen.findByText("Verification completed");
    state.query.data = {
      ...job,
      status: "stale",
      version: 3,
      failureCode: "access_changed",
    };
    state.query.isError = true;
    rerender(<AuditRangePanel />);
    expect(screen.getByRole("alert")).toHaveTextContent("Status unavailable");
    state.session.session.organization.id = "org2";
    rerender(<AuditRangePanel />);
    expect(screen.queryByText("Verification stale")).not.toBeInTheDocument();
  });
  it("renders loading and degraded permissions without enabling controls", () => {
    state.session.isLoading = true;
    const { rerender } = render(<AuditRangePanel />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    state.session.isLoading = false;
    state.session.isError = true;
    rerender(<AuditRangePanel />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Session permissions unavailable",
    );
  });
  it("shows completed results and suppresses premature consistent progress", async () => {
    const result = {
      outcome: "consistent",
      algorithm: "sha256",
      chainVersion: 1,
      requestedRange: { from: "1", to: "4" },
      frozenRange: { from: "1", to: "4" },
      checkedRange: { from: "1", to: "4" },
      verifiedPrefix: { from: "1", to: "4" },
      checkedCount: "4",
      firstAffectedSequence: null,
      breaks: [],
      sampleSequences: [],
      inspectionComplete: true,
      checkedAt: "2026-10-07T00:00:00Z",
      datasetContext: "live",
      priorCheckpointStatus: "not_supplied",
      authenticityProven: false,
      completeLedgerVerified: false,
    };
    state.create.mockResolvedValue({
      id: "job1",
      status: "completed",
      version: 1,
      result,
      failureCode: null,
    });
    const { rerender } = render(<AuditRangePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Verify range" }));
    await screen.findByText("Range internally consistent");
    state.query.data = {
      id: "job1",
      status: "processing",
      version: 2,
      result,
      failureCode: null,
    };
    rerender(<AuditRangePanel />);
    expect(
      screen.queryByText("Range internally consistent"),
    ).not.toBeInTheDocument();
  });
  it("allows access-changed stale jobs to reauthorize and resume", async () => {
    state.create.mockResolvedValue({
      id: "job1",
      status: "stale",
      version: 7,
      result: null,
      failureCode: "access_changed",
    });
    state.operation.mockResolvedValue({
      id: "job1",
      status: "queued",
      version: 8,
      result: null,
      failureCode: null,
    });
    render(<AuditRangePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Verify range" }));
    const resume = await screen.findByRole("button", {
      name: "Resume verification",
    });
    fireEvent.click(resume);
    await screen.findByText("Verification queued");
    expect(state.operation).toHaveBeenCalledWith(
      "job1",
      "resume",
      expect.objectContaining({ expectedVersion: 7 }),
    );
  });
  it("requires a new check after the dataset changes", async () => {
    state.create.mockResolvedValue({
      id: "job1",
      status: "stale",
      version: 7,
      result: null,
      failureCode: "dataset_changed",
    });
    render(<AuditRangePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Verify range" }));
    await screen.findByText("Verification stale");
    expect(
      screen.queryByRole("button", { name: "Resume verification" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/dataset changed.*start a new check/i),
    ).toBeVisible();
  });
});
