import {
  CONNECTOR_TEST_MESSAGES,
  connectorScopeDiagnosticsSchema,
  connectorTestDiagnosticSchema,
} from "@repo/contracts/connectors/schemas";
import type {
  ConnectorScopeDiagnostics,
  ConnectorTestDiagnostic,
} from "@repo/contracts/connectors/types";

export type ConnectorScopePolicy = Readonly<{
  version: string;
  requiredScopes: readonly string[];
  allowedScopes: readonly string[];
  notApplicable?: boolean;
}>;

/** Only server-discovered scope names belong here; caller metadata is not evidence. */
export function compareConnectorScopes(
  policy: ConnectorScopePolicy,
  grantedScopes: readonly string[] | null,
  checkedAt: string | null,
): ConnectorScopeDiagnostics {
  const requiredScopes = [...new Set(policy.requiredScopes)].sort();
  if (policy.notApplicable || grantedScopes === null) {
    return connectorScopeDiagnosticsSchema.parse({
      status: policy.notApplicable ? "not_applicable" : "unknown",
      policyVersion: policy.version,
      requiredScopes,
      grantedScopes: [],
      missingScopes: [],
      excessScopes: [],
      warnings: policy.notApplicable ? [] : ["introspection_unavailable"],
      checkedAt,
    });
  }
  const discovered = [...new Set(grantedScopes)].sort();
  const missingScopes = requiredScopes.filter(
    (scope) => !discovered.includes(scope),
  );
  const excessScopes = discovered.filter(
    (scope) => !policy.allowedScopes.includes(scope),
  );
  return connectorScopeDiagnosticsSchema.parse({
    status: "known",
    policyVersion: policy.version,
    requiredScopes,
    grantedScopes: discovered,
    missingScopes,
    excessScopes,
    warnings: [
      ...(missingScopes.length ? ["missing_required_scope"] : []),
      ...(excessScopes.length ? ["excess_privileges"] : []),
    ],
    checkedAt,
  });
}

export function safeConnectorTestDiagnostic(
  category: string,
  checkedAt: string | null,
): ConnectorTestDiagnostic {
  const safeCategory = Object.hasOwn(CONNECTOR_TEST_MESSAGES, category)
    ? (category as keyof typeof CONNECTOR_TEST_MESSAGES)
    : "unknown";
  return connectorTestDiagnosticSchema.parse({
    category: safeCategory,
    message: CONNECTOR_TEST_MESSAGES[safeCategory],
    checkedAt,
  });
}
