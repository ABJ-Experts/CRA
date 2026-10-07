import type { SiemEventClass } from "@repo/contracts/audit/types";
/** Closed pairs observed in existing transactional audit producers. New producers require explicit review. */
export const SIEM_EVENT_REGISTRY = [
  {
    resourceType: "audit_search",
    action: "audit.search.created",
    eventClass: "audit_access",
  },
  {
    resourceType: "audit_search",
    action: "audit.search.denied",
    eventClass: "audit_access",
  },
  {
    resourceType: "connector",
    action: "connector.archived",
    eventClass: "integrations",
  },
  {
    resourceType: "connector",
    action: "connector.created",
    eventClass: "integrations",
  },
  {
    resourceType: "connector",
    action: "connector.field_mapping_saved",
    eventClass: "integrations",
  },
  {
    resourceType: "connector",
    action: "connector.key_rewrapped",
    eventClass: "integrations",
  },
  {
    resourceType: "connector",
    action: "connector.secret_rotated",
    eventClass: "integrations",
  },
  {
    resourceType: "connector",
    action: "connector.test_interrupted",
    eventClass: "integrations",
  },
  {
    resourceType: "connector",
    action: "connector.test_started",
    eventClass: "integrations",
  },
  {
    resourceType: "connector",
    action: "connector.tested",
    eventClass: "integrations",
  },
  {
    resourceType: "connector",
    action: "connector.updated",
    eventClass: "integrations",
  },
  {
    resourceType: "evidence_document_version",
    action: "evidence.access_authorized",
    eventClass: "evidence",
  },
  {
    resourceType: "evidence_document_version",
    action: "evidence.access_expired",
    eventClass: "evidence",
  },
  {
    resourceType: "evidence_document_version",
    action: "evidence.byte_delivery_started",
    eventClass: "evidence",
  },
  {
    resourceType: "evidence_document_version",
    action: "evidence.download_requested",
    eventClass: "evidence",
  },
  {
    resourceType: "evidence_document_version",
    action: "evidence.extraction_retry_requested",
    eventClass: "evidence",
  },
  {
    resourceType: "evidence_document_version",
    action: "evidence.integrity_failure",
    eventClass: "evidence",
  },
  {
    resourceType: "evidence_document_version",
    action: "evidence.replacement_reserved",
    eventClass: "evidence",
  },
  {
    resourceType: "evidence_document_version",
    action: "evidence.scan_completed",
    eventClass: "evidence",
  },
  {
    resourceType: "evidence_document_version",
    action: "evidence.upload_completed",
    eventClass: "evidence",
  },
  {
    resourceType: "evidence_document_version",
    action: "evidence.upload_reserved",
    eventClass: "evidence",
  },
  {
    resourceType: "framework_pack_version",
    action: "framework.pack_imported",
    eventClass: "frameworks",
  },
  {
    resourceType: "framework_pack_version",
    action: "framework.pack_provenance_corrected",
    eventClass: "frameworks",
  },
  {
    resourceType: "invitation",
    action: "invitation.accepted",
    eventClass: "access_control",
  },
  {
    resourceType: "invitation",
    action: "invitation.created",
    eventClass: "access_control",
  },
  {
    resourceType: "invitation",
    action: "invitation.delivery_cancelled",
    eventClass: "access_control",
  },
  {
    resourceType: "invitation",
    action: "invitation.delivery_confirmed",
    eventClass: "access_control",
  },
  {
    resourceType: "invitation",
    action: "invitation.resent",
    eventClass: "access_control",
  },
  {
    resourceType: "invitation",
    action: "invitation.revoked",
    eventClass: "access_control",
  },
  {
    resourceType: "organization",
    action: "organization.created",
    eventClass: "organization",
  },
  {
    resourceType: "organization",
    action: "organization.creation_rejected",
    eventClass: "organization",
  },
  {
    resourceType: "organization",
    action: "organization.switched",
    eventClass: "organization",
  },
  {
    resourceType: "organization_branding_draft",
    action: "organization.branding_draft_logo_selected",
    eventClass: "organization",
  },
  {
    resourceType: "organization_branding_draft",
    action: "organization.branding_draft_updated",
    eventClass: "organization",
  },
  {
    resourceType: "organization_legal_entity",
    action: "organization.legal_entity_backfilled",
    eventClass: "organization",
  },
  {
    resourceType: "organization_legal_entity",
    action: "organization.legal_entity_created",
    eventClass: "organization",
  },
  {
    resourceType: "organization_legal_entity",
    action: "organization.legal_entity_dependencies_reconciled",
    eventClass: "organization",
  },
  {
    resourceType: "organization_legal_entity",
    action: "organization.legal_entity_lifecycle_changed",
    eventClass: "organization",
  },
  {
    resourceType: "organization_legal_entity",
    action: "organization.legal_entity_updated",
    eventClass: "organization",
  },
  {
    resourceType: "organization_onboarding_stage",
    action: "onboarding.stage_completed",
    eventClass: "organization",
  },
  {
    resourceType: "product",
    action: "product.archived",
    eventClass: "products",
  },
  {
    resourceType: "product",
    action: "product.classification_saved",
    eventClass: "products",
  },
  {
    resourceType: "product",
    action: "product.created",
    eventClass: "products",
  },
  {
    resourceType: "product",
    action: "product.legal_entity_assigned",
    eventClass: "products",
  },
  {
    resourceType: "product",
    action: "product.relationship_reevaluation_requested",
    eventClass: "products",
  },
  {
    resourceType: "product",
    action: "product.retention_recalculated",
    eventClass: "products",
  },
  {
    resourceType: "product",
    action: "product.updated",
    eventClass: "products",
  },
  {
    resourceType: "product_release",
    action: "product.release_archived",
    eventClass: "products",
  },
  {
    resourceType: "product_release",
    action: "product.release_created",
    eventClass: "products",
  },
  {
    resourceType: "product_release",
    action: "product.release_legal_entity_snapshot_backfilled",
    eventClass: "products",
  },
  {
    resourceType: "product_release",
    action: "product.release_lifecycle_transitioned",
    eventClass: "products",
  },
  {
    resourceType: "product_release",
    action: "product.release_market_availability_added",
    eventClass: "products",
  },
  {
    resourceType: "product_release",
    action: "product.release_market_availability_corrected",
    eventClass: "products",
  },
  {
    resourceType: "product_release",
    action: "product.release_market_availability_removed",
    eventClass: "products",
  },
  {
    resourceType: "product_release",
    action: "product.release_placed_on_market_date_corrected",
    eventClass: "products",
  },
  {
    resourceType: "product_release",
    action: "product.release_updated",
    eventClass: "products",
  },
  {
    resourceType: "reporting_obligation",
    action: "reporting.anchor_corrected.high",
    eventClass: "reporting",
  },
  {
    resourceType: "reporting_obligation",
    action: "reporting.obligation_cancelled.high",
    eventClass: "reporting",
  },
  {
    resourceType: "reporting_obligation",
    action: "reporting.obligation_created",
    eventClass: "reporting",
  },
  {
    resourceType: "reporting_obligation",
    action: "reporting.rehearsal_created",
    eventClass: "reporting",
  },
  {
    resourceType: "reporting_obligation",
    action: "reporting.rehearsal_replayed",
    eventClass: "reporting",
  },
  {
    resourceType: "reporting_obligation",
    action: "reporting.stage_overdue.high",
    eventClass: "reporting",
  },
  {
    resourceType: "reporting_obligation",
    action: "reporting.stage_submitted",
    eventClass: "reporting",
  },
  {
    resourceType: "sbom_document",
    action: "sbom.normalization_completed",
    eventClass: "sboms",
  },
  {
    resourceType: "sbom_ingest_job",
    action: "sbom.job_failed",
    eventClass: "sboms",
  },
  {
    resourceType: "sbom_ingest_job",
    action: "sbom.job_queued",
    eventClass: "sboms",
  },
  {
    resourceType: "sbom_ingest_job",
    action: "sbom.job_replayed",
    eventClass: "sboms",
  },
  {
    resourceType: "sbom_ingest_job",
    action: "sbom.validation_recorded",
    eventClass: "sboms",
  },
  {
    resourceType: "sbom_supplier_request",
    action: "sbom.supplier_request_created",
    eventClass: "sboms",
  },
  {
    resourceType: "sbom_supplier_request",
    action: "supplier.request_associated",
    eventClass: "sboms",
  },
  {
    resourceType: "sbom_supplier_submission",
    action: "sbom.supplier_submission_queued",
    eventClass: "sboms",
  },
  {
    resourceType: "sbom_supplier_submission",
    action: "sbom.supplier_submission_reserved",
    eventClass: "sboms",
  },
  {
    resourceType: "supplier_contact",
    action: "supplier.contact_archived",
    eventClass: "suppliers",
  },
  {
    resourceType: "supplier_contact",
    action: "supplier.contact_created",
    eventClass: "suppliers",
  },
  {
    resourceType: "supplier_contact",
    action: "supplier.contact_updated",
    eventClass: "suppliers",
  },
  {
    resourceType: "supplier_document_field",
    action: "supplier.document_field_manual",
    eventClass: "suppliers",
  },
  {
    resourceType: "supplier_evidence_invitation",
    action: "supplier.evidence_invitation_revoked",
    eventClass: "suppliers",
  },
  {
    resourceType: "supplier_evidence_request",
    action: "supplier.evidence_request_closed",
    eventClass: "suppliers",
  },
  {
    resourceType: "supplier_evidence_request",
    action: "supplier.evidence_request_created",
    eventClass: "suppliers",
  },
  {
    resourceType: "supplier_evidence_request",
    action: "supplier.evidence_request_re_requested",
    eventClass: "suppliers",
  },
  {
    resourceType: "supplier_evidence_request",
    action: "supplier.evidence_request_revised",
    eventClass: "suppliers",
  },
  {
    resourceType: "supplier_evidence_submission",
    action: "supplier.evidence_submission_failed",
    eventClass: "suppliers",
  },
  {
    resourceType: "supplier_evidence_submission",
    action: "supplier.evidence_submission_reserved",
    eventClass: "suppliers",
  },
  {
    resourceType: "supplier_evidence_submission_review",
    action: "supplier.evidence_submission_reviewed",
    eventClass: "suppliers",
  },
  {
    resourceType: "supplier_organization",
    action: "supplier.archived",
    eventClass: "suppliers",
  },
  {
    resourceType: "supplier_organization",
    action: "supplier.created",
    eventClass: "suppliers",
  },
  {
    resourceType: "supplier_organization",
    action: "supplier.updated",
    eventClass: "suppliers",
  },
  {
    resourceType: "technical_file",
    action: "technical_file.created",
    eventClass: "technical_files",
  },
  {
    resourceType: "technical_file",
    action: "technical_file.readiness_recalculated",
    eventClass: "technical_files",
  },
  {
    resourceType: "technical_file_auditor_snapshot_grant",
    action: "technical_file.auditor_grant_created",
    eventClass: "technical_files",
  },
  {
    resourceType: "technical_file_auditor_snapshot_grant",
    action: "technical_file.auditor_grant_revoked",
    eventClass: "technical_files",
  },
  {
    resourceType: "technical_file_declaration",
    action: "technical_file.declaration_downloaded",
    eventClass: "technical_files",
  },
  {
    resourceType: "technical_file_declaration",
    action: "technical_file.declaration_draft_saved",
    eventClass: "technical_files",
  },
  {
    resourceType: "technical_file_declaration",
    action: "technical_file.declaration_failed",
    eventClass: "technical_files",
  },
  {
    resourceType: "technical_file_declaration",
    action: "technical_file.declaration_issuance_prepared",
    eventClass: "technical_files",
  },
  {
    resourceType: "technical_file_declaration",
    action: "technical_file.declaration_issued",
    eventClass: "technical_files",
  },
  {
    resourceType: "technical_file_declaration",
    action: "technical_file.declaration_reissued",
    eventClass: "technical_files",
  },
  {
    resourceType: "technical_file_section",
    action: "technical_file.section_updated",
    eventClass: "technical_files",
  },
  {
    resourceType: "technical_file_section_source",
    action: "technical_file.source_linked",
    eventClass: "technical_files",
  },
  {
    resourceType: "technical_file_section_source",
    action: "technical_file.source_marked_stale",
    eventClass: "technical_files",
  },
  {
    resourceType: "technical_file_section_source",
    action: "technical_file.source_reviewed",
    eventClass: "technical_files",
  },
  {
    resourceType: "technical_file_section_source",
    action: "technical_file.source_unlinked",
    eventClass: "technical_files",
  },
  {
    resourceType: "technical_file_snapshot",
    action: "technical_file.snapshot_created",
    eventClass: "technical_files",
  },
  {
    resourceType: "technical_file_snapshot_export",
    action: "technical_file.snapshot_export_cancelled",
    eventClass: "technical_files",
  },
  {
    resourceType: "technical_file_snapshot_export",
    action: "technical_file.snapshot_export_downloaded",
    eventClass: "technical_files",
  },
  {
    resourceType: "technical_file_snapshot_export",
    action: "technical_file.snapshot_export_failed",
    eventClass: "technical_files",
  },
  {
    resourceType: "technical_file_snapshot_export",
    action: "technical_file.snapshot_export_ready",
    eventClass: "technical_files",
  },
  {
    resourceType: "technical_file_snapshot_export",
    action: "technical_file.snapshot_export_requested",
    eventClass: "technical_files",
  },
  {
    resourceType: "user",
    action: "auth.email_verification_changed",
    eventClass: "access_control",
  },
  {
    resourceType: "user",
    action: "auth.session_revoked",
    eventClass: "access_control",
  },
  {
    resourceType: "user",
    action: "mfa.recovery_code_used",
    eventClass: "access_control",
  },
  {
    resourceType: "user",
    action: "user.profile_updated",
    eventClass: "access_control",
  },
  {
    resourceType: "vulnerability_finding",
    action: "vulnerability.component_reintroduced",
    eventClass: "findings",
  },
  {
    resourceType: "vulnerability_finding",
    action: "vulnerability.finding_human_verdict_recorded",
    eventClass: "findings",
  },
  {
    resourceType: "vulnerability_finding",
    action: "vulnerability.triage_assignee_changed",
    eventClass: "findings",
  },
  {
    resourceType: "vulnerability_match_job",
    action: "vulnerability.match_page_persisted",
    eventClass: "findings",
  },
  {
    resourceType: "vulnerability_match_job",
    action: "vulnerability.match_queued",
    eventClass: "findings",
  },
  {
    resourceType: "vulnerability_reevaluation_job",
    action: "vulnerability.csaf_reevaluation_provenance_applied",
    eventClass: "findings",
  },
  {
    resourceType: "vulnerability_reevaluation_job",
    action: "vulnerability.reevaluation_discovery_failed",
    eventClass: "findings",
  },
  {
    resourceType: "vulnerability_reevaluation_job",
    action: "vulnerability.reevaluation_discovery_page_persisted",
    eventClass: "findings",
  },
  {
    resourceType: "vulnerability_reevaluation_job",
    action: "vulnerability.reevaluation_discovery_queued",
    eventClass: "findings",
  },
  {
    resourceType: "vulnerability_reevaluation_job",
    action: "vulnerability.reevaluation_failed",
    eventClass: "findings",
  },
] as const satisfies readonly {
  resourceType: string;
  action: string;
  eventClass: SiemEventClass;
}[];
