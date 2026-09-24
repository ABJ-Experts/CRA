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

  it("shows only the authorized product's exact evidence version and mapped requirements", () => {
    render(
      <EvidenceReusePanel
        reuse={{
          technicalFileLinks: [],
          frameworkControls: [
            {
              evidenceLinkId: "44444444-4444-4444-8444-444444444444",
              controlId: "55555555-5555-4555-8555-555555555555",
              controlTitle: "Secure update process",
              controlStatus: "in_progress",
              evidenceVersionId: "33333333-3333-4333-8333-333333333333",
              requirements: [
                {
                  packKey: "cra-annex-i",
                  versionKey: "oj-2024-11-20-en",
                  requirementKey: "i-1-1",
                  identifier: "Annex I, Part I, 1(1)",
                  heading: "Security properties",
                },
              ],
              requirementsHasMore: true,
              navigationPath:
                "/frameworks?controlId=55555555-5555-4555-8555-555555555555",
            },
          ],
          frameworkControlsHasMore: true,
        }}
      />,
    );

    expect(screen.getByText("Secure update process")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("Annex I, Part I, 1(1)")).toBeInTheDocument();
    expect(screen.getByText("Security properties")).toBeInTheDocument();
    expect(
      screen.getByText("More mappings are available in the control library."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Showing the first 100 authorized control links."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open control" })).toHaveAttribute(
      "href",
      "/frameworks?controlId=55555555-5555-4555-8555-555555555555",
    );
  });
});
