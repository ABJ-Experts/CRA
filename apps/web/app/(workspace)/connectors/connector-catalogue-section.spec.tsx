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
  it("links SIEM to its dedicated authorized workflow without generic setup", () => {
    const onConfigure = vi.fn();
    render(
      <ConnectorCatalogueSection
        entries={[
          {
            ...base,
            id: "siem",
            name: "SIEM",
            implementation: "siem",
            canConfigure: true,
          },
        ]}
        canCreate={false}
        onConfigure={onConfigure}
      />,
    );
    expect(
      screen.getByRole("link", { name: "Manage SIEM forwarding" }),
    ).toHaveAttribute("href", "/connectors/siem");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(onConfigure).not.toHaveBeenCalled();
  });
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
  it("opens the implemented CI provider setup without calling it a reference fixture", () => {
    const onConfigure = vi.fn();
    render(
      <ConnectorCatalogueSection
        entries={[{ ...entries[1]!, implementation: "ci", canConfigure: true }]}
        canCreate
        onConfigure={onConfigure}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Configure GitHub and Actions" }),
    );
    expect(onConfigure).toHaveBeenCalledWith("github_actions");
    expect(screen.getByText("CI run verification")).toBeVisible();
  });
  it("labels the outbound agent as implemented while keeping PLM vendors planned", () => {
    render(
      <ConnectorCatalogueSection
        entries={[
          {
            ...base,
            id: "on_prem_agent",
            name: "On-premises agent",
            implementation: "agent",
            canConfigure: true,
          },
          {
            ...base,
            id: "teamcenter",
            name: "Teamcenter",
            implementation: "planned",
            canConfigure: false,
          },
          {
            ...base,
            id: "windchill",
            name: "Windchill",
            implementation: "planned",
            canConfigure: false,
          },
        ]}
        canCreate
        onConfigure={vi.fn()}
      />,
    );
    expect(
      within(screen.getByRole("row", { name: /On-premises agent/ })).getByText(
        "Outbound agent",
      ),
    ).toBeVisible();
    expect(
      within(screen.getByRole("row", { name: /On-premises agent/ })).getByText(
        /CRA cannot inspect them/,
      ),
    ).toBeInTheDocument();
    for (const vendor of ["Teamcenter", "Windchill"]) {
      expect(
        within(screen.getByRole("row", { name: new RegExp(vendor) })).getByText(
          "Planned integration",
        ),
      ).toBeVisible();
    }
  });
});
