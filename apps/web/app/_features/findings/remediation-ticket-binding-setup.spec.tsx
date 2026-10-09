// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { RemediationTicketBindingSetup } from "./remediation-ticket-binding-setup";

const dryRun = vi.fn();
const upsert = vi.fn();
const refetchDetail = vi.fn();
const refetchConnectors = vi.fn();
let detailLoading = false;
let detailError = false;
let connectorsLoading = false;
let connectorsError = false;
let connectorPageCount = 1;
vi.mock("./triage.queries", () => ({
  useVulnerabilityTriageDetailQuery: () => ({
    isLoading: detailLoading,
    isError: detailError,
    data: {
      detail: {
        finding: { productId: "66666666-6666-4666-8666-666666666666" },
      },
    },
    refetch: refetchDetail,
  }),
  useDryRunVulnerabilityRemediationTicketBindingMutation: () => ({
    mutateAsync: dryRun,
    isPending: false,
  }),
  useUpsertVulnerabilityRemediationTicketBindingMutation: () => ({
    mutateAsync: upsert,
    isPending: false,
  }),
}));
vi.mock("../connectors/connectors.queries", () => ({
  useConnectorOverviewsQuery: () => ({
    isLoading: connectorsLoading,
    isError: connectorsError,
    data: {
      connectors: {
        rows: [
          {
            connector: {
              id: "55555555-5555-4555-8555-555555555555",
              connectorType: "jira",
              displayName: "Security Jira",
              connectionConfig: {
                cloudId: "77777777-7777-4777-8777-777777777777",
              },
              enabled: true,
              archivedAt: null,
            },
            connection: { status: "healthy" },
          },
        ],
        page: 1,
        pageSize: 50,
        total: 1,
        pageCount: connectorPageCount,
      },
    },
    refetch: refetchConnectors,
  }),
}));

afterEach(() => {
  cleanup();
  dryRun.mockReset();
  upsert.mockReset();
  refetchDetail.mockReset();
  refetchConnectors.mockReset();
  detailLoading = false;
  detailError = false;
  connectorsLoading = false;
  connectorsError = false;
  connectorPageCount = 1;
});

function renderSetup() {
  render(
    <RemediationTicketBindingSetup
      findingId="11111111-1111-4111-8111-111111111111"
      bindings={[]}
    />,
  );
}

function fillMapping() {
  fireEvent.change(screen.getByLabelText("Jira connection"), {
    target: { value: "55555555-5555-4555-8555-555555555555" },
  });
  fireEvent.change(screen.getByLabelText("Jira project ID"), {
    target: { value: "10000" },
  });
  fireEvent.change(screen.getByLabelText("Jira project key"), {
    target: { value: "SEC" },
  });
  fireEvent.change(screen.getByLabelText("Issue type ID"), {
    target: { value: "10001" },
  });
  fireEvent.change(screen.getByLabelText("Status transitions JSON"), {
    target: {
      value: '[{"fromStatusId":"1","toStatusId":"2","transitionId":"11"}]',
    },
  });
  fireEvent.change(screen.getByLabelText("Status mappings JSON"), {
    target: { value: '[{"statusId":"1","workState":"open"}]' },
  });
}

it("requires successful dry-run and an unchanged draft before owner save", async () => {
  dryRun.mockResolvedValue({ valid: true, errors: [] });
  renderSetup();
  fillMapping();
  fireEvent.click(
    screen.getByRole("button", { name: "Validate Jira mapping" }),
  );
  await waitFor(() => expect(dryRun).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Save Jira binding" }),
    ).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText("Jira project key"), {
    target: { value: "OPS" },
  });
  expect(
    screen.getByRole("button", { name: "Save Jira binding" }),
  ).toBeDisabled();
  expect(upsert).not.toHaveBeenCalled();
});

it("sends owner-approved mapping with an idempotency key only after dry-run", async () => {
  dryRun.mockResolvedValue({ valid: true, errors: [] });
  upsert.mockResolvedValue({
    binding: {
      id: "44444444-4444-4444-8444-444444444444",
      connectorId: "55555555-5555-4555-8555-555555555555",
      productId: "66666666-6666-4666-8666-666666666666",
      cloudId: "77777777-7777-4777-8777-777777777777",
      projectId: "10000",
      projectKey: "SEC",
      issueTypeId: "10001",
      statusTransitions: [
        { fromStatusId: "1", toStatusId: "2", transitionId: "11" },
      ],
      statusMappings: [{ statusId: "1", workState: "open" }],
      customFieldMappings: [],
      version: 1,
    },
  });
  renderSetup();
  fillMapping();
  fireEvent.click(
    screen.getByRole("button", { name: "Validate Jira mapping" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Save Jira binding" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save Jira binding" }));
  await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
  expect(upsert.mock.calls[0]?.[0]).toMatchObject({
    connectorId: "55555555-5555-4555-8555-555555555555",
    cloudId: "77777777-7777-4777-8777-777777777777",
    projectKey: "SEC",
    idempotencyKey: expect.any(String),
  });
});

it("shows provider dry-run errors and retains edits without enabling save", async () => {
  dryRun.mockResolvedValue({
    valid: false,
    errors: [
      {
        fieldId: "customfield_10010",
        code: "invalid_field",
        message: "Field is unavailable",
      },
    ],
  });
  renderSetup();
  fillMapping();
  fireEvent.click(
    screen.getByRole("button", { name: "Validate Jira mapping" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Field is unavailable"),
  );
  expect(screen.getByLabelText("Jira project key")).toHaveValue("SEC");
  expect(
    screen.getByRole("button", { name: "Save Jira binding" }),
  ).toBeDisabled();
});

it("reports malformed mapping JSON locally without contacting Jira", () => {
  renderSetup();
  fillMapping();
  fireEvent.change(screen.getByLabelText("Status mappings JSON"), {
    target: { value: "{" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Validate Jira mapping" }),
  );
  expect(screen.getByRole("alert")).toHaveTextContent("statusMappings");
  expect(dryRun).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Save Jira binding" }),
  ).toBeDisabled();
});

it("shows loading, unavailable, and retry states without an editable form", () => {
  detailLoading = true;
  const view = render(
    <RemediationTicketBindingSetup
      findingId="11111111-1111-4111-8111-111111111111"
      bindings={[]}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("Loading finding");
  expect(screen.queryByLabelText("Jira connection")).not.toBeInTheDocument();
  detailLoading = false;
  connectorsError = true;
  view.rerender(
    <RemediationTicketBindingSetup
      findingId="11111111-1111-4111-8111-111111111111"
      bindings={[]}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("setup is unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Retry setup" }));
  expect(refetchDetail).toHaveBeenCalledTimes(1);
  expect(refetchConnectors).toHaveBeenCalledTimes(1);
});

it("loads an existing versioned binding for edit without changing it before validation", () => {
  const binding = {
    id: "44444444-4444-4444-8444-444444444444",
    connectorId: "55555555-5555-4555-8555-555555555555",
    productId: "66666666-6666-4666-8666-666666666666",
    cloudId: "77777777-7777-4777-8777-777777777777",
    provider: "jira" as const,
    projectId: "10000",
    projectKey: "SEC",
    issueTypeId: "10001",
    externalBaseUrl: "https://example.atlassian.net",
    statusTransitions: [
      { fromStatusId: "1", toStatusId: "2", transitionId: "11" },
    ],
    statusMappings: [{ statusId: "1", workState: "open" as const }],
    customFieldMappings: [],
    status: "active" as const,
    version: 2,
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
  };
  render(
    <RemediationTicketBindingSetup
      findingId="11111111-1111-4111-8111-111111111111"
      bindings={[binding]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit SEC · active" }));
  expect(screen.getByLabelText("Jira project key")).toHaveValue("SEC");
  expect(
    screen.getByRole("button", { name: "Save Jira binding" }),
  ).toBeDisabled();
  expect(upsert).not.toHaveBeenCalled();
});

it("offers bounded connector pagination for an owner with many connections", () => {
  connectorPageCount = 2;
  renderSetup();
  expect(
    screen.getByRole("button", { name: "Previous connections" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Next connections" }));
  expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Next connections" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Previous connections" }));
  expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
});
