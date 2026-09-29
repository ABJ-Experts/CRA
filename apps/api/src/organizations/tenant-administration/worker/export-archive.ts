import { createHash } from "node:crypto";

export type ExportSourceRegistration = Readonly<{
  sourceId: string;
  tables: readonly string[];
}>;

/**
 * A source is intentionally one NDJSON part. New tenant tables must be added
 * here or appear in `exportSourceExclusions` with a security rationale.
 */
export const exportSourceRegistry: readonly ExportSourceRegistration[] =
  Object.freeze([
    {
      sourceId: "organization_profile",
      tables: ["organizations", "organization_legal_profiles"],
    },
    { sourceId: "memberships", tables: ["organization_members"] },
    { sourceId: "audit_logs", tables: ["audit_logs"] },
    {
      // The active organization choice is portable tenant state. Versioned
      // legal text remains a global deployment asset; its stable keys travel
      // in this row, while selection history travels in audit_logs.
      sourceId: "framework_selections",
      tables: ["organization_framework_selections"],
    },
    {
      // Control revisions, exact links, and product applicability decisions
      // are durable tenant facts. Derived coverage projections are excluded.
      // Owned custom drafts and published content are tenant facts; SQL
      // selects only rows with the exporting organization's ownership key.
      // Global pack content remains a deployment asset. Evidence bytes remain
      // under the M8 evidence export and retention boundary.
      sourceId: "framework_controls",
      tables: [
        "framework_controls",
        "framework_control_revisions",
        "framework_control_evidence_links",
        "framework_control_requirement_mappings",
        "framework_control_mapping_products",
        "framework_requirement_applicability",
        "framework_upgrade_reviews",
        "framework_upgrade_decisions",
        "framework_custom_pack_drafts",
        "framework_pack_versions",
        "framework_requirements",
      ],
    },
    { sourceId: "invitations", tables: ["invitations"] },
    { sourceId: "custom_roles", tables: ["custom_roles"] },
    {
      sourceId: "base_role_permission_overrides",
      tables: ["base_role_permission_overrides"],
    },
    { sourceId: "menu_permissions", tables: ["menu_permissions"] },
    { sourceId: "user_role_assignments", tables: ["user_role_assignments"] },
    { sourceId: "user_table_preferences", tables: ["user_table_preferences"] },
    {
      sourceId: "organization_onboarding",
      tables: ["organization_onboarding"],
    },
    {
      sourceId: "organization_onboarding_stages",
      tables: ["organization_onboarding_stages"],
    },
    {
      sourceId: "organization_onboarding_evidence",
      tables: ["organization_onboarding_evidence"],
    },
    { sourceId: "organization_settings", tables: ["organization_settings"] },
    {
      sourceId: "organization_lifecycles",
      tables: ["organization_lifecycles"],
    },
    {
      sourceId: "organization_retention_policies",
      tables: ["organization_retention_policies"],
    },
    {
      sourceId: "retention_authority_states",
      tables: ["retention_authority_states"],
    },
    {
      sourceId: "retention_authoritative_facts",
      tables: ["retention_authoritative_facts"],
    },
    {
      sourceId: "retention_floor_snapshots",
      tables: ["retention_floor_snapshots"],
    },
    {
      sourceId: "retention_floor_reasons",
      tables: ["retention_floor_reasons"],
    },
    {
      sourceId: "evidence_protection_watermarks",
      tables: ["evidence_protection_watermarks"],
    },
    { sourceId: "retention_cleanup_runs", tables: ["retention_cleanup_runs"] },
    {
      sourceId: "retention_cleanup_items",
      tables: ["retention_cleanup_items"],
    },
    {
      sourceId: "organization_export_jobs",
      tables: ["organization_export_jobs"],
    },
    {
      sourceId: "organization_export_parts",
      tables: ["organization_export_parts"],
    },
    {
      sourceId: "organization_export_snapshots",
      tables: ["organization_export_snapshots"],
    },
    {
      sourceId: "organization_purge_jobs",
      tables: ["organization_purge_jobs"],
    },
    {
      sourceId: "organization_purge_work_items",
      tables: ["organization_purge_work_items"],
    },
    {
      sourceId: "organization_permissions_version",
      tables: ["organization_permissions_version"],
    },
    {
      sourceId: "organization_branding",
      tables: [
        "organization_branding_drafts",
        "organization_branding_assets",
        "organization_branding_versions",
      ],
    },
    {
      sourceId: "legal_entities",
      tables: [
        "organization_legal_entities",
        "organization_legal_entity_dependency_authorities",
        "organization_legal_entity_dependency_facts",
      ],
    },
    {
      sourceId: "product_registry",
      tables: [
        "products",
        "product_releases",
        "product_legal_entity_assignments",
        "product_lifecycle_dependency_facts",
        "product_release_market_availability",
        "product_regulatory_outbox_events",
        "product_support_periods",
        "software_baselines",
        "software_baseline_release_memberships",
        "product_relationships",
        "product_import_jobs",
        "product_import_rows",
        "product_substantial_modification_assessments",
        "product_substantial_modification_releases",
        "product_security_update_artifacts",
        "product_classification_runs",
      ],
    },
    {
      sourceId: "finding_propagation",
      tables: [
        "finding_propagation_sources",
        "finding_impact_associations",
        "finding_product_impact_overrides",
        "finding_propagation_jobs",
      ],
    },
    {
      sourceId: "connector_sync",
      tables: [
        "connectors",
        "product_external_identities",
        "field_authority_policies",
        "sync_runs",
        "sync_run_plan_items",
        "sync_conflicts",
        "sync_connector_cursors",
      ],
    },
    {
      sourceId: "sbom_normalized_graph",
      tables: [
        "sbom_documents",
        "sbom_document_sources",
        "sbom_components",
        "sbom_component_identities",
        "sbom_component_dependencies",
        "organization_sbom_quality_settings",
        "sbom_quality_reports",
        "sbom_quality_findings",
        "sbom_diff_reports",
        "sbom_diff_component_changes",
      ],
    },
    {
      // Supplier request and composite review facts are durable compliance
      // evidence. Invitation/session bearer verifiers remain excluded below.
      sourceId: "sbom_composite_supplier_provenance",
      tables: [
        "sbom_supplier_requests",
        "sbom_supplier_submissions",
        "sbom_composite_reviews",
        "sbom_composite_review_inputs",
        "sbom_composite_conflicts",
        "sbom_composite_unresolved_relationships",
        "sbom_composite_component_provenance",
        "sbom_composite_dependency_provenance",
      ],
    },
    {
      // M4-07 evidence and source-state review facts are immutable tenant
      // audit records. They contain hashes and safe metadata only, never raw
      // analyzer artifacts, source paths, or provider credentials.
      sourceId: "vulnerability_reachability_review",
      tables: [
        "vulnerability_reachability_results",
        "vulnerability_finding_review_events",
      ],
    },
    {
      // M5 VEX assessments, their approval-policy snapshots, and the frozen
      // M5-03 bulk-operation/target audit ledger are immutable tenant facts.
      // Request idempotency material remains excluded below.
      sourceId: "vulnerability_vex_assessments",
      tables: [
        "vulnerability_finding_assessments",
        "vulnerability_finding_assessment_evidence_links",
        "vulnerability_finding_assessment_history_events",
        "vulnerability_assessment_approval_policies",
        "vulnerability_finding_assessment_bulk_operations",
        "vulnerability_finding_assessment_bulk_operation_targets",
      ],
    },
    {
      // M5-04 suppression revisions, internal-SLA policy snapshots, current
      // operational responsibility, and bounded delivery evidence are all
      // tenant-owned records. Command idempotency material remains excluded.
      sourceId: "vulnerability_triage_operational",
      tables: [
        "vulnerability_finding_suppressions",
        "vulnerability_triage_sla_policies",
        "vulnerability_finding_triage_states",
        "vulnerability_triage_alert_events",
        "vulnerability_finding_remediation_anchors",
      ],
    },
    {
      // M6-01 reporting obligations freeze applicable deadline rules,
      // anchor transitions, cancellation/submission facts, and breach history
      // as tenant-owned operational records. Request idempotency stays in the
      // existing triage command ledger and remains excluded below.
      sourceId: "reporting_obligations",
      tables: [
        "reporting_obligations",
        "reporting_obligation_stages",
        "reporting_obligation_events",
        "reporting_deadline_alerts",
        "reporting_deadline_alert_deliveries",
        "reporting_stage_drafts",
        "reporting_stage_draft_revisions",
        "reporting_stage_submissions",
        "reporting_family_templates",
        "reporting_family_template_versions",
        "reporting_stage_approvals",
        "reporting_stage_packages",
        "reporting_stage_submission_acknowledgements",
        "reporting_obligation_evidence_packs",
        "reporting_stage_filing_proofs",
      ],
    },
    {
      // M8 evidence records export durable document/version metadata, product
      // bindings, retention protections, and legal holds. Private object
      // locators, request idempotency, extracted text, bearer grants, and
      // active processing jobs remain excluded or table-redacted in SQL.
      sourceId: "evidence_business_records",
      tables: [
        "evidence_documents",
        "evidence_document_versions",
        "evidence_document_version_products",
        "evidence_document_version_retention_protections",
        "evidence_document_legal_holds",
        "evidence_bulk_intake_batches",
        "evidence_bulk_intake_items",
        "evidence_document_version_texts",
        "evidence_document_watermark_exports",
      ],
    },
    {
      // M7 technical-file sources, risks, snapshots, exports, and declaration
      // facts are portable tenant records after SQL table-aware redaction removes
      // generated artifact locators, command digests, and active lease state.
      sourceId: "technical_file_business_records",
      tables: [
        "technical_files",
        "technical_file_sections",
        "technical_file_section_sources",
        "technical_file_section_source_reviews",
        "technical_file_risk_registers",
        "technical_file_risks",
        "technical_file_risk_revisions",
        "technical_file_risk_revision_assets",
        "technical_file_risk_revision_evidence",
        "technical_file_risk_revision_requirements",
        "technical_file_snapshots",
        "technical_file_snapshot_exports",
        "technical_file_declarations",
        "technical_file_auditor_access_events",
      ],
    },
    {
      // M9 supplier registry/request/submission/review facts are business
      // records. External invitation bearer material, reminder worker state,
      // command idempotency, and AI lease state remain excluded below.
      sourceId: "supplier_business_records",
      tables: [
        "supplier_organizations",
        "supplier_contacts",
        "supplier_component_responsibilities",
        "supplier_evidence_requests",
        "supplier_evidence_request_revisions",
        "supplier_evidence_request_items",
        "supplier_evidence_submissions",
        "supplier_evidence_submission_reviews",
        "supplier_document_fields",
      ],
    },
    {
      // Vulnerability detection rows are tenant-visible facts tied to exported
      // SBOM/product evidence and global advisory identifiers. Active match job
      // leases remain excluded below; owner-authored manual evidence is retained.
      sourceId: "vulnerability_detection_records",
      tables: [
        "vulnerability_component_occurrences",
        "vulnerability_findings",
        "vulnerability_finding_component_occurrences",
        "vulnerability_match_evaluations",
        "vulnerability_kev_alerts",
        "vulnerability_manual_findings",
      ],
    },
    {
      // Saved triage queues and user defaults are tenant configuration records.
      // Command idempotency ledgers remain excluded below.
      sourceId: "vulnerability_triage_views",
      tables: [
        "vulnerability_triage_saved_views",
        "vulnerability_triage_saved_view_defaults",
      ],
    },
    {
      // M5-07 operational notes retain author/recipient snapshots, immutable
      // revisions, and durable delivery outcomes. They are intentionally not
      // assessment reasons or evidence records.
      sourceId: "vulnerability_triage_notes",
      tables: [
        "vulnerability_finding_notes",
        "vulnerability_finding_note_revisions",
        "vulnerability_finding_note_mentions",
      ],
    },
    {
      // M5-06 immutable export evidence and safe delivery outcomes are
      // tenant-owned facts. Active job leases remain deployment-local below.
      sourceId: "vulnerability_vex_exports",
      tables: [
        "vulnerability_vex_export_snapshots",
        "vulnerability_vex_export_snapshot_assessments",
        "vulnerability_vex_publication_targets",
        "vulnerability_vex_publication_jobs",
        "vulnerability_vex_publication_attempts",
      ],
    },
  ]);

/** Explicit omissions are security objects, never an accidental omission. */
export const exportSourceExclusions: Readonly<Record<string, string>> =
  Object.freeze({
    organization_creation_idempotencies:
      "Idempotency keys are request-security material and are not tenant records.",
    organization_export_idempotencies:
      "Idempotency keys and request digests are request-security material.",
    organization_session_bindings:
      "Contains verified Supabase session identifiers.",
    organization_session_revocations:
      "Contains verified Supabase session identifiers.",
    destructive_reauth_grants:
      "Contains one-use destructive reauthentication grant identifiers and session identifiers.",
    organization_export_source_tables:
      "Global physical-source catalogue, not organization-scoped tenant data.",
    organization_export_snapshot_records:
      "Transient immutable copies of registered sources; exporting them would duplicate and recursively re-export tenant records.",
    organization_export_artifact_snapshots:
      "Internal export copy ledger; the archive includes its source metadata and verified bytes without recursively exporting the ledger.",
    organization_legal_entity_create_idempotencies:
      "Legal entity create idempotency keys and request digests are request-security material.",
    organization_branding_publish_idempotencies:
      "Branding publish idempotency keys and request digests are request-security material.",
    framework_control_commands:
      "Control command idempotency keys and request digests are request-security material, not portable tenant records.",
    framework_coverage_scopes:
      "Derived coverage status, generation, and worker lease state are recalculated from framework, control, applicability, and evidence sources.",
    framework_coverage_rows:
      "Derived per-requirement coverage rows are recalculated from framework, control, applicability, and evidence sources.",
    product_create_idempotencies:
      "Product idempotency keys and request digests are request-security material.",
    product_release_create_idempotencies:
      "Release idempotency keys and request digests are request-security material.",
    software_baseline_lifecycle_dependency_facts:
      "Historical M2 projection copied into product_lifecycle_dependency_facts and dropped by the forward consolidation migration.",
    connector_commands:
      "Security command fingerprints and internal replay state are not portable tenant business records.",
    connector_secrets:
      "Ciphertext-encrypted connector credential material, not portable tenant record data.",
    sbom_ci_credentials:
      "Contains salted CI credential verifiers and token identifiers; credential-security material is never exported.",
    sbom_raw_objects:
      "References private immutable evidence objects; exporting this security-sensitive locator without its authorized retrieval workflow is unsafe.",
    sbom_sources:
      "Contains unverified staging-object locations and upload reservation metadata; export must not disclose security-sensitive upload state.",
    sbom_ingest_jobs:
      "Contains active worker leases and retry state; exporting operational security state would make a restored job ambiguous.",
    sbom_supplier_invitations:
      "Contains invitation and scoped-upload bearer token hashes; request lifecycle evidence is exported without credential-security material.",
    ai_inference_runs:
      "M9-05 run rows contain idempotency keys and active worker lease state. Confirmed supplier field facts export separately without replayable AI worker state.",
    vulnerability_match_jobs:
      "Active lease, retry, and checkpoint state is deployment-local operational state; restoring it from a tenant archive would replay work against a different immutable mirror snapshot.",
    vulnerability_reevaluation_jobs:
      "Active advisory re-evaluation leases, retry state, and checkpoints are deployment-local operational state; restoring them from a tenant archive would replay work against a different immutable mirror snapshot.",
    vulnerability_manual_finding_commands:
      "Idempotency keys and request digests are request-security material.",
    vulnerability_triage_saved_view_commands:
      "Idempotency keys and request digests are request-security material.",
    vulnerability_finding_assessment_commands:
      "Idempotency keys and request digests are request-security material.",
    vulnerability_triage_commands:
      "Idempotency keys and request digests are request-security material.",
    // M6-M9 exclusions below are limited to credentials, bearer grants,
    // idempotency ledgers, active worker state, destructive workflows, raw text,
    // private storage locators, or artifacts without a reviewed export boundary.
    reporting_stage_approval_proofs:
      "Contains reauthentication proof and session-bound authorization material that must never be copied into a tenant archive.",
    reporting_stage_draft_commands:
      "Draft command idempotency keys and request digests are request-security material.",
    evidence_bulk_intake_attempts:
      "Bulk intake attempts contain retry and upload state that is deployment-local worker security material.",
    evidence_document_access_grants:
      "Contains scoped access grants and token verifiers; bearer authorization material must never be archived.",
    evidence_document_deletion_cleanup_items:
      "Deletion cleanup items carry active worker and storage cleanup state that cannot be restored safely.",
    evidence_document_deletion_intents:
      "Deletion intents are active destructive workflow security state; replaying them from an archive could bypass current retention checks.",
    evidence_document_extraction_jobs:
      "Extraction jobs contain active worker lease and retry state; only completed text and immutable source bytes could be portable.",
    evidence_document_notification_outbox:
      "Notification outbox rows contain worker delivery and retry state that cannot be replayed safely after restore.",
    evidence_document_scan_jobs:
      "Scan jobs contain active worker lease and quarantine state tied to private storage objects.",
    evidence_document_watermark_export_access_grants:
      "Contains scoped watermark download grants and token verifiers; bearer authorization material must never be archived.",
    supplier_evidence_invitations:
      "Contains external invitation and session token verifiers; bearer authorization material must never be archived.",
    supplier_evidence_reminder_deliveries:
      "Reminder delivery rows contain external notification worker and retry state that cannot be replayed safely after restore.",
    supplier_evidence_request_commands:
      "Supplier request command idempotency keys and request digests are request-security material.",
    supplier_registry_commands:
      "Supplier registry command idempotency keys and request digests are request-security material.",
    technical_file_auditor_snapshot_grants:
      "Contains scoped auditor bearer grants and token verifiers that must never be copied into a tenant archive.",
    technical_file_risk_commands:
      "Risk command idempotency keys and request digests are request-security material.",
  });

const crcTable = (() => {
  const entries = new Uint32Array(256);
  for (let index = 0; index < entries.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
    entries[index] = value >>> 0;
  }
  return entries;
})();

const crc32 = (bytes: Buffer): number => {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = (value >>> 8) ^ (crcTable[(value ^ byte) & 0xff] ?? 0);
  }
  return (value ^ 0xffffffff) >>> 0;
};

const u16 = (value: number): Buffer => {
  const output = Buffer.allocUnsafe(2);
  output.writeUInt16LE(value, 0);
  return output;
};

const u32 = (value: number): Buffer => {
  const output = Buffer.allocUnsafe(4);
  output.writeUInt32LE(value >>> 0, 0);
  return output;
};

export type ArchiveFile = Readonly<{ path: string; bytes: Buffer }>;
export type ArchivedFile = Readonly<{
  path: string;
  byteSize: number;
  sha256: string;
}>;

export type StoredZip = Readonly<{
  bytes: Buffer;
  sha256: string;
  files: readonly ArchivedFile[];
}>;

const validArchivePath = (path: string): boolean =>
  /^(?:[a-z0-9][a-z0-9._-]*\/)*[a-z0-9][a-z0-9._-]*$/i.test(path) &&
  !path.includes("..") &&
  Buffer.byteLength(path, "utf8") <= 512;

/**
 * Minimal deterministic ZIP writer using STORE (no compression). Its small
 * surface avoids a worker-only dependency and makes hashes cover exact bytes.
 */
export const buildStoredZip = (files: readonly ArchiveFile[]): StoredZip => {
  const ordered = [...files].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  const seen = new Set<string>();
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  const exported: ArchivedFile[] = [];
  let offset = 0;

  for (const file of ordered) {
    if (!validArchivePath(file.path)) throw new Error("unsafe archive path");
    if (seen.has(file.path)) throw new Error("duplicate archive path");
    seen.add(file.path);
    const path = Buffer.from(file.path, "utf8");
    const checksum = crc32(file.bytes);
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(checksum),
      u32(file.bytes.length),
      u32(file.bytes.length),
      u16(path.length),
      u16(0),
      path,
      file.bytes,
    ]);
    const central = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(checksum),
      u32(file.bytes.length),
      u32(file.bytes.length),
      u16(path.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      path,
    ]);
    localParts.push(local);
    centralParts.push(central);
    exported.push(
      Object.freeze({
        path: file.path,
        byteSize: file.bytes.length,
        sha256: createHash("sha256").update(file.bytes).digest("hex"),
      }),
    );
    offset += local.length;
  }

  const central = Buffer.concat(centralParts);
  const bytes = Buffer.concat([
    ...localParts,
    central,
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(ordered.length),
    u16(ordered.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ]);
  return Object.freeze({
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    files: Object.freeze(exported),
  });
};

export const validateExportRegistryCoverage = (
  tenantScopedTables: readonly string[],
): void => {
  const covered = new Set(
    exportSourceRegistry.flatMap((entry) => entry.tables),
  );
  const missing = tenantScopedTables.filter(
    (table) => !covered.has(table) && !(table in exportSourceExclusions),
  );
  if (missing.length > 0) {
    throw new Error(`Tenant export registry is missing: ${missing.join(", ")}`);
  }
};

export type ExportCapacityProfile = Readonly<{
  sourceCount: number;
  averagePartBytes: number;
  uploadBytesPerSecond: number;
  partOverheadMs: number;
  retryRate: number;
  maxAttempts: number;
  maximumArchiveBytes: number;
}>;

export const simulateExportCapacity = (
  profile: ExportCapacityProfile,
): Readonly<{
  estimatedMs: number;
  estimatedArchiveBytes: number;
  fitsArchiveLimit: boolean;
  meetsTarget: boolean;
  resumeParts: number;
}> => {
  if (
    !Number.isInteger(profile.sourceCount) ||
    profile.sourceCount < 1 ||
    profile.averagePartBytes < 0 ||
    profile.uploadBytesPerSecond <= 0 ||
    profile.partOverheadMs < 0 ||
    profile.retryRate < 0 ||
    profile.retryRate >= 1 ||
    !Number.isInteger(profile.maxAttempts) ||
    profile.maxAttempts < 1 ||
    !Number.isSafeInteger(profile.maximumArchiveBytes) ||
    profile.maximumArchiveBytes < 1
  ) {
    throw new Error("invalid export capacity profile");
  }
  const basePartMs =
    (profile.averagePartBytes / profile.uploadBytesPerSecond) * 1000 +
    profile.partOverheadMs;
  const expectedAttempts = Math.min(
    profile.maxAttempts,
    1 / (1 - profile.retryRate),
  );
  const estimatedMs = Math.ceil(
    profile.sourceCount * basePartMs * expectedAttempts,
  );
  // One STORE ZIP contains all checkpointed source parts plus a small manifest
  // and ZIP directory. The runtime preflight remains authoritative; capacity
  // planning must reject a representative tenant the current packager cannot
  // hold, even if its transfer time is under 24 hours.
  const estimatedArchiveBytes =
    profile.sourceCount * profile.averagePartBytes + profile.sourceCount * 1024;
  const fitsArchiveLimit =
    Number.isSafeInteger(estimatedArchiveBytes) &&
    estimatedArchiveBytes <= profile.maximumArchiveBytes;
  return Object.freeze({
    estimatedMs,
    estimatedArchiveBytes,
    fitsArchiveLimit,
    meetsTarget: fitsArchiveLimit && estimatedMs <= 24 * 60 * 60 * 1000,
    resumeParts: profile.sourceCount,
  });
};
