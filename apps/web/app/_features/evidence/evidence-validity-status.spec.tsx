// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EvidenceValidityStatus } from "./evidence-validity-status";

describe("EvidenceValidityStatus", () => {
  it("makes missing and open-ended validity explicit", () => {
    const { rerender } = render(
      <EvidenceValidityStatus
        status="missing"
        validFrom={null}
        validUntil={null}
      />,
    );

    expect(screen.getByText("Validity not supplied")).toBeInTheDocument();

    rerender(
      <EvidenceValidityStatus
        status="open_ended"
        validFrom="2026-01-01T00:00:00.000Z"
        validUntil={null}
      />,
    );

    expect(
      screen.getByText("Open-ended validity — no expiry alert is scheduled"),
    ).toBeInTheDocument();
  });

  it("pairs expiry state text with a non-colour cue", () => {
    render(
      <EvidenceValidityStatus
        status="expired"
        validFrom={null}
        validUntil="2026-01-01T00:00:00.000Z"
      />,
    );

    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(screen.getByLabelText("Expired validity")).toBeInTheDocument();
  });
});
