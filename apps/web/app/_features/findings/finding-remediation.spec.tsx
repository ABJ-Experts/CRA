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

vi.mock("../../_providers/session-provider", () => ({
  useHasPermission: (permission: string) => permission === "can_edit_findings",
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
  useVulnerabilityRemediationHistoryQuery: () => ({
    isLoading: false,
    isError: false,
    data: { current: null, history: [] },
    refetch: vi.fn(),
  }),
}));

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
  beforeEach(() => vi.clearAllMocks());
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
