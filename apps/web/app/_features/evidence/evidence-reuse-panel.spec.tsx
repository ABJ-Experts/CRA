// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { EvidenceReusePanel } from "./evidence-reuse-panel";
import { frameworksApi } from "../frameworks/frameworks.api";

function renderReuse(element: React.ReactElement) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      {element}
    </QueryClientProvider>,
  );
}

describe("EvidenceReusePanel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows scoped curated relevance without claiming coverage", async () => {
    const productId = "11111111-1111-4111-8111-111111111111";
    const evidenceVersionId = "33333333-3333-4333-8333-333333333333";
    vi.spyOn(frameworksApi, "crosswalkEvidenceReuse").mockResolvedValue({
      evidenceValid: false,
      nextCursor: null,
      relations: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          source: { packKey: "cra", versionKey: "v1", requirementKey: "r1" },
          target: { packKey: "iec", versionKey: "v2", requirementKey: "r2" },
          relationship: "partial",
          direction: "one_way",
          rationale: "Related implementation activity",
          provenance: "Reviewed crosswalk",
          reviewer: "Standards curator",
          reviewedAt: "2026-01-01T00:00:00Z",
          curated: true,
        },
      ],
    });
    renderReuse(
      <EvidenceReusePanel
        reuse={{ technicalFileLinks: [], frameworkControls: [] }}
        productId={productId}
        evidenceVersionId={evidenceVersionId}
      />,
    );
    expect(
      await screen.findByText(/Evidence version needs validity review/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/partial · one way/i)).toBeInTheDocument();
    expect(
      screen.getByText(/do not add a control mapping or certify/i),
    ).toBeInTheDocument();
    expect(frameworksApi.crosswalkEvidenceReuse).toHaveBeenCalledWith(
      evidenceVersionId,
      productId,
      undefined,
      expect.anything(),
    );
  });

  it("marks the target as directly mapped for a reverse bidirectional reuse", async () => {
    vi.spyOn(frameworksApi, "crosswalkEvidenceReuse").mockResolvedValue({
      evidenceValid: true,
      nextCursor: null,
      relations: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          source: { packKey: "cra", versionKey: "v1", requirementKey: "r1" },
          target: { packKey: "iec", versionKey: "v2", requirementKey: "r2" },
          relationship: "partial",
          direction: "bidirectional",
          rationale: "Reviewed relation",
          provenance: "Curator worksheet",
          reviewer: "Standards curator",
          reviewedAt: "2026-01-01T00:00:00Z",
          curated: true,
        },
      ],
    });
    renderReuse(
      <EvidenceReusePanel
        productId="11111111-1111-4111-8111-111111111111"
        evidenceVersionId="33333333-3333-4333-8333-333333333333"
        reuse={{
          technicalFileLinks: [],
          frameworkControls: [
            {
              evidenceLinkId: "66666666-6666-4666-8666-666666666666",
              controlId: "55555555-5555-4555-8555-555555555555",
              controlTitle: "Linked control",
              controlStatus: "implemented",
              evidenceVersionId: "33333333-3333-4333-8333-333333333333",
              requirements: [
                {
                  packKey: "iec",
                  versionKey: "v2",
                  requirementKey: "r2",
                  identifier: "R2",
                  heading: "Target",
                },
              ],
              requirementsHasMore: false,
              navigationPath:
                "/frameworks?controlId=55555555-5555-4555-8555-555555555555",
            },
          ],
        }}
      />,
    );
    const table = await screen.findByRole("table", {
      name: "Applicable curated requirement relationships",
    });
    expect(
      within(table).getByRole("columnheader", { name: "Crosswalk source" }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("columnheader", { name: "Crosswalk target" }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("cell", {
        name: /iec · v2 · r2 Directly mapped/,
      }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("cell", { name: /cra · v1 · r1/ }),
    ).not.toHaveTextContent("Directly mapped");
  });

  it("keeps existing reuse visible when cross-framework relevance fails, then retries", async () => {
    const read = vi
      .spyOn(frameworksApi, "crosswalkEvidenceReuse")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        evidenceValid: false,
        relations: [],
        nextCursor: null,
      });
    renderReuse(
      <EvidenceReusePanel
        reuse={{ technicalFileLinks: [], frameworkControls: [] }}
        productId="11111111-1111-4111-8111-111111111111"
        evidenceVersionId="33333333-3333-4333-8333-333333333333"
      />,
    );
    expect(
      screen.getByText("No framework mappings are available"),
    ).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(/unavailable/i);
    fireEvent.click(screen.getByRole("button", { name: "Retry relevance" }));
    expect(
      await screen.findByText(/Evidence version needs validity review/i),
    ).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("shows exact technical-file links and an honest M10 empty state", () => {
    renderReuse(
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
    renderReuse(
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
    renderReuse(
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
