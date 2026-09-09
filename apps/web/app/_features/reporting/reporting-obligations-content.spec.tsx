// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Countdown,
  ReportingObligationsContent,
} from "./reporting-obligations-content";

const sessionState = vi.hoisted(() => ({
  isError: false,
  isLoading: true,
}));
const permissionState = vi.hoisted(() => ({ canEdit: false, canView: false }));

vi.mock("../../_providers/providers", () => ({
  useMocksReady: () => true,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("../../_providers/session-provider", () => ({
  useHasPermission: (permission: string) =>
    permission === "can_view_findings"
      ? permissionState.canView
      : permissionState.canEdit,
  useSession: () => sessionState,
}));

vi.mock("./reporting.queries", () => ({
  useCancelReportingObligationMutation: () => ({ isPending: false }),
  useCorrectReportingAnchorMutation: () => ({ isPending: false }),
  useCreateReportingObligationMutation: () => ({ isPending: false }),
  useRecordReportingSubmissionMutation: () => ({ isPending: false }),
  useReportingDeadlineSummaryQuery: () => ({ data: undefined }),
  useReportingObligationsQuery: () => ({
    data: undefined,
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

describe("ReportingObligationsContent", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    sessionState.isError = false;
    sessionState.isLoading = true;
    permissionState.canEdit = false;
    permissionState.canView = false;
  });

  it("waits for session permissions instead of briefly rendering a false denial", () => {
    render(<ReportingObligationsContent />);

    expect(screen.getByText("Loading reporting workspace…")).toHaveAttribute(
      "role",
      "status",
    );
    expect(
      screen.queryByText(/do not have access to reporting obligations/i),
    ).not.toBeInTheDocument();
  });

  it("shows the forbidden state only after session resolution", () => {
    sessionState.isLoading = false;
    render(<ReportingObligationsContent />);

    expect(
      screen.getByText(/do not have access to reporting obligations/i),
    ).toBeInTheDocument();
  });

  it("renders a server-snapshot countdown after its baseline is initialized", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-09T10:00:00Z"));

    render(
      <Countdown
        dueAt="2026-09-09T11:00:00Z"
        serverNow="2026-09-09T10:00:00Z"
      />,
    );

    expect(screen.getByText("1h 0m remaining")).toBeInTheDocument();
  });
});
