import type { ConnectorCatalogueEntry } from "@repo/contracts/connectors/types";

export const CONNECTOR_SCOPE_POLICY_VERSION = "2026-09-28.1";

function ci(
  id: "github_actions" | "gitlab_ci" | "azure_devops",
  name: string,
  phase: "MVP" | "V1",
  priority: "P0" | "P1",
  guidance: string,
  requiredScopes: readonly string[],
): Readonly<ConnectorCatalogueEntry> {
  return Object.freeze({
    id,
    name,
    implementation: "ci",
    phase,
    priority,
    canConfigure: true,
    description:
      "CI build identity and SBOM intake; no product/release synchronization or passing gate policy.",
    guidance,
    scopePolicyVersion: CONNECTOR_SCOPE_POLICY_VERSION,
    requiredScopes: Object.freeze([...requiredScopes]) as unknown as string[],
    scopeIntrospection: "unavailable",
  });
}

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

function ticketing(
  id: "jira",
  name: string,
  phase: "V1",
  priority: "P1",
  description: string,
  guidance: string,
  requiredScopes: readonly string[],
): Readonly<ConnectorCatalogueEntry> {
  return Object.freeze({
    id,
    name,
    implementation: "ticketing",
    phase,
    priority,
    canConfigure: true,
    description,
    guidance,
    scopePolicyVersion: CONNECTOR_SCOPE_POLICY_VERSION,
    requiredScopes: Object.freeze([...requiredScopes]) as unknown as string[],
    scopeIntrospection: "unavailable",
  });
}

/** BRD p51 phases; availability reflects implemented connection boundaries. */
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
    ci(
      "github_actions",
      "GitHub and Actions",
      "MVP",
      "P0",
      "Use a least-privilege GitHub App limited to selected repositories with Actions read, Contents read for release tag proof, and Metadata read; never use a personal access token.",
      ["actions:read", "contents:read", "metadata:read"],
    ),
    ci(
      "gitlab_ci",
      "GitLab CI",
      "V1",
      "P0",
      "Use a dedicated project token and the minimum project permissions. Self-managed hosts require approved egress.",
      ["read_api"],
    ),
    ci(
      "azure_devops",
      "Azure DevOps",
      "V1",
      "P1",
      "Restrict the service connection to approved projects and pipelines. Azure DevOps Services only.",
      ["vso.build"],
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
    ticketing(
      "jira",
      "Jira",
      "V1",
      "P1",
      "Loop-safe remediation ticket creation and status transition ingestion for Jira Cloud.",
      "Use a dedicated Jira Cloud API token with granular REST scopes and restrict the identity to selected projects with Browse, Create, Edit and Transition issue permissions. Do not grant site-wide administration.",
      [
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
    ),
    Object.freeze({
      id: "on_prem_agent",
      name: "On-premises agent",
      implementation: "agent",
      phase: "V2",
      priority: "P2",
      canConfigure: true,
      description:
        "Outbound-only canonical product and release ingestion through a customer-hosted agent.",
      guidance:
        "Use a dedicated read-only source identity and approve only the required files or HTTPS hosts. Source privileges cannot be introspected by CRA; validate customer schemas and review each dry run before commit.",
      scopePolicyVersion: CONNECTOR_SCOPE_POLICY_VERSION,
      requiredScopes: Object.freeze([]) as unknown as string[],
      scopeIntrospection: "unavailable",
    }),
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
      "Use the approved on-premises agent and a restricted integration identity only after validating the customer schema. No turnkey Teamcenter adapter or writeback is available.",
    ),
    planned(
      "windchill",
      "Windchill",
      "V2",
      "P2",
      "Planned product structure, versions and lifecycle ingestion with compliance status export.",
      "Use the approved on-premises agent and minimum read permissions only after validating the customer schema. This catalogue does not duplicate the existing PLM integration ownership or offer writeback.",
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
