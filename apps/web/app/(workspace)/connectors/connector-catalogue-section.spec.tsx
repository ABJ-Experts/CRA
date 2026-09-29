// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectorCatalogueSection } from "./connector-catalogue-section";
import type { ConnectorCatalogueEntry } from "@repo/contracts/connectors/types";

const base = {
  phase: "V1",
  priority: "P0",
  description: "Connector description",
  guidance: "Use minimum privileges",
  scopePolicyVersion: "v1",
  requiredScopes: [] as string[],
  scopeIntrospection: "unavailable",
} as const;
const entries: ConnectorCatalogueEntry[] = [
  {
    ...base,
    id: "reference_conformance",
    name: "Reference conformance",
    implementation: "reference",
    canConfigure: true,
  },
  {
    ...base,
    id: "github_actions",
    name: "GitHub and Actions",
    implementation: "planned",
    canConfigure: false,
  },
];
describe("connector catalogue availability", () => {
  afterEach(cleanup);
  it("offers configuration only for the registered reference fixture", () => {
    render(
      <ConnectorCatalogueSection
        entries={entries}
        canCreate
        onConfigure={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Configure reference adapter" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Planned integration")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /configure github/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Reference/test adapter")).toBeInTheDocument();
  });
  it("keeps least-privilege guidance readable to viewers without create permission", () => {
    render(
      <ConnectorCatalogueSection
        entries={entries}
        canCreate={false}
        onConfigure={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getAllByText("Use minimum privileges")).toHaveLength(2);
  });
});
