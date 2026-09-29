import { z } from "zod";
import { utcZDateTimeSchema } from "../../products/schemas/release-market-lifecycle.schema.js";
import { pagedSchema } from "../../pagination/schemas/pagination.schema.js";
import { connectorSchema } from "./connector.schema.js";

const text = (maximum: number) => z.string().trim().min(1).max(maximum);
const scopeNames = z
  .array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/))
  .max(100);
export const connectorCatalogueEntrySchema = z
  .object({
    id: z.enum([
      "reference_conformance",
      "github_actions",
      "gitlab_ci",
      "azure_devops",
      "entra_id",
      "okta",
      "jira",
      "slack",
      "teams",
      "smtp",
      "s3",
      "servicenow",
      "teamcenter",
      "windchill",
      "siem",
      "enisa",
    ]),
    name: text(100),
    implementation: z.enum(["reference", "planned"]),
    phase: z.enum(["MVP", "V1", "V2"]),
    priority: z.enum(["P0", "P1", "P2"]),
    canConfigure: z.boolean(),
    description: text(500),
    guidance: text(1_000),
    scopePolicyVersion: text(100),
    requiredScopes: scopeNames,
    scopeIntrospection: z.enum(["unavailable", "not_applicable"]),
  })
  .strict()
  .refine(
    (entry) =>
      entry.canConfigure === (entry.id === "reference_conformance") &&
      (entry.implementation === "reference") ===
        (entry.id === "reference_conformance"),
    "Only the registered reference adapter can be configured",
  );
export const connectorCatalogueResponseSchema = z
  .object({
    catalogue: z.array(connectorCatalogueEntrySchema).max(100),
  })
  .strict();

export const connectorScopeDiagnosticsSchema = z
  .object({
    status: z.enum(["unknown", "known", "not_applicable"]),
    policyVersion: text(100),
    requiredScopes: scopeNames,
    grantedScopes: scopeNames,
    missingScopes: scopeNames,
    excessScopes: scopeNames,
    warnings: z
      .array(
        z.enum([
          "introspection_unavailable",
          "excess_privileges",
          "missing_required_scope",
        ]),
      )
      .max(3),
    checkedAt: utcZDateTimeSchema.nullable(),
  })
  .strict()
  .refine(
    (scope) =>
      scope.status === "known" ||
      (scope.grantedScopes.length === 0 &&
        scope.missingScopes.length === 0 &&
        scope.excessScopes.length === 0),
    "Unknown or inapplicable introspection cannot report discovered privileges",
  );

/** Exact messages, rather than arbitrary provider text, are the redaction boundary. */
export const CONNECTOR_TEST_MESSAGES = Object.freeze({
  not_tested: "Test this connection after configuration or credential changes.",
  success:
    "Reference fixture validation succeeded; no vendor endpoint was contacted.",
  auth_failed:
    "Credentials were rejected or have expired. Replace them and test again.",
  missing_scope:
    "Required privileges are missing. Grant the minimum required privileges and test again.",
  unreachable:
    "The approved endpoint could not be reached. Check availability and network policy.",
  rate_limited:
    "The provider rate limit was reached. Wait before testing again.",
  malformed_response:
    "The provider response could not be validated. Check the supported API and version.",
  unsupported_capability:
    "This adapter does not support the requested capability.",
  unsupported_version:
    "The endpoint API version is unsupported. Select a supported version.",
  payload_too_large: "The provider response exceeded the supported size limit.",
  vault_unavailable:
    "The credential key is unavailable. Contact your administrator; credentials were not changed.",
  timeout:
    "The connection test timed out. Check provider availability and retry explicitly.",
  interrupted:
    "The test was interrupted or became stale. Start a new test explicitly.",
  unknown:
    "The connection could not be verified. Retry explicitly or contact your administrator.",
});
export const connectorTestDiagnosticSchema = z
  .object({
    category: z.enum([
      "not_tested",
      "success",
      "auth_failed",
      "missing_scope",
      "unreachable",
      "rate_limited",
      "malformed_response",
      "unsupported_capability",
      "unsupported_version",
      "payload_too_large",
      "vault_unavailable",
      "interrupted",
      "timeout",
      "unknown",
    ]),
    message: z.enum(Object.values(CONNECTOR_TEST_MESSAGES)),
    checkedAt: utcZDateTimeSchema.nullable(),
  })
  .strict()
  .refine(
    (test) => test.message === CONNECTOR_TEST_MESSAGES[test.category],
    "Diagnostic messages must match their safe category",
  );
export const connectorConnectionStateSchema = z
  .object({
    status: z.enum([
      "not_connected",
      "healthy",
      "degraded",
      "auth_expired",
      "syncing",
    ]),
    reason: z.enum([
      "disabled",
      "archived",
      "credentials_missing",
      "credentials_revoked",
      "test_required",
      "test_failed",
      "missing_scope",
      "sync_in_progress",
      "ready",
      "vault_unavailable",
      "authentication_expired",
    ]),
    lastSyncAt: utcZDateTimeSchema.nullable(),
    connectionRevision: z.number().int().nonnegative(),
    credentialRevision: z.number().int().nonnegative(),
    scope: connectorScopeDiagnosticsSchema,
    test: connectorTestDiagnosticSchema,
  })
  .strict();
export const connectorOverviewSchema = z
  .object({
    connector: connectorSchema,
    connection: connectorConnectionStateSchema,
  })
  .strict();
export const connectorOverviewResponseSchema = z
  .object({ overview: connectorOverviewSchema })
  .strict();
export const connectorOverviewsResponseSchema = z
  .object({ connectors: pagedSchema(connectorOverviewSchema) })
  .strict();
