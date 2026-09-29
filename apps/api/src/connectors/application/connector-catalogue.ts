import type { ConnectorCatalogueEntry } from "@repo/contracts/connectors/types";

export const CONNECTOR_SCOPE_POLICY_VERSION = "2026-09-28.1";

function planned(
  id: ConnectorCatalogueEntry["id"],
  name: string,
  phase: ConnectorCatalogueEntry["phase"],
  priority: ConnectorCatalogueEntry["priority"],
  description: string,
  guidance: string,
): Readonly<ConnectorCatalogueEntry> {
  return Object.freeze({
    id,
    name,
    implementation: "planned",
    phase,
    priority,
    canConfigure: false,
    description,
    guidance,
    scopePolicyVersion: CONNECTOR_SCOPE_POLICY_VERSION,
    requiredScopes: Object.freeze([]) as unknown as string[],
    scopeIntrospection: "unavailable",
  });
}

/** BRD p51 matrix phases; availability reflects registered adapters, not roadmap promises. */
export const CONNECTOR_CATALOGUE: readonly Readonly<ConnectorCatalogueEntry>[] =
  Object.freeze([
    Object.freeze({
      id: "reference_conformance",
      name: "Reference conformance",
      implementation: "reference",
      phase: "V1",
      priority: "P0",
      canConfigure: true,
      description:
        "Deterministic product and release fixtures for adapter conformance. No vendor network connection.",
      guidance:
        "Use disposable fixture credentials only. Scope introspection is not applicable; success validates fixtures rather than a vendor connection.",
      scopePolicyVersion: CONNECTOR_SCOPE_POLICY_VERSION,
      requiredScopes: Object.freeze([]) as unknown as string[],
      scopeIntrospection: "not_applicable",
    }),
    planned(
      "github_actions",
      "GitHub and Actions",
      "MVP",
      "P0",
      "Planned SBOM, release and repository ingestion with findings and build gate verdicts.",
      "Prefer a least-privilege GitHub App limited to selected repositories, not a personal access token. The roadmap names V1; no hub vendor adapter is registered.",
    ),
    planned(
      "gitlab_ci",
      "GitLab CI",
      "V1",
      "P0",
      "Planned SBOM and pipeline metadata ingestion with findings and gate verdicts.",
      "Use a dedicated project token and the minimum project permissions. Self-managed endpoints require approved egress; no hub vendor adapter is registered.",
    ),
    planned(
      "azure_devops",
      "Azure DevOps",
      "V1",
      "P1",
      "Planned SBOM and build metadata ingestion through a service connection.",
      "Restrict the service connection to approved projects and pipelines. The matrix assigns V1; the V1 roadmap bullet does not name this integration.",
    ),
    planned(
      "entra_id",
      "Microsoft Entra ID",
      "V1",
      "P0",
      "Planned SAML identity assertions and groups; SCIM belongs to V2.",
      "Limit identity assertions and group mappings to the approved application. This catalogue does not replace existing identity providers. Matrix V1 scope is SAML; SCIM is V2.",
    ),
    planned(
      "okta",
      "Okta",
      "V1",
      "P0",
      "Planned SAML identity assertions and groups; SCIM belongs to V2.",
      "Limit assertions and groups to the approved application. Matrix V1 scope is SAML; SCIM is V2. No hub-managed identity integration is available.",
    ),
    planned(
      "jira",
      "Jira",
      "V1",
      "P1",
      "Planned remediation ticket creation and status transition ingestion.",
      "Use a dedicated identity restricted to selected projects and necessary ticket permissions. Do not grant site-wide administration.",
    ),
    planned(
      "slack",
      "Slack",
      "V1",
      "P1",
      "Planned alerts, countdown warnings and approval deep links.",
      "Limit bot or webhook access to approved channels. Approval actions must use authenticated application deep links, never chat identity as authorization.",
    ),
    planned(
      "teams",
      "Microsoft Teams",
      "V1",
      "P1",
      "Planned alerts and prompts through a webhook or bot.",
      "Restrict delivery to approved teams and channels. Approval prompts use authenticated application deep links.",
    ),
    planned(
      "smtp",
      "SMTP",
      "MVP",
      "P0",
      "Mail delivery already exists as platform infrastructure; hub-managed SMTP configuration is planned.",
      "Use a dedicated relay identity, transport encryption and restricted sender/recipient policy. Existing MailService configuration remains outside this hub.",
    ),
    planned(
      "s3",
      "S3-compatible object storage",
      "MVP",
      "P0",
      "Artifact storage already exists as platform infrastructure; hub-managed S3 configuration is planned.",
      "Restrict storage identities to the required tenant bucket/prefix and operations. Existing Supabase storage adapters remain outside this hub.",
    ),
    planned(
      "servicenow",
      "ServiceNow",
      "V2",
      "P2",
      "Planned incident/change creation and closure status ingestion through the Table API.",
      "Use a dedicated identity restricted to required tables and operations. Availability follows the integration foundation and approved routing.",
    ),
    planned(
      "teamcenter",
      "Teamcenter",
      "V2",
      "P2",
      "Planned product structure, versions and lifecycle ingestion with compliance status export.",
      "Use explicitly approved on-premises agent routing and a restricted integration identity. Private targets are not globally permitted; no production agent route is available.",
    ),
    planned(
      "windchill",
      "Windchill",
      "V2",
      "P2",
      "Planned product structure, versions and lifecycle ingestion with compliance status export.",
      "Use explicitly approved on-premises agent routing and minimum permissions. This catalogue does not duplicate the existing PLM integration ownership.",
    ),
    planned(
      "siem",
      "SIEM",
      "V2",
      "P2",
      "Planned redacted audit/security event export through syslog or an HTTP collector.",
      "Use a delivery-only identity and approved collector targets. Do not export credentials or unrestricted provider payloads.",
    ),
    planned(
      "enisa",
      "ENISA Single Reporting Platform",
      "V2",
      "P0",
      "Automated staged report delivery and acknowledgements await confirmed official specifications.",
      "Use the existing signed manual export until official specifications and a supported transport are confirmed. No automated hub delivery is claimed.",
    ),
  ]);

export function findConnectorCatalogueEntry(
  id: string,
): Readonly<ConnectorCatalogueEntry> | undefined {
  return CONNECTOR_CATALOGUE.find((entry) => entry.id === id);
}
