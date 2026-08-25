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
      "Artifact metadata and copied bytes remain behind the authoritative artifact snapshot port until its owning domain is bound.",
    organization_legal_entity_create_idempotencies:
      "Legal entity create idempotency keys and request digests are request-security material.",
    organization_branding_publish_idempotencies:
      "Branding publish idempotency keys and request digests are request-security material.",
    product_create_idempotencies:
      "Product idempotency keys and request digests are request-security material.",
    product_release_create_idempotencies:
      "Release idempotency keys and request digests are request-security material.",
    software_baseline_lifecycle_dependency_facts:
      "Historical M2 projection copied into product_lifecycle_dependency_facts and dropped by the forward consolidation migration.",
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
