// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FindingRemediation,
  remediationRequestMessage,
} from "./finding-remediation";
import { ApiClientError } from "../../_lib/http/api-client";

const record = vi.fn();
const correct = vi.fn();
const syncTicket = vi.fn();
const previewTicket = vi.fn();
const replayTicket = vi.fn();
const refetchTickets = vi.fn();
let ticketRows: Record<string, unknown>[] = [];
let bindingRows: Record<string, unknown>[] = [];
let canEditFindings = true;
let ticketsLoading = false;
let ticketsError: Error | null = null;

vi.mock("../../_providers/session-provider", () => ({
  useHasPermission: (permission: string) =>
    permission === "can_edit_findings" && canEditFindings,
  useSession: () => ({
    session: { organization: { id: "88888888-8888-4888-8888-888888888888" } },
  }),
}));

vi.mock("./triage.queries", () => ({
  useRecordVulnerabilityRemediationMutation: () => ({
    isPending: false,
    mutateAsync: record,
  }),
  useCorrectVulnerabilityRemediationMutation: () => ({
    isPending: false,
    mutateAsync: correct,
  }),
  useSyncVulnerabilityRemediationTicketMutation: () => ({
    isPending: false,
    mutateAsync: syncTicket,
  }),
  usePreviewVulnerabilityRemediationTicketMutation: () => ({
    isPending: false,
    mutateAsync: previewTicket,
  }),
  useReplayVulnerabilityRemediationTicketMutation: () => ({
    isPending: false,
    mutateAsync: replayTicket,
  }),
  useVulnerabilityRemediationTicketsQuery: () => ({
    isLoading: ticketsLoading,
    isError: ticketsError !== null,
    error: ticketsError,
    data: {
      bindings: bindingRows,
      tickets: ticketRows,
    },
    refetch: refetchTickets,
  }),
  useVulnerabilityRemediationHistoryQuery: () => ({
    isLoading: false,
    isError: false,
    data: { current: null, history: [] },
    refetch: vi.fn(),
  }),
}));

function fixtureBindings() {
  return [
    {
      id: "44444444-4444-4444-8444-444444444444",
      connectorId: "55555555-5555-4555-8555-555555555555",
      productId: "88888888-8888-4888-8888-888888888888",
      provider: "jira",
      cloudId: "99999999-9999-4999-8999-999999999999",
      projectId: "10000",
      projectKey: "SEC",
      issueTypeId: "10001",
      externalBaseUrl: "https://cra-test.atlassian.net",
      statusTransitions: [
        {
          fromStatusId: "1",
          toStatusId: "2",
          transitionId: "3",
        },
      ],
      statusMappings: [{ statusId: "1", workState: "open" }],
      customFieldMappings: [],
      status: "active",
      version: 1,
      createdAt: "2026-09-08T10:00:00.000Z",
      updatedAt: "2026-09-08T10:00:00.000Z",
    },
  ];
}

function fixtureTickets() {
  return [
    {
      id: "66666666-6666-4666-8666-666666666666",
      findingId: "22222222-2222-4222-8222-222222222222",
      bindingId: "44444444-4444-4444-8444-444444444444",
      provider: "jira",
      externalIssueId: "10000",
      externalIssueKey: "SEC-42",
      externalUrl: "https://cra-test.atlassian.net/browse/SEC-42",
      externalStatus: "Done",
      status: "external_closed_pending_review",
      syncRevision: 2,
      lastSyncDirection: "inbound",
      lastSyncAt: "2026-09-08T11:00:00.000Z",
      lastInboundEventId: "jira-delivery-1",
      conflictReason: null,
      version: 2,
      correlationId: "m11-05-run-1",
    },
  ];
}

const operational = {
  state: "planned" as const,
  anchor: {
    id: "11111111-1111-4111-8111-111111111111",
    findingId: "22222222-2222-4222-8222-222222222222",
    revision: 1,
    remediationKind: "corrective" as const,
    fixVersion: "2.4.1",
    mitigationDescription: "Vendor maintenance package is prepared.",
    availabilityAt: null,
    availabilityProvenance: null,
    availabilityBasis: null,
    correctionReason: null,
    recordedByUserId: "33333333-3333-4333-8333-333333333333",
    recordedAt: "2026-09-08T10:00:00.000Z",
  },
  reintroduction: {
    state: "not_evaluated" as const,
    fromFindingId: null,
    detectedAt: null,
  },
};

describe("FindingRemediation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canEditFindings = true;
    ticketsLoading = false;
    ticketsError = null;
    bindingRows = fixtureBindings();
    ticketRows = fixtureTickets();
    previewTicket.mockResolvedValue({
      preview: {
        summary: "Review affected component",
        description: "Approved minimal remediation context",
        projectKey: "SEC",
        issueTypeId: "10001",
        contextDigest: "a".repeat(64),
      },
    });
    syncTicket.mockResolvedValue({ ticket: fixtureTickets()[0] });
    replayTicket.mockResolvedValue({ ticket: fixtureTickets()[0] });
  });
  afterEach(cleanup);

  it("shows planned and lineage-unavailable states as text as well as semantic tags", () => {
    render(
      <FindingRemediation
        findingId="22222222-2222-4222-8222-222222222222"
        remediation={operational}
      />,
    );

    expect(screen.getAllByText("Fix planned")).not.toHaveLength(0);
    expect(
      screen.getAllByText("Reintroduction not evaluated"),
    ).not.toHaveLength(0);
    expect(
      screen.getByText(/completed SBOM release lineage is unavailable/i),
    ).toBeInTheDocument();
  });

  it("requires corrective evidence and preserves entered work after an offline failure", async () => {
    record.mockRejectedValueOnce(new ApiClientError("network", "", 0));
    render(
      <FindingRemediation
        findingId="22222222-2222-4222-8222-222222222222"
        remediation={{
          state: "not_recorded",
          anchor: null,
          reintroduction: {
            state: "not_reintroduced",
            fromFindingId: null,
            detectedAt: null,
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Record remediation" }));
    const dialog = screen.getByRole("dialog", {
      name: "Record remediation anchor",
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Record remediation" }),
    );
    expect(
      screen.getByText("Corrective remediation requires a fix version."),
    ).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("Fix version"), {
      target: { value: "2.4.1" },
    });
    fireEvent.change(within(dialog).getByLabelText("Mitigation description"), {
      target: { value: "Vendor maintenance package is available." },
    });
    fireEvent.change(
      within(dialog).getByLabelText("Human/business availability basis"),
      { target: { value: "Maintainer confirmation was reviewed." } },
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Record remediation" }),
    );

    expect(await screen.findByText(/offline/i)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Fix version")).toHaveValue("2.4.1");
    expect(within(dialog).getByLabelText("Mitigation description")).toHaveValue(
      "Vendor maintenance package is available.",
    );
  });

  it("previews approved context before an explicit first ticket creation", async () => {
    ticketRows = [];
    render(
      <FindingRemediation
        findingId="22222222-2222-4222-8222-222222222222"
        remediation={operational}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Create Jira ticket" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Preview Jira ticket" }),
    );
    await waitFor(() =>
      expect(previewTicket).toHaveBeenCalledWith({
        findingId: "22222222-2222-4222-8222-222222222222",
        input: { bindingId: "44444444-4444-4444-8444-444444444444" },
      }),
    );
    expect(
      screen.getByText("Approved minimal remediation context"),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Create Jira ticket" }));
    await waitFor(() =>
      expect(syncTicket).toHaveBeenCalledWith({
        findingId: "22222222-2222-4222-8222-222222222222",
        input: {
          bindingId: "44444444-4444-4444-8444-444444444444",
          expectedTicketVersion: 0,
          contextDigest: "a".repeat(64),
          idempotencyKey: expect.any(String),
        },
      }),
    );
  });

  it("keeps one idempotency key and the approved preview across a network retry", async () => {
    ticketRows = [];
    syncTicket.mockRejectedValueOnce(new ApiClientError("network", "", 0));
    render(
      <FindingRemediation
        findingId="22222222-2222-4222-8222-222222222222"
        remediation={operational}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Preview Jira ticket" }),
    );
    await screen.findByText("Approved minimal remediation context");
    fireEvent.click(screen.getByRole("button", { name: "Create Jira ticket" }));
    await screen.findByText(/offline/i);
    expect(
      screen.getByText("Approved minimal remediation context"),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Create Jira ticket" }));
    await waitFor(() => expect(syncTicket).toHaveBeenCalledTimes(2));
    expect(syncTicket.mock.calls[1]?.[0].input.idempotencyKey).toBe(
      syncTicket.mock.calls[0]?.[0].input.idempotencyKey,
    );
  });

  it("blocks a stale preview after a conflict until the owner refreshes it", async () => {
    ticketRows = [];
    syncTicket.mockRejectedValueOnce(new ApiClientError("api", "", 409));
    render(
      <FindingRemediation
        findingId="22222222-2222-4222-8222-222222222222"
        remediation={operational}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Preview Jira ticket" }),
    );
    await screen.findByText("Approved minimal remediation context");
    fireEvent.click(screen.getByRole("button", { name: "Create Jira ticket" }));
    await screen.findByText(/approved context changed/i);
    expect(
      screen.getByRole("button", { name: "Create Jira ticket" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Preview Jira ticket" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Create Jira ticket" }),
      ).toBeEnabled(),
    );
  });

  it("preserves but disables approved text when refreshing its preview fails offline", async () => {
    ticketRows = [];
    render(
      <FindingRemediation
        findingId="22222222-2222-4222-8222-222222222222"
        remediation={operational}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Preview Jira ticket" }),
    );
    await screen.findByText("Approved minimal remediation context");
    previewTicket.mockRejectedValueOnce(new ApiClientError("network", "", 0));
    fireEvent.click(
      screen.getByRole("button", { name: "Preview Jira ticket" }),
    );
    await screen.findByText(/offline/i);
    expect(
      screen.getByText("Approved minimal remediation context"),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Create Jira ticket" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Preview Jira ticket" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Create Jira ticket" }),
      ).toBeEnabled(),
    );
  });

  it("shows external ticket closure as pending internal review and syncs by version after preview", async () => {
    render(
      <FindingRemediation
        findingId="22222222-2222-4222-8222-222222222222"
        remediation={operational}
      />,
    );

    expect(screen.getByText("SEC-42")).toBeInTheDocument();
    expect(
      screen.getByText("External Closed Pending Review"),
    ).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Preview Jira update" }),
    );
    await screen.findByText("Approved minimal remediation context");
    fireEvent.click(screen.getByRole("button", { name: "Sync Jira ticket" }));

    await waitFor(() =>
      expect(syncTicket).toHaveBeenCalledWith({
        findingId: "22222222-2222-4222-8222-222222222222",
        input: {
          bindingId: "44444444-4444-4444-8444-444444444444",
          expectedTicketVersion: 2,
          contextDigest: "a".repeat(64),
          idempotencyKey: expect.any(String),
        },
      }),
    );
  });

  it("shows pending correlation without a fake external link and offers reconciliation", async () => {
    ticketRows = [
      {
        ...fixtureTickets()[0],
        externalIssueId: null,
        externalIssueKey: null,
        externalUrl: null,
        externalStatus: null,
        lastSyncAt: null,
        lastSyncDirection: null,
        status: "sync_pending",
        conflictReason: null,
        correlationId: "77777777-7777-4777-8777-777777777777",
        version: 3,
      },
    ];
    render(
      <FindingRemediation
        findingId="22222222-2222-4222-8222-222222222222"
        remediation={operational}
      />,
    );

    expect(
      screen.getByText("77777777-7777-4777-8777-777777777777"),
    ).toBeVisible();
    expect(screen.getByText(/Awaiting Jira issue/i)).toBeVisible();
    expect(
      screen.queryByRole("link", { name: /Jira/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Reconcile with Jira" }),
    );
    await waitFor(() =>
      expect(replayTicket).toHaveBeenCalledWith({
        findingId: "22222222-2222-4222-8222-222222222222",
        ticketId: "66666666-6666-4666-8666-666666666666",
        input: { expectedVersion: 3, idempotencyKey: expect.any(String) },
      }),
    );
  });

  it("shows conflict diagnostics without implying that reconciliation creates another issue", () => {
    ticketRows = [
      {
        ...fixtureTickets()[0],
        status: "conflict",
        conflictReason: "Remote issue moved outside the approved project",
      },
    ];
    render(
      <FindingRemediation
        findingId="22222222-2222-4222-8222-222222222222"
        remediation={operational}
      />,
    );
    expect(screen.getByText(/Remote issue moved outside/i)).toBeVisible();
    expect(
      screen.getByText(/Reconciliation does not create another issue/i),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Reconcile with Jira" }),
    ).toBeVisible();
  });

  it("does not link a provider URL outside the bound Jira site", () => {
    ticketRows = [
      {
        ...fixtureTickets()[0],
        externalUrl: "https://unrelated.example/browse/SEC-42",
      },
    ];
    render(
      <FindingRemediation
        findingId="22222222-2222-4222-8222-222222222222"
        remediation={operational}
      />,
    );
    expect(screen.getByText("SEC-42")).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "SEC-42" }),
    ).not.toBeInTheDocument();
  });

  it("reuses the reconciliation key after an offline retry", async () => {
    ticketRows = [{ ...fixtureTickets()[0], status: "sync_pending" }];
    replayTicket.mockRejectedValueOnce(new ApiClientError("network", "", 0));
    render(
      <FindingRemediation
        findingId="22222222-2222-4222-8222-222222222222"
        remediation={operational}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Reconcile with Jira" }),
    );
    await screen.findByText(/offline/i);
    fireEvent.click(
      screen.getByRole("button", { name: "Reconcile with Jira" }),
    );
    await waitFor(() => expect(replayTicket).toHaveBeenCalledTimes(2));
    expect(replayTicket.mock.calls[1]?.[0].input.idempotencyKey).toBe(
      replayTicket.mock.calls[0]?.[0].input.idempotencyKey,
    );
  });

  it("makes a revoked binding visible and blocks preview, create, sync and replay", () => {
    bindingRows = [{ ...fixtureBindings()[0], status: "revoked" }];
    render(
      <FindingRemediation
        findingId="22222222-2222-4222-8222-222222222222"
        remediation={operational}
      />,
    );

    expect(screen.getByText(/binding has been revoked/i)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Jira ticket|Reconcile with Jira/ }),
    ).not.toBeInTheDocument();
  });

  it("shows an empty linked-ticket state without suggesting a ticket already exists", () => {
    ticketRows = [];
    render(
      <FindingRemediation
        findingId="22222222-2222-4222-8222-222222222222"
        remediation={operational}
      />,
    );
    expect(
      screen.getByText(/No Jira ticket is linked to this finding/i),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Preview Jira ticket" }),
    ).toBeVisible();
  });

  it("does not offer ticket actions while binding status is loading", () => {
    ticketsLoading = true;
    render(
      <FindingRemediation
        findingId="22222222-2222-4222-8222-222222222222"
        remediation={operational}
      />,
    );
    expect(screen.getByText("Loading linked tickets…")).toBeVisible();
    expect(
      screen.queryByRole("button", {
        name: /Preview Jira|Sync Jira|Reconcile with Jira/,
      }),
    ).not.toBeInTheDocument();
  });

  it("explains ticket-list permission loss and offline recovery", () => {
    ticketsError = new ApiClientError("api", "", 403);
    const view = render(
      <FindingRemediation
        findingId="22222222-2222-4222-8222-222222222222"
        remediation={operational}
      />,
    );
    expect(
      screen.getByText(/permission to view linked tickets/i),
    ).toBeVisible();
    ticketsError = new ApiClientError("network", "", 0);
    view.rerender(
      <FindingRemediation
        findingId="22222222-2222-4222-8222-222222222222"
        remediation={operational}
      />,
    );
    expect(screen.getByText(/offline.*linked ticket/i)).toBeVisible();
  });

  it("hides approved preview text after ticket-list authorization is lost", async () => {
    ticketRows = [];
    const view = render(
      <FindingRemediation
        findingId="22222222-2222-4222-8222-222222222222"
        remediation={operational}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Preview Jira ticket" }),
    );
    await screen.findByText("Approved minimal remediation context");
    ticketsError = new ApiClientError("api", "", 403);
    view.rerender(
      <FindingRemediation
        findingId="22222222-2222-4222-8222-222222222222"
        remediation={operational}
      />,
    );
    expect(
      screen.queryByText("Approved minimal remediation context"),
    ).not.toBeInTheDocument();
  });

  it("keeps ticket state read-only when permission is lost and retries an unavailable list", () => {
    canEditFindings = false;
    ticketsError = new ApiClientError("api", "", 503);
    render(
      <FindingRemediation
        findingId="22222222-2222-4222-8222-222222222222"
        remediation={operational}
      />,
    );
    expect(
      screen.getByText(/linked ticket state is unavailable/i),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", {
        name: /Preview Jira|Sync Jira|Replay Jira/,
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry tickets" }));
    expect(refetchTickets).toHaveBeenCalledTimes(1);
  });

  it("requires a correction reason and only closes after a successful correction", async () => {
    correct.mockResolvedValueOnce(undefined);
    render(
      <FindingRemediation
        findingId="22222222-2222-4222-8222-222222222222"
        remediation={operational}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Correct remediation" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Correct remediation anchor",
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save correction" }),
    );
    expect(
      screen.getByText(
        "A reason is required when correcting an existing anchor.",
      ),
    ).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Correction reason"), {
      target: { value: "Correct the vendor availability evidence." },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save correction" }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Correct remediation anchor" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("explains conflict and permission recovery without losing the form", () => {
    expect(
      remediationRequestMessage(new ApiClientError("api", "", 409)),
    ).toContain("changed");
    expect(
      remediationRequestMessage(new ApiClientError("api", "", 403)),
    ).toContain("permission");
  });
});
