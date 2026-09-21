// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EvidenceReusePanel } from "./evidence-reuse-panel";

describe("EvidenceReusePanel", () => {
  afterEach(() => cleanup());

  it("shows exact technical-file links and an honest M10 empty state", () => {
    render(
      <EvidenceReusePanel
        reuse={{
          technicalFileLinks: [
            {
              technicalFileId: "44444444-4444-4444-8444-444444444444",
              productId: "11111111-1111-4111-8111-111111111111",
              productName: "Gateway",
              sectionId: "22222222-2222-4222-8222-222222222222",
              sectionKey: "test_reports",
              sectionHeading: "Test reports",
              linkedVersionId: "33333333-3333-4333-8333-333333333333",
              linkedVersionNumber: 2,
              status: "stale",
              reviewedAt: null,
              navigationPath:
                "/products/11111111-1111-4111-8111-111111111111/technical-file",
            },
          ],
          frameworkControls: [],
        }}
      />,
    );

    expect(screen.getByText("Gateway")).toBeInTheDocument();
    expect(screen.getByText("Test reports")).toBeInTheDocument();
    expect(screen.getByText("Version 2")).toBeInTheDocument();
    expect(screen.getByText("Stale — review needed")).toBeInTheDocument();
    expect(
      screen.getByText("No framework mappings are available"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open technical file" }),
    ).toHaveAttribute(
      "href",
      "/products/11111111-1111-4111-8111-111111111111/technical-file",
    );
  });

  it("does not imply an unavailable target is current or reviewed", () => {
    render(
      <EvidenceReusePanel
        reuse={{
          technicalFileLinks: [
            {
              technicalFileId: "44444444-4444-4444-8444-444444444444",
              productId: "11111111-1111-4111-8111-111111111111",
              productName: "Gateway",
              sectionId: "22222222-2222-4222-8222-222222222222",
              sectionKey: "test_reports",
              sectionHeading: "Test reports",
              linkedVersionId: "33333333-3333-4333-8333-333333333333",
              linkedVersionNumber: 2,
              status: "unavailable",
              reviewedAt: null,
              navigationPath:
                "/products/11111111-1111-4111-8111-111111111111/technical-file",
            },
          ],
          frameworkControls: [],
        }}
      />,
    );

    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Current")).not.toBeInTheDocument();
  });
});
