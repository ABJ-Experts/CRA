// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ReportingRehearsalNotice } from "./reporting-rehearsal-notice";

describe("ReportingRehearsalNotice", () => {
  afterEach(cleanup);

  it("marks a rehearsal and makes its non-legal boundary explicit", () => {
    render(<ReportingRehearsalNotice />);

    expect(screen.getByRole("status", { name: "Synthetic rehearsal" }))
      .toHaveTextContent("Not a legal filing");
    expect(screen.getByText(/never notify a regulator/i)).toBeInTheDocument();
    expect(screen.getByText(/separate real reporting workflow/i)).toBeInTheDocument();
  });
});
