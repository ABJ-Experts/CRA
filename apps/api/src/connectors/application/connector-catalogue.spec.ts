import { connectorCatalogueResponseSchema } from "@repo/contracts/connectors/schemas";
import {
  CONNECTOR_CATALOGUE,
  findConnectorCatalogueEntry,
} from "./connector-catalogue";
import {
  compareConnectorScopes,
  safeConnectorTestDiagnostic,
} from "./connector-scope-policy";
import { parseConnectorConfiguration } from "./connector-config-policy";

describe("connector catalogue", () => {
  it("publishes the BRD catalogue with CI configuration and keeps other vendors planned", () => {
    expect(
      connectorCatalogueResponseSchema.parse({ catalogue: CONNECTOR_CATALOGUE })
        .catalogue,
    ).toHaveLength(17);
    expect(
      CONNECTOR_CATALOGUE.filter((entry) => entry.canConfigure).map(
        (entry) => entry.id,
      ),
    ).toEqual([
      "reference_conformance",
      "github_actions",
      "gitlab_ci",
      "azure_devops",
      "jira",
      "on_prem_agent",
    ]);
    expect(findConnectorCatalogueEntry("jira")).toMatchObject({
      implementation: "ticketing",
      phase: "V1",
      priority: "P1",
      requiredScopes: [
        "read:application-role:jira",
        "read:field:jira",
        "read:field.default-value:jira",
        "read:field.option:jira",
        "read:group:jira",
        "read:issue:jira",
        "read:issue-details:jira",
        "read:issue-meta:jira",
        "read:issue-type:jira",
        "read:issue.property:jira",
        "read:issue.transition:jira",
        "read:project:jira",
        "read:project.property:jira",
        "read:user:jira",
        "write:issue:jira",
        "write:issue.property:jira",
      ],
    });
    expect(findConnectorCatalogueEntry("github_actions")).toMatchObject({
      implementation: "ci",
      phase: "MVP",
      priority: "P0",
      requiredScopes: ["actions:read", "contents:read", "metadata:read"],
    });
    expect(findConnectorCatalogueEntry("enisa")).toMatchObject({
      phase: "V2",
      priority: "P0",
    });
    expect(findConnectorCatalogueEntry("on_prem_agent")).toMatchObject({
      implementation: "agent",
      phase: "V2",
      canConfigure: true,
      scopeIntrospection: "unavailable",
    });
    expect(findConnectorCatalogueEntry("teamcenter")).toMatchObject({
      canConfigure: false,
    });
    expect(findConnectorCatalogueEntry("invented")).toBeUndefined();
    expect(Object.isFrozen(CONNECTOR_CATALOGUE)).toBe(true);
    for (const entry of CONNECTOR_CATALOGUE)
      expect(Object.isFrozen(entry.requiredScopes)).toBe(true);
  });
});

describe("connector scope policy", () => {
  const policy = {
    version: "v1",
    requiredScopes: ["read:products"],
    allowedScopes: ["read:products", "read:releases"],
  };
  const now = "2026-09-28T10:00:00.000Z";
  it("reports unknown when introspection is unavailable rather than compliant", () => {
    expect(compareConnectorScopes(policy, null, now)).toMatchObject({
      status: "unknown",
      missingScopes: [],
      warnings: ["introspection_unavailable"],
    });
  });
  it("blocks discovered missing privileges and warns on excess privileges", () => {
    expect(
      compareConnectorScopes(policy, ["write:everything"], now),
    ).toMatchObject({
      status: "known",
      missingScopes: ["read:products"],
      excessScopes: ["write:everything"],
      warnings: ["missing_required_scope", "excess_privileges"],
    });
    expect(
      compareConnectorScopes(policy, ["read:products", "read:products"], now),
    ).toMatchObject({ missingScopes: [], excessScopes: [], warnings: [] });
  });
  it("marks the reference fixture privileges inapplicable", () => {
    expect(
      compareConnectorScopes(
        {
          version: "v1",
          requiredScopes: [],
          allowedScopes: [],
          notApplicable: true,
        },
        null,
        null,
      ),
    ).toMatchObject({ status: "not_applicable", warnings: [] });
  });
  it("bounds discovered scopes and never propagates raw provider diagnostics", () => {
    expect(() =>
      compareConnectorScopes(
        policy,
        Array.from({ length: 101 }, (_, index) => `scope-${index}`),
        now,
      ),
    ).toThrow();
    expect(
      safeConnectorTestDiagnostic("auth_failed", now).message,
    ).not.toContain("canary");
    expect(safeConnectorTestDiagnostic("invented", now).category).toBe(
      "unknown",
    );
  });
});

describe("connector configuration policy", () => {
  it("parses registered provider configuration", () => {
    expect(
      parseConnectorConfiguration("reference_conformance", {
        scopeFilter: { scenario: "create" },
      }),
    ).toEqual({ scopeFilter: { scenario: "create" } });
    expect(
      parseConnectorConfiguration("github_actions", {
        providerHost: "github.com",
        appId: "1",
        installationId: "2",
      }),
    ).toEqual({ providerHost: "github.com", appId: "1", installationId: "2" });
    expect(() => parseConnectorConfiguration("github_actions", {})).toThrow();
    expect(parseConnectorConfiguration("on_prem_agent", {})).toEqual({});
    expect(() =>
      parseConnectorConfiguration("on_prem_agent", { command: "run" }),
    ).toThrow();
    expect(() =>
      parseConnectorConfiguration("reference_conformance", {
        secret: "canary",
      }),
    ).toThrow();
  });
});
