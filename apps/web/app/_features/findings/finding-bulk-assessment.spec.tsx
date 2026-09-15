// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  FindingBulkAssessmentAction,
  vulnerabilityAssessmentBulkRequestMessage,
} from "./finding-bulk-assessment";
import { ApiClientError } from "../../_lib/http/api-client";

const createPreview = vi.fn();

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

vi.mock("./triage.queries", () => ({
  useCreateVulnerabilityAssessmentBulkPreviewMutation: () => ({
    isPending: false,
    isError: false,
    mutateAsync: createPreview,
  }),
  useCreateVulnerabilityAssessmentPropagationPreviewMutation: () => ({
    isPending: false,
    isError: false,
    mutateAsync: vi.fn(),
  }),
  useExecuteVulnerabilityAssessmentBulkOperationMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useRetryVulnerabilityAssessmentBulkOperationMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useUndoVulnerabilityAssessmentBulkOperationMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
}));

describe("FindingBulkAssessmentAction", () => {
  it("keeps selected rows distinct from all matching findings", () => {
    render(
      <FindingBulkAssessmentAction
        filters={{ sort: "lastEvaluatedAt", order: "desc" }}
        selectedFindingIds={["11111111-1111-4111-8111-111111111111"]}
        onApplied={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Bulk assess findings" }),
    );
    expect(
      screen.getByText(/frozen server-side target list/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Selected rows (1)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("combobox", { name: "Scope" }));
    expect(
      screen.getByText("All findings matching filters"),
    ).toBeInTheDocument();
  });

  it("explains offline and changed-preview recovery without hiding entered work", () => {
    expect(
      vulnerabilityAssessmentBulkRequestMessage(
        new ApiClientError("network", "", 0),
      ),
    ).toContain("offline");
    expect(
      vulnerabilityAssessmentBulkRequestMessage(
        new ApiClientError("api", "", 409),
      ),
    ).toContain("preview changed");
  });
});
