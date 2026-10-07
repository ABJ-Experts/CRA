import {
  hasPermission,
  type PermissionKey,
  type PermissionSet,
} from "@repo/contracts/permissions";

import type { AuditSearchFilters } from "@repo/contracts/audit/types";

const SOURCE_PERMISSIONS = {
  ai_inference_run: ["can_view_suppliers", "can_view_evidence"],
  audit_chain: "can_view_audit",
  audit_export: "can_view_audit",
  audit_search: "can_view_audit",
  audit_search_denial: "can_view_audit",
  auth_security: "can_view_audit",
  auth_recovery_tokens: "can_view_audit",
  auth_mfa_recovery_codes: "can_view_audit",
  auth_login_attempts: "can_view_audit",
  auth_email_verifications: "can_view_audit",
  connector: "can_view_connectors",
  custom_role: "can_view_roles",
  evidence_document_version: "can_view_evidence",
  framework_custom_pack_command: "can_view_frameworks",
  framework_pack_version: "can_view_frameworks",
  framework_selection: "can_view_frameworks",
  invitation: "can_view_invitations",
  notification_preferences: "can_view_users",
  organization: "can_view_organization",
  organization_branding_draft: "can_view_organization",
  organization_legal_entity: "can_view_organization",
  organization_onboarding_stage: "can_view_organization",
  product: "can_view_products",
  product_release: "can_view_products",
  reporting_submission: "can_view_reporting",
  reporting_obligation: "can_view_reporting",
  sbom_document: "can_view_sboms",
  sbom_ingest_job: "can_view_sboms",
  sbom_supplier_request: "can_view_sboms",
  sbom_supplier_submission: "can_view_sboms",
  supplier_contact: "can_view_suppliers",
  supplier_document_field: "can_view_suppliers",
  supplier_evidence_invitation: "can_view_suppliers",
  supplier_evidence_request: "can_view_suppliers",
  supplier_evidence_submission: "can_view_suppliers",
  supplier_evidence_submission_review: "can_view_suppliers",
  supplier_organization: "can_view_suppliers",
  technical_file: "can_view_technical_files",
  technical_file_auditor_snapshot_grant: "can_view_technical_files",
  technical_file_declaration: "can_view_technical_files",
  technical_file_section: "can_view_technical_files",
  technical_file_section_source: "can_view_technical_files",
  technical_file_snapshot: "can_view_technical_files",
  technical_file_snapshot_export: "can_view_technical_files",
  user: "can_view_users",
  vulnerability_match_job: "can_view_findings",
  vulnerability_finding: "can_view_findings",
  vulnerability_reevaluation_job: "can_view_findings",
  workflow_out_of_office: "can_view_users",
} as const satisfies Record<string, PermissionKey | readonly PermissionKey[]>;

const SOURCE_PERMISSION_ENTRIES = Object.entries(SOURCE_PERMISSIONS) as Array<
  [keyof typeof SOURCE_PERMISSIONS, PermissionKey | readonly PermissionKey[]]
>;

export const AUDIT_SOURCE_ENTITY_TYPES = SOURCE_PERMISSION_ENTRIES.map(
  ([entityType]) => entityType,
).sort();

export interface AuditSourcePolicy {
  allowedEntityTypes: readonly string[];
  requestedEntityType: string | null;
}

export function buildAuditSourcePolicy(
  permissions: PermissionSet,
  filters: AuditSearchFilters,
): AuditSourcePolicy {
  const requested = filters.resourceType ?? null;
  const allowedEntityTypes = SOURCE_PERMISSION_ENTRIES.filter(
    ([, permission]) => hasSourcePermission(permissions, permission),
  )
    .map(([entityType]) => entityType)
    .sort();
  if (!requested) return { allowedEntityTypes, requestedEntityType: null };
  return {
    allowedEntityTypes: (allowedEntityTypes as readonly string[]).includes(
      requested,
    )
      ? [requested]
      : [],
    requestedEntityType: requested,
  };
}

function hasSourcePermission(
  permissions: PermissionSet,
  required: PermissionKey | readonly PermissionKey[],
): boolean {
  if (typeof required === "string") return hasPermission(permissions, required);
  return required.every((key: PermissionKey) =>
    hasPermission(permissions, key),
  );
}

export function isKnownAuditSourceEntityType(entityType: string): boolean {
  return Object.prototype.hasOwnProperty.call(SOURCE_PERMISSIONS, entityType);
}
