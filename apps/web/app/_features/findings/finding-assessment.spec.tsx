// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  FindingAssessment,
  vulnerabilityAssessmentRequestMessage,
} from "./finding-assessment";
import { ApiClientError } from "../../_lib/http/api-client";

const refetch = vi.fn();

vi.mock("../../_providers/session-provider", () => ({
  useHasPermission: (permission: string) => permission === "can_edit_findings",
}));

vi.mock("./triage.queries", () => ({
  useVulnerabilityFindingAssessmentQuery: () => ({
    isLoading: false,
    isError: false,
    data: { assessment: null, history: [] },
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

  beforeEach(() => vi.clearAllMocks());

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
