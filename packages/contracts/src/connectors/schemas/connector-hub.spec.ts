import { describe, expect, it } from "vitest";
import {
  connectorCatalogueResponseSchema,
  connectorConfigurationInputSchema,
  connectorScopeDiagnosticsSchema,
  connectorTestDiagnosticSchema,
  disconnectConnectorInputSchema,
  setConnectorSecretInputSchema,
  testConnectorInputSchema,
  updateConnectorInputSchema,
} from "./index.js";

const idempotencyKey = "11111111-1111-4111-8111-111111111111";
const command = { expectedVersion: 2, idempotencyKey };

describe("connector hub security boundaries", () => {
  it("requires optimistic concurrency and idempotency on credential and test commands", () => {
    expect(
      setConnectorSecretInputSchema.safeParse({ secretValue: "canary" })
        .success,
    ).toBe(false);
    expect(testConnectorInputSchema.safeParse({}).success).toBe(false);
    expect(
      setConnectorSecretInputSchema.parse({
        ...command,
        secretValue: "  canary  ",
      }).secretValue,
    ).toBe("  canary  ");
    expect(testConnectorInputSchema.parse(command)).toEqual(command);
    expect(
      disconnectConnectorInputSchema.parse({
        ...command,
        reason: "Operator disconnect",
      }).reason,
    ).toBe("Operator disconnect");
    expect(
      updateConnectorInputSchema.safeParse({
        displayName: "Reference",
        mappingVersion: "v1",
        commitPolicy: "manual",
        expectedVersion: 2,
      }).success,
    ).toBe(false);
  });

  it("permits only bounded reference metadata and rejects nested secrets", () => {
    expect(
      connectorConfigurationInputSchema.parse({
        scopeFilter: { scenario: "create", simulate: "rate_limit" },
        defaultOwnerBinding: {
          responsibleOwnerId: idempotencyKey,
          legalEntityId: idempotencyKey,
        },
      }),
    ).toMatchObject({ scopeFilter: { scenario: "create" } });
    for (const config of [
      { token: "canary" },
      { scopeFilter: { password: "canary" } },
      { arbitrary: {} },
      { tenantOrSiteId: "x".repeat(201) },
      { scopeFilter: { scenario: "invented" } },
    ]) {
      expect(connectorConfigurationInputSchema.safeParse(config).success).toBe(
        false,
      );
    }
  });

  it("rejects unsafe endpoint syntax and secret-bearing URL components", () => {
    expect(
      connectorConfigurationInputSchema.safeParse({
        baseUrl: "https://approved.example/api",
      }).success,
    ).toBe(true);
    for (const baseUrl of [
      "http://example.com",
      "https://user:canary@example.com",
      "https://example.com?token=canary",
      "https://example.com/#canary",
      "https://example.com:8443",
      "https://127.0.0.1",
      "https://[::1]",
      "not-a-url",
    ]) {
      expect(
        connectorConfigurationInputSchema.safeParse({ baseUrl }).success,
      ).toBe(false);
    }
  });

  it("never accepts arbitrary upstream diagnostic messages or unsupported catalogue grants", () => {
    expect(
      connectorTestDiagnosticSchema.safeParse({
        category: "auth_failed",
        message: "canary",
        checkedAt: null,
      }).success,
    ).toBe(false);
    expect(
      connectorCatalogueResponseSchema.safeParse({
        catalogue: [
          {
            id: "github_actions",
            name: "GitHub",
            implementation: "planned",
            phase: "MVP",
            priority: "P0",
            canConfigure: true,
            description: "Planned",
            guidance: "Use a GitHub App",
            scopePolicyVersion: "2026-09-28.1",
            requiredScopes: [],
            scopeIntrospection: "unavailable",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("keeps unavailable scope introspection unknown, without compliance claims", () => {
    const scope = {
      status: "unknown",
      policyVersion: "2026-09-28.1",
      requiredScopes: [],
      grantedScopes: [],
      missingScopes: [],
      excessScopes: [],
      warnings: ["introspection_unavailable"],
      checkedAt: null,
    };
    expect(connectorScopeDiagnosticsSchema.parse(scope).status).toBe("unknown");
    expect(
      connectorScopeDiagnosticsSchema.safeParse({
        ...scope,
        status: "compliant",
      }).success,
    ).toBe(false);
    expect(
      connectorScopeDiagnosticsSchema.safeParse({
        ...scope,
        grantedScopes: ["canary"],
      }).success,
    ).toBe(false);
  });
});
