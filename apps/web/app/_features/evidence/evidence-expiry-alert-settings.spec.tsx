// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EvidenceExpiryAlertSettings } from "./evidence-expiry-alert-settings";

const queries = vi.hoisted(() => ({
  useEvidenceExpiryAlertIntervalsQuery: vi.fn(),
  useUpdateEvidenceExpiryAlertIntervalsMutation: vi.fn(),
}));

vi.mock("./evidence.queries", () => queries);

describe("EvidenceExpiryAlertSettings", () => {
  it("rejects duplicate thresholds locally without discarding the draft", () => {
    queries.useEvidenceExpiryAlertIntervalsQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        expiryAlertIntervals: {
          thresholdDays: [30, 14, 7, 1],
          version: 2,
          updatedAt: "2026-09-01T00:00:00.000Z",
          updatedByUserId: null,
        },
      },
    });
    const mutateAsync = vi.fn();
    queries.useUpdateEvidenceExpiryAlertIntervalsMutation.mockReturnValue({
      isPending: false,
      mutateAsync,
    });

    render(<EvidenceExpiryAlertSettings enabled />);
    const input = screen.getByLabelText("Days before expiry");
    fireEvent.change(input, { target: { value: "30, 30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save expiry alerts" }));

    expect(
      screen.getByText(/Use 1–12 unique whole-day thresholds/i),
    ).toBeInTheDocument();
    expect(input).toHaveValue("30, 30");
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
