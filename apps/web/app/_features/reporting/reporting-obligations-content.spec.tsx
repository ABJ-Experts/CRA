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
const permissionState = vi.hoisted(() => ({
  canEdit: false,
  canView: false,
  canSubmit: false,
}));
const querySpy = vi.hoisted(() => vi.fn());
const navigation = vi.hoisted(() => ({ search: new URLSearchParams() }));
const detailState = vi.hoisted(() => ({ data: undefined as unknown }));

vi.mock("../../_providers/providers", () => ({
  useMocksReady: () => true,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => navigation.search,
}));

vi.mock("../../_providers/session-provider", () => ({
  useHasPermission: (permission: string) =>
    permission === "can_view_findings"
      ? permissionState.canView
      : permission === "can_edit_findings"
        ? permissionState.canEdit
        : permissionState.canSubmit,
  useSession: () => sessionState,
}));
vi.mock("./reporting-stage-draft-editor", () => ({
  ReportingStageDraftEditor: () => <p>Stage draft controls</p>,
}));

vi.mock("./reporting.queries", () => ({
  useCancelReportingObligationMutation: () => ({ isPending: false }),
  useCorrectReportingAnchorMutation: () => ({ isPending: false }),
  useCreateReportingObligationMutation: () => ({ isPending: false }),
  useCreateReportingRehearsalMutation: () => ({ isPending: false }),
  useReplayReportingRehearsalMutation: () => ({ isPending: false }),
  useRecordReportingSubmissionMutation: () => ({ isPending: false }),
  useReportingDeadlineSummaryQuery: () => ({ data: undefined }),
  useReportingObligationsQuery: (...args: unknown[]) => {
    querySpy(...args);
    return {
      data: undefined,
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    };
  },
  useReportingObligationDetailQuery: () => ({
    data: detailState.data,
    isLoading: false,
    isError: false,
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
    permissionState.canSubmit = false;
    querySpy.mockClear();
    navigation.search = new URLSearchParams();
    detailState.data = undefined;
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

  it("defaults to real reporting and requests rehearsals only after an explicit filter", async () => {
    sessionState.isLoading = false;
    permissionState.canView = true;
    permissionState.canEdit = true;
    permissionState.canSubmit = true;
    const user = (await import("@testing-library/user-event")).default.setup();

    render(<ReportingObligationsContent />);

    expect(querySpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ scope: "real" }),
      true,
    );
    await user.selectOptions(
      screen.getByLabelText("Reporting view"),
      "rehearsal",
    );
    expect(querySpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ scope: "rehearsal" }),
      true,
    );
    expect(
      screen.getByRole("button", { name: "Start rehearsal" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/cannot use a production finding/i),
    ).toBeInTheDocument();
  });

  it("selects the exact authorized stage even when its obligation is outside the first list page", () => {
    sessionState.isLoading = false;
    permissionState.canView = true;
    const obligationId = "11111111-1111-4111-8111-111111111111";
    const stageId = "22222222-2222-4222-8222-222222222222";
    navigation.search = new URLSearchParams({ obligationId, stageId });
    detailState.data = {
      obligation: {
        id: obligationId,
        type: "severe_incident",
        status: "active",
        isRehearsal: false,
        ruleSet: { jurisdiction: "EU-CRA", version: 1 },
        createdBy: { displayName: "Owner" },
        stages: [
          {
            id: stageId,
            kind: "notification",
            state: "running",
            dueAt: "2026-10-02T00:00:00Z",
            elapsedPercent: 10,
            breachedAt: null,
          },
        ],
      },
    };

    render(<ReportingObligationsContent />);

    expect(screen.getByText(/selected obligation/i)).toBeInTheDocument();
    expect(screen.getByText("Linked task stage")).toBeInTheDocument();
    expect(screen.getByText("Notification")).toBeInTheDocument();
  });

  it("keeps source approval controls available to a submitter without draft-edit permission", () => {
    sessionState.isLoading = false;
    permissionState.canView = true;
    permissionState.canSubmit = true;
    const obligationId = "11111111-1111-4111-8111-111111111111";
    navigation.search = new URLSearchParams({ obligationId });
    detailState.data = {
      obligation: {
        id: obligationId,
        type: "severe_incident",
        status: "active",
        isRehearsal: false,
        ruleSet: { jurisdiction: "EU-CRA", version: 1 },
        createdBy: { displayName: "Owner" },
        stages: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            kind: "notification",
            state: "running",
            dueAt: "2026-10-02T00:00:00Z",
            elapsedPercent: 10,
            breachedAt: null,
          },
        ],
      },
    };
    render(<ReportingObligationsContent />);
    expect(screen.getByText("Stage draft controls")).toBeInTheDocument();
  });
});
