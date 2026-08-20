// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SbomIntakeSection } from "./sbom-intake-section";

vi.mock("../../_features/sboms/sboms.queries", () => ({
  useSbomJobQuery: () => ({
    data: undefined,
    isPending: false,
    isError: false,
  }),
}));

afterEach(cleanup);

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const RELEASE_ID = "22222222-2222-4222-8222-222222222222";

describe("SbomIntakeSection", () => {
  it("explains the release requirement without offering storage access when no release exists", () => {
    render(
      <SbomIntakeSection
        productId={PRODUCT_ID}
        releases={[]}
        canView
        canUpload
        canReplay={false}
        enabled
      />,
    );

    expect(
      screen.getByRole("heading", { name: "SBOM evidence" }),
    ).toBeVisible();
    expect(screen.getByText(/Create a product release/i)).toBeVisible();
    expect(screen.queryByLabelText("SBOM file")).not.toBeInTheDocument();
  });

  it("keeps the evidence status readable while upload authority is absent", () => {
    render(
      <SbomIntakeSection
        productId={PRODUCT_ID}
        releases={[{ id: RELEASE_ID, label: "Sentinel 1.0", version: "1.0.0" }]}
        canView
        canUpload={false}
        canReplay={false}
        enabled
      />,
    );

    expect(screen.getByText(/view SBOM evidence/i)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Upload SBOM" }),
    ).not.toBeInTheDocument();
  });

  it("provides a labeled, constrained upload control for an authorized release", () => {
    render(
      <SbomIntakeSection
        productId={PRODUCT_ID}
        releases={[{ id: RELEASE_ID, label: "Sentinel 1.0", version: "1.0.0" }]}
        canView
        canUpload
        canReplay={false}
        enabled
      />,
    );

    expect(screen.getByLabelText("Release")).toHaveValue(RELEASE_ID);
    expect(screen.getByLabelText("SBOM file")).toHaveAttribute(
      "accept",
      expect.stringContaining("application/vnd.cyclonedx+json"),
    );
    expect(screen.getByRole("button", { name: "Upload SBOM" })).toBeDisabled();
  });
});
