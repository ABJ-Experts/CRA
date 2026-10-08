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
import { FindingTriageContent } from "./triage-content";

const state = vi.hoisted(() => ({
  params: new URLSearchParams(),
  queue: vi.fn(),
  hasRows: false,
  hasDefault: false,
  canManage: false,
  loading: false,
  canView: true,
  queueError: null as unknown,
  detailError: false,
  refetch: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  update: vi.fn(),
  setDefault: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => state.params }));
vi.mock("next/dynamic", () => ({
  default: () => () => <input aria-label="Assessment draft" defaultValue="" />,
}));
vi.mock("../../dashboard/_components/dashboard-chrome", () => ({
  PageHeading: ({ actions }: { actions: React.ReactNode }) => actions,
}));
vi.mock("../../_providers/session-provider", () => ({
  useSession: () => ({
    isLoading: state.loading,
    session: { organization: { id: "org" } },
  }),
  useHasPermission: (permission: string) =>
    permission === "can_view_findings" ? state.canView : state.canManage,
}));
vi.mock("./finding-bulk-assessment", () => ({
  FindingBulkAssessmentAction: () => null,
}));
vi.mock("./triage.queries", () => ({
  useVulnerabilityTriageQueueQuery: (query: unknown) => {
    state.queue(query);
    return {
      isLoading: false,
      isFetching: false,
      isError: !!state.queueError,
      error: state.queueError,
      refetch: state.refetch,
      data: state.hasRows ? queueResponse : undefined,
    };
  },
  useVulnerabilityTriageDetailQuery: (id: string | null) => ({
    data: id && !state.detailError ? { detail: {} } : undefined,
    isError: state.detailError,
    refetch: state.refetch,
  }),
  useVulnerabilitySavedViewsQuery: () => ({
    data: state.hasDefault ? savedViewResponse : undefined,
  }),
  useCreateVulnerabilitySavedViewMutation: () => ({
    mutateAsync: state.create,
  }),
  useDeleteVulnerabilitySavedViewMutation: () => ({
    mutateAsync: state.remove,
  }),
  useUpdateVulnerabilitySavedViewMutation: () => ({
    mutateAsync: state.update,
  }),
  useSetDefaultVulnerabilitySavedViewMutation: () => ({
    mutateAsync: state.setDefault,
  }),
}));

const productId = "11111111-1111-4111-8111-111111111111";
const nextProductId = "22222222-2222-4222-8222-222222222222";
const savedViewResponse = {
  defaultViewId: "saved-view",
  views: [
    {
      id: "saved-view",
      name: "My default",
      version: 2,
      filters: { severities: ["critical"] },
      sort: "lastEvaluatedAt",
      order: "desc",
    },
  ],
};
const queueResponse = {
  rows: [
    {
      finding: {
        id: "33333333-3333-4333-8333-333333333333",
        advisoryId: "CVE-test",
      },
      product: { name: "Product" },
      release: { name: "Release" },
      severity: "high",
      epss: null,
      kevStatus: "unknown",
      reachability: null,
      vexStatus: null,
      approvalState: null,
      operational: {
        suppression: { state: "actionable" },
        internalSla: { state: "unknown" },
        notification: { state: "not_sent" },
        remediation: {
          state: "not_recorded",
          reintroduction: { state: "not_evaluated" },
        },
      },
    },
  ],
  nextCursor: "next-page",
  filterIssues: [],
};
function navigate(
  query: string,
  rerender: ReturnType<typeof render>["rerender"],
) {
  state.params = new URLSearchParams(query);
  rerender(<FindingTriageContent />);
}
function latestQuery() {
  return state.queue.mock.calls.at(-1)?.[0];
}

describe("mounted dashboard triage navigation", () => {
  beforeEach(() => {
    state.params = new URLSearchParams();
    state.queue.mockClear();
    state.hasRows = false;
    state.hasDefault = false;
    state.canManage = false;
    state.loading = false;
    state.canView = true;
    state.queueError = null;
    state.detailError = false;
    for (const mock of [
      state.create,
      state.remove,
      state.update,
      state.setDefault,
      state.refetch,
    ])
      mock.mockReset();
  });
  afterEach(cleanup);
  it("applies a different validated product/severity/open link without remounting", () => {
    state.params = new URLSearchParams(
      `productId=${productId}&severity=high&openOnly=true`,
    );
    const { rerender } = render(<FindingTriageContent />);
    navigate(
      `productId=${nextProductId}&severity=low&openOnly=false`,
      rerender,
    );
    expect(latestQuery()).toMatchObject({
      productIds: [nextProductId],
      severities: ["low"],
      openOnly: false,
      cursor: undefined,
    });
  });
  it("clears dashboard filters when navigating back to the unfiltered queue", () => {
    state.params = new URLSearchParams(
      `productId=${productId}&severity=high&openOnly=true`,
    );
    const { rerender } = render(<FindingTriageContent />);
    navigate("tab=queue", rerender);
    expect(latestQuery()).toEqual({
      sort: "lastEvaluatedAt",
      order: "desc",
      cursor: undefined,
      limit: 50,
    });
  });
  it("preserves locally edited filters when unrelated query parameters change", () => {
    state.params = new URLSearchParams(
      `productId=${productId}&severity=high&openOnly=true`,
    );
    const { rerender } = render(<FindingTriageContent />);
    fireEvent.change(screen.getByLabelText("Product IDs"), {
      target: { value: nextProductId },
    });
    navigate(
      `productId=${productId}&severity=high&openOnly=true&tab=details`,
      rerender,
    );
    expect(latestQuery()).toMatchObject({
      productIds: [nextProductId],
      severities: ["high"],
      openOnly: true,
    });
  });
  it("resets cursor and bulk selection while retaining an open assessment draft", () => {
    state.hasRows = true;
    state.params = new URLSearchParams(
      `productId=${productId}&severity=high&openOnly=true`,
    );
    const { rerender } = render(<FindingTriageContent />);
    const row = screen.getByRole("row");
    fireEvent.click(row);
    fireEvent.change(screen.getByLabelText("Assessment draft"), {
      target: { value: "Unsaved analysis" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /^Select CVE-test/ }));
    expect(row).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: "Load more findings" }));
    expect(latestQuery()).toMatchObject({ cursor: "next-page" });
    navigate(`productId=${nextProductId}&severity=low&openOnly=true`, rerender);
    expect(latestQuery()).toMatchObject({
      productIds: [nextProductId],
      severities: ["low"],
      cursor: undefined,
    });
    expect(screen.getByRole("row")).toHaveAttribute("aria-selected", "false");
    expect(screen.getByLabelText("Assessment draft")).toHaveValue(
      "Unsaved analysis",
    );
  });
  it("keeps explicit dashboard filters when the saved default loads later", () => {
    state.params = new URLSearchParams(
      `productId=${productId}&severity=high&openOnly=true`,
    );
    const { rerender } = render(<FindingTriageContent />);
    state.hasDefault = true;
    rerender(<FindingTriageContent />);
    expect(latestQuery()).toMatchObject({
      productIds: [productId],
      severities: ["high"],
      openOnly: true,
    });
  });
  it("still applies a saved default when no dashboard link exists", () => {
    state.hasDefault = true;
    render(<FindingTriageContent />);
    expect(latestQuery()).toMatchObject({ severities: ["critical"] });
  });
  it("ignores malformed and ambiguous dashboard links", () => {
    state.params = new URLSearchParams(
      `productId=${productId}&severity=high&openOnly=true`,
    );
    const { rerender } = render(<FindingTriageContent />);
    navigate("severity=low&severity=high", rerender);
    expect(latestQuery()).toMatchObject({
      productIds: [productId],
      severities: ["high"],
      openOnly: true,
    });
  });
});

describe("triage filter and operational navigation regression", () => {
  afterEach(cleanup);
  beforeEach(() => {
    state.params = new URLSearchParams();
    state.queue.mockClear();
    state.hasRows = false;
    state.hasDefault = false;
    state.canManage = false;
    state.loading = false;
    state.canView = true;
    state.queueError = null;
    state.detailError = false;
    for (const mock of [
      state.create,
      state.remove,
      state.update,
      state.setDefault,
      state.refetch,
    ])
      mock.mockReset();
  });
  it.each([
    ["Severity", "severities", "low"],
    ["EPSS", "epssState", "known"],
    ["Matcher state", "findingStates", "active"],
    ["Re-evaluation", "reEvaluationStates", "review_required"],
    ["KEV", "kevStatuses", "listed"],
    ["Assessment", "assessmentStates", "affected"],
    ["VEX status", "vexStatuses", "fixed"],
    ["Approval", "approvalStates", "approved"],
    ["Reachability", "reachability", "reachable"],
    ["Queue state", "suppressionStates", "suppressed"],
    ["Internal SLA", "internalSlaStates", "tracking"],
    ["Alert delivery", "notificationDeliveryStates", "retrying"],
    ["Remediation", "remediationStates", "planned"],
    ["Reintroduction", "reintroductionStates", "reintroduced"],
  ])(
    "round-trips %s into the server query without retaining a cleared value",
    (label, key, value) => {
      render(<FindingTriageContent />);
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
      expect(latestQuery()[key]).toEqual(key === "epssState" ? value : [value]);
      fireEvent.change(screen.getByLabelText(label), { target: { value: "" } });
      expect(latestQuery()[key]).toBeUndefined();
    },
  );
  it.each([
    ["Minimum age (days)", "ageDaysMin", "3"],
    ["Maximum age (days)", "ageDaysMax", "5"],
    ["Minimum EPSS", "epssMin", "0.2"],
    ["Maximum EPSS", "epssMax", "0.8"],
  ])("parses and clears the numeric %s filter", (label, key, value) => {
    render(<FindingTriageContent />);
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    expect(latestQuery()[key]).toBe(Number(value));
    fireEvent.change(screen.getByLabelText(label), { target: { value: "" } });
    expect(latestQuery()[key]).toBeUndefined();
  });
  it.each([
    ["Release IDs", "releaseIds"],
    ["Assessed-by user IDs", "assessedByUserIds"],
  ])("normalizes and clears %s", (label, key) => {
    render(<FindingTriageContent />);
    fireEvent.change(screen.getByLabelText(label), {
      target: { value: `${productId}, ${nextProductId}` },
    });
    expect(latestQuery()[key]).toEqual([productId, nextProductId]);
    fireEvent.change(screen.getByLabelText(label), { target: { value: "" } });
    expect(latestQuery()[key]).toBeUndefined();
  });
  it("updates ordering and open-only controls and clears all filters", () => {
    render(<FindingTriageContent />);
    fireEvent.change(screen.getByLabelText("Sort"), {
      target: { value: "severity" },
    });
    fireEvent.change(screen.getByLabelText("Order"), {
      target: { value: "asc" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Unresolved open findings only" }),
    );
    expect(latestQuery()).toMatchObject({
      sort: "severity",
      order: "asc",
      openOnly: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(latestQuery()).toEqual({
      sort: "lastEvaluatedAt",
      order: "desc",
      cursor: undefined,
      limit: 50,
    });
  });
  it.each([
    [new ApiClientError("api", "", 403), /permission to view findings/],
    [new ApiClientError("network", "", 0), /queue is offline/],
    [new Error("internal"), /temporarily unavailable/],
  ])(
    "exposes sanitized queue failures and supports retry",
    (error, message) => {
      state.queueError = error;
      render(<FindingTriageContent />);
      expect(screen.getByRole("alert")).toHaveTextContent(message);
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(state.refetch).toHaveBeenCalledOnce();
    },
  );
  it("renders loading and denied sessions without queue evidence", () => {
    state.loading = true;
    const { rerender } = render(<FindingTriageContent />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading triage workspace",
    );
    state.loading = false;
    state.canView = false;
    rerender(<FindingTriageContent />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "permission to view findings",
    );
    expect(screen.queryByLabelText("Finding filters")).not.toBeInTheDocument();
  });
  it("supports keyboard selection, inspection and bounded navigation", () => {
    state.hasRows = true;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    render(<FindingTriageContent />);
    const row = screen.getByRole("row");
    for (const key of ["ArrowDown", "ArrowUp", "Home", "End"])
      fireEvent.keyDown(row, { key });
    fireEvent.keyDown(row, { key: " " });
    expect(row).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(row, { key: " " });
    expect(row).toHaveAttribute("aria-selected", "false");
    fireEvent.keyDown(row, { key: "Enter" });
    expect(screen.getByLabelText("Assessment draft")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
  it("retains selected finding while its detail is unavailable and retries", () => {
    state.hasRows = true;
    state.detailError = true;
    render(<FindingTriageContent />);
    fireEvent.click(screen.getByRole("row"));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Finding detail is temporarily unavailable",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(state.refetch).toHaveBeenCalledOnce();
  });
  it("creates a named saved view with current filters and clears only successful draft", async () => {
    state.canManage = true;
    render(<FindingTriageContent />);
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Give this saved view a name",
    );
    fireEvent.change(screen.getByLabelText("Saved view name"), {
      target: { value: "My filter" },
    });
    fireEvent.change(screen.getByLabelText("Severity"), {
      target: { value: "high" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Saved view name")).toHaveValue(""),
    );
    expect(state.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "My filter",
        filters: { severities: ["high"] },
        sort: "lastEvaluatedAt",
        order: "desc",
        idempotencyKey: expect.any(String),
      }),
    );
  });
  it.each([409, 503])(
    "preserves save draft on %s mutation failure",
    async (status) => {
      state.canManage = true;
      state.create.mockRejectedValue(new ApiClientError("api", "", status));
      render(<FindingTriageContent />);
      fireEvent.change(screen.getByLabelText("Saved view name"), {
        target: { value: "My filter" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save view" }));
      await screen.findByRole("alert");
      expect(screen.getByLabelText("Saved view name")).toHaveValue("My filter");
    },
  );
  it.each([
    ["Delete My default", "remove", "deleted"],
    ["Update My default with current filters", "update", "updated"],
    ["Remove My default as my default", "setDefault", "default"],
  ])("executes %s with a durable operation identity", async (label, action) => {
    state.canManage = true;
    state.hasDefault = true;
    render(<FindingTriageContent />);
    fireEvent.click(screen.getByRole("button", { name: label }));
    const mutation =
      action === "remove"
        ? state.remove
        : action === "update"
          ? state.update
          : state.setDefault;
    await waitFor(() => expect(mutation).toHaveBeenCalledOnce());
    expect(JSON.stringify(mutation.mock.calls[0])).toContain("idempotencyKey");
  });
  it.each([
    ["Delete My default", "remove", 409, /Refresh before deleting/],
    ["Delete My default", "remove", 503, /could not be deleted/],
    [
      "Update My default with current filters",
      "update",
      409,
      /Refresh before updating/,
    ],
    [
      "Update My default with current filters",
      "update",
      503,
      /could not be updated/,
    ],
    [
      "Remove My default as my default",
      "setDefault",
      503,
      /default could not be updated/,
    ],
  ])(
    "handles %s failure %s without losing filters",
    async (label, action, status, message) => {
      state.canManage = true;
      state.hasDefault = true;
      const mutation =
        action === "remove"
          ? state.remove
          : action === "update"
            ? state.update
            : state.setDefault;
      mutation.mockRejectedValue(new ApiClientError("api", "", status));
      render(<FindingTriageContent />);
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(latestQuery()).toMatchObject({ severities: ["critical"] });
    },
  );
});
