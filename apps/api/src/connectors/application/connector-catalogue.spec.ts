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
  it("publishes the BRD catalogue without granting planned vendor execution", () => {
    expect(
      connectorCatalogueResponseSchema.parse({ catalogue: CONNECTOR_CATALOGUE })
        .catalogue,
    ).toHaveLength(16);
    expect(
      CONNECTOR_CATALOGUE.filter((entry) => entry.canConfigure).map(
        (entry) => entry.id,
      ),
    ).toEqual(["reference_conformance"]);
    expect(findConnectorCatalogueEntry("github_actions")).toMatchObject({
      implementation: "planned",
      phase: "MVP",
      priority: "P0",
    });
    expect(findConnectorCatalogueEntry("enisa")).toMatchObject({
      phase: "V2",
      priority: "P0",
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
  it("parses only registered reference configuration", () => {
    expect(
      parseConnectorConfiguration("reference_conformance", {
        scopeFilter: { scenario: "create" },
      }),
    ).toEqual({ scopeFilter: { scenario: "create" } });
    expect(() => parseConnectorConfiguration("github_actions", {})).toThrow();
    expect(() =>
      parseConnectorConfiguration("reference_conformance", {
        secret: "canary",
      }),
    ).toThrow();
  });
});
