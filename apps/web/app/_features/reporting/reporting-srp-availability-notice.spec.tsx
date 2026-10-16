// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ReportingSrpAvailabilityNotice } from "./reporting-srp-availability-notice";

describe("ReportingSrpAvailabilityNotice", () => {
  afterEach(cleanup);

  it("announces the unavailable SRP transport and preserves the manual filing path", () => {
    render(<ReportingSrpAvailabilityNotice />);

    expect(
      screen.getByRole("status", { name: "ENISA SRP submission availability" }),
    ).toHaveTextContent("Automated SRP submission is unavailable");
    expect(
      screen.getByText(/ENISA has not published a supported API\./),
    ).toBeInTheDocument();
    expect(screen.getByText(/Signed manual package/)).toBeInTheDocument();
    expect(screen.getByText(/Record external filing/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /submit to enisa/i }),
    ).not.toBeInTheDocument();
  });
});
