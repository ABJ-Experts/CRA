// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FindingAssessment,
  vulnerabilityAssessmentRequestMessage,
} from "./finding-assessment";
import { ApiClientError } from "../../_lib/http/api-client";

const refetch = vi.fn();
const findingId = "11111111-1111-4111-8111-111111111111";
const assessmentId = "22222222-2222-4222-8222-222222222222";
const obsoleteAssessmentId = "33333333-3333-4333-8333-333333333333";
const query = vi.hoisted(() => ({
  assessment: null as Record<string, unknown> | null,
}));
const permissions = vi.hoisted(() => ({ canApprove: false }));
const currentAssessment = () => ({
  id: assessmentId,
  findingId,
  supersedesId: obsoleteAssessmentId,
  revision: 2,
  isCurrent: true,
  status: "affected",
  justification: null,
  detail: "Replacement assessment content.",
  changeReason: "New review.",
  evidenceLinks: [],
  approvalState: "awaiting_approval",
  approvalRequired: true,
  policySeverity: "high",
  policyVersion: 0,
  submittedAt: "2026-09-07T10:00:00.000Z",
  submittedByUserId: findingId,
  decidedAt: null,
  decidedByUserId: null,
  decisionReason: null,
  version: 1,
});

vi.mock("../../_providers/session-provider", () => ({
  useHasPermission: (permission: string) =>
    permission === "can_edit_findings" ||
    (permission === "can_approve_findings" && permissions.canApprove),
}));

vi.mock("./finding-bulk-assessment", () => ({
  FindingAssessmentPropagationAction: () => null,
}));

vi.mock("./triage.queries", () => ({
  useVulnerabilityFindingAssessmentQuery: () => ({
    isLoading: false,
    isError: false,
    data: { assessment: query.assessment, history: [] },
    refetch,
  }),
  useVulnerabilityAssessmentApprovalPolicyQuery: () => ({
    data: undefined,
    isError: false,
  }),
  useSubmitVulnerabilityFindingAssessmentMutation: () => ({
    isPending: false,
    isError: false,
    mutateAsync: vi.fn(),
  }),
  useApproveVulnerabilityFindingAssessmentMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useRejectVulnerabilityFindingAssessmentMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useUpdateVulnerabilityAssessmentApprovalPolicyMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
}));

describe("FindingAssessment", () => {
  afterEach(cleanup);
  it("explains the approval boundary without conflating MFA and self-approval", () => {
    expect(
      vulnerabilityAssessmentRequestMessage(
        new ApiClientError("api", "", 403, "mfa_required"),
      ),
    ).toContain("Two-factor");
    expect(
      vulnerabilityAssessmentRequestMessage(
        new ApiClientError("api", "", 403, "forbidden"),
      ),
    ).toContain("own");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    query.assessment = null;
    permissions.canApprove = false;
  });

  it("does not show a replacement assessment for an obsolete task link", () => {
    permissions.canApprove = true;
    query.assessment = currentAssessment();
    render(
      <FindingAssessment
        findingId={findingId}
        linkedAssessmentId={obsoleteAssessmentId}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Linked assessment is no longer current",
    );
    expect(
      screen.queryByText("Replacement assessment content."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve assessment" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a matching task link actionable with source approval permission", () => {
    permissions.canApprove = true;
    query.assessment = currentAssessment();
    render(
      <FindingAssessment
        findingId={findingId}
        linkedAssessmentId={assessmentId}
      />,
    );
    expect(
      screen.getByText("Replacement assessment content."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Approve assessment" }),
    ).toBeEnabled();
  });

  it("blocks assessment actions for an invalid task link", () => {
    permissions.canApprove = true;
    query.assessment = currentAssessment();
    render(<FindingAssessment findingId={findingId} invalidAssessmentLink />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "assessment link is invalid",
    );
    expect(
      screen.queryByRole("button", { name: "Approve assessment" }),
    ).not.toBeInTheDocument();
  });

  it("keeps optional external evidence explicit and blocks incomplete links", () => {
    render(
      <FindingAssessment findingId="11111111-1111-4111-8111-111111111111" />,
    );

    expect(
      screen.getByText(
        "No VEX assessment has been submitted for this finding.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create assessment" }));
    fireEvent.change(screen.getByLabelText(/assessment detail/i), {
      target: { value: "The affected code path is present." },
    });
    fireEvent.change(screen.getByLabelText(/revision reason/i), {
      target: { value: "Initial investigation is complete." },
    });
    fireEvent.change(screen.getByLabelText("Evidence title"), {
      target: { value: "Vendor advisory" },
    });

    expect(
      screen.getByRole("button", { name: "Submit assessment" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/credential-free HTTPS URL and evidence title/i),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("HTTPS URL"), {
      target: { value: "https://example.test/advisory" },
    });

    expect(
      screen.getByRole("button", { name: "Submit assessment" }),
    ).toBeEnabled();
  });
});
