import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  exportSourceExclusions,
  exportSourceRegistry,
  validateExportRegistryCoverage,
} from "./export-archive";

const migrationsDirectory = resolve(
  __dirname,
  "../../../../../infrastructure/supabase/migrations",
);
const tenantTablesFromMigrations = (): readonly string[] => {
  const tables = new Set<string>(["organizations"]);
  for (const migration of readdirSync(migrationsDirectory).filter((file) =>
    file.endsWith(".sql"),
  )) {
    const sql = readFileSync(resolve(migrationsDirectory, migration), "utf8");
    const tablesInMigration = sql.matchAll(
      /create table(?: if not exists)? public\.([a-z_]+) \(([\s\S]*?)\n\);/g,
    );
    for (const table of tablesInMigration) {
      if (/\borganization_id\b/.test(table[2] ?? ""))
        tables.add(table[1] ?? "");
    }
  }
  return Object.freeze([...tables].filter(Boolean).sort());
};

const migrationSql = (): string =>
  readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((migration) =>
      readFileSync(resolve(migrationsDirectory, migration), "utf8"),
    )
    .join("\n");

const latestMaterializeSnapshotFunctionSql = (): string => {
  const migration = readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .reverse()
    .find((file) =>
      readFileSync(resolve(migrationsDirectory, file), "utf8").includes(
        "function public.materialize_organization_export_snapshot_atomic",
      ),
    );

  if (!migration) {
    throw new Error("missing organization export snapshot materializer");
  }

  return readFileSync(resolve(migrationsDirectory, migration), "utf8");
};

const lockedSnapshotTables = (functionSql: string): readonly string[] => {
  const lockList = functionSql.match(
    /lock table\s+([\s\S]*?)\s+in share mode;/i,
  )?.[1];
  if (!lockList) throw new Error("snapshot materializer has no table lock set");

  return Object.freeze(
    [...lockList.matchAll(/public\.([a-z_]+)/g)]
      .map((match) => match[1])
      .filter((table): table is string => Boolean(table)),
  );
};

const dynamicSnapshotLockAdditions = (sql: string): readonly string[] =>
  Object.freeze(
    [
      ...[
        ...sql.matchAll(
          /(?:v_new(?:_lock)? text := |execute replace\(v_def,v_anchor,)'([^']+)'/g,
        ),
      ].flatMap((match) => [
        ...(match[1] ?? "").matchAll(/public\.([a-z_]+)/g),
      ]),
    ]
      .map((match) => match[1])
      .filter((table): table is string => Boolean(table)),
  );

describe("tenant export source registry architecture", () => {
  it("exports safe connector attempt history with the connector source", () => {
    const connectorSource = exportSourceRegistry.find(
      (source) => source.sourceId === "connector_sync",
    );
    expect(connectorSource?.tables).toContain("sync_run_attempts");
  });
  it("registers webhook metadata and history with the existing connector source", () => {
    const connectorSource = exportSourceRegistry.find(
      (source) => source.sourceId === "connector_sync",
    );
    expect(connectorSource?.tables).toEqual(
      expect.arrayContaining([
        "webhook_endpoints",
        "webhook_endpoint_commands",
        "webhook_deliveries",
        "webhook_delivery_attempts",
      ]),
    );
  });

  it("exports notification preferences and dispatch evidence without digest worker state", () => {
    const notificationSource = exportSourceRegistry.find(
      (source) => source.sourceId === "notification_delivery",
    );
    expect(notificationSource?.tables).toEqual([
      "notification_preferences",
      "notification_dispatches",
    ]);
    expect(exportSourceExclusions.notification_digest_batches).toMatch(
      /lease|worker|replay/i,
    );
  });

  it("redacts webhook credentials, fingerprints, payload bytes and worker state in SQL", () => {
    // Forward migrations patch the existing materializer via quoted SQL.
    const sql = migrationSql().replaceAll("''", "'");
    const projection = (table: string): string => {
      const branch = sql.match(
        new RegExp(
          String.raw`if p_table_name='${table}' then return ([\s\S]*?); end if`,
        ),
      )?.[1];
      expect(branch).toBeDefined();
      return branch ?? "";
    };
    const endpointProjection = projection("webhook_endpoints");
    expect(endpointProjection).toMatch(/^jsonb_build_object\(/);
    const endpointFields = [...endpointProjection.matchAll(/'([a-z_]+)'/g)].map(
      (match) => match[1],
    );
    expect([...new Set(endpointFields)].sort()).toEqual([
      "display_name",
      "enabled",
      "event_types",
      "id",
      "product_ids",
      "version",
    ]);
    const excludedColumns = {
      webhook_endpoint_commands: [
        "idempotency_key",
        "request_digest",
        "request_digest_key_id",
        "result",
        "reason",
      ],
      webhook_deliveries: [
        "payload_bytes",
        "endpoint_url",
        "lease_owner",
        "lease_expires_at",
        "lease_generation",
        "replay_reason",
      ],
      webhook_delivery_attempts: ["worker_id", "lease_generation"],
    };
    for (const [table, columns] of Object.entries(excludedColumns)) {
      const branch = projection(table);
      expect(branch).toMatch(/^v_record\s*-\s*array\[/);
      for (const column of columns) expect(branch).toContain(`'${column}'`);
    }
  });

  it("exports reviewed M6-M9 durable tenant business records", () => {
    const exported = new Set(
      exportSourceRegistry.flatMap((source) => source.tables),
    );

    expect([...exported]).toEqual(
      expect.arrayContaining([
        "reporting_family_templates",
        "reporting_family_template_versions",
        "reporting_stage_drafts",
        "reporting_stage_draft_revisions",
        "reporting_stage_approvals",
        "reporting_stage_packages",
        "reporting_stage_submissions",
        "reporting_stage_submission_acknowledgements",
        "evidence_documents",
        "evidence_document_versions",
        "evidence_document_version_products",
        "evidence_document_version_retention_protections",
        "evidence_document_legal_holds",
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
        "supplier_organizations",
        "supplier_contacts",
        "supplier_component_responsibilities",
        "supplier_evidence_requests",
        "supplier_evidence_request_revisions",
        "supplier_evidence_request_items",
        "supplier_evidence_submissions",
        "supplier_evidence_submission_reviews",
        "supplier_document_fields",
        "vulnerability_component_occurrences",
        "vulnerability_findings",
        "vulnerability_finding_component_occurrences",
        "vulnerability_match_evaluations",
        "vulnerability_kev_alerts",
        "vulnerability_manual_findings",
        "vulnerability_triage_saved_views",
        "vulnerability_triage_saved_view_defaults",
      ]),
    );
  });

  it("exports scoped Jira ticket history without replay and lease material", () => {
    const source = exportSourceRegistry.find(
      (entry) => entry.sourceId === "vulnerability_triage_operational",
    );
    expect(source?.tables).toEqual(
      expect.arrayContaining([
        "vulnerability_remediation_ticket_bindings",
        "vulnerability_remediation_ticket_status_mappings",
        "vulnerability_remediation_tickets",
        "vulnerability_remediation_ticket_operations",
        "vulnerability_remediation_ticket_events",
      ]),
    );
    const sql = migrationSql();
    expect(sql).toMatch(
      /when 'vulnerability_remediation_ticket_operations' then[\s\S]*?'last_error'/,
    );
    expect(sql).toMatch(
      /when 'vulnerability_remediation_tickets' then[\s\S]*?'last_inbound_delivery_id'/,
    );
    expect(sql).toMatch(
      /when 'vulnerability_remediation_ticket_events' then[\s\S]*?'delivery_id'/,
    );
  });

  it("keeps credentials, bearer verifiers, idempotency ledgers, and active leases out of portable sources", () => {
    const exported = new Set(
      exportSourceRegistry.flatMap((source) => source.tables),
    );

    for (const table of [
      "reporting_stage_approval_proofs",
      "reporting_stage_draft_commands",
      "evidence_bulk_intake_attempts",
      "evidence_document_access_grants",
      "evidence_document_deletion_cleanup_items",
      "evidence_document_deletion_intents",
      "evidence_document_extraction_jobs",
      "evidence_document_notification_outbox",
      "evidence_document_scan_jobs",
      "evidence_document_watermark_export_access_grants",
      "supplier_evidence_invitations",
      "supplier_evidence_reminder_deliveries",
      "supplier_evidence_request_commands",
      "supplier_registry_commands",
      "ai_inference_runs",
      "technical_file_auditor_snapshot_grants",
      "technical_file_risk_commands",
      "ci_provider_release_bindings",
      "ci_provider_release_binding_commands",
      "ci_build_runs",
      "ci_provider_webhook_events",
      "workflow_task_groups",
      "workflow_task_group_members",
      "workflow_task_routes",
      "workflow_out_of_office",
      "workflow_task_commands",
    ]) {
      expect(exported.has(table)).toBe(false);
      expect(exportSourceExclusions[table]).toMatch(
        /token|session|bearer|security|idempotency|lease|worker|private|artifact/i,
      );
    }
    expect(exported.has("audit_logs")).toBe(true);

    expect(() =>
      validateExportRegistryCoverage([
        "ai_inference_runs",
        "supplier_evidence_invitations",
        "technical_file_auditor_snapshot_grants",
      ]),
    ).not.toThrow();
  });

  it("routes snapshot rows through table-aware export redaction", () => {
    const sql = migrationSql();

    expect(sql).toContain("m1_export_business_record_jsonb");
    expect(sql).toContain("public.m1_export_business_record_jsonb");
    expect(sql).toMatch(/when 'supplier_document_fields'/);
    expect(sql).toMatch(/when 'evidence_document_versions'/);
    expect(sql).toContain("intake_idempotency_key");
    expect(sql).toContain("delivery_attempts");
  });
  it("covers every current migration-defined tenant table or explains its exclusion", () => {
    const tenantTables = tenantTablesFromMigrations();

    expect(() => validateExportRegistryCoverage(tenantTables)).not.toThrow();
    expect(Object.values(exportSourceExclusions)).toEqual(
      expect.arrayContaining([expect.stringMatching(/security|session/i)]),
    );
    expect(exportSourceRegistry.flatMap((source) => source.tables)).toEqual(
      expect.arrayContaining(["organizations", "organization_members"]),
    );
  });

  it("keeps TypeScript registry in parity with SQL physical source mappings", () => {
    const tenantTables = new Set(tenantTablesFromMigrations());
    const exported = new Set(
      exportSourceRegistry.flatMap((source) => source.tables),
    );
    const sqlMappedTenantTables = new Set(
      [...migrationSql().matchAll(/\('[^']+'\s*,\s*'([a-z_]+)'/g)]
        .map((match) => match[1])
        .filter((table): table is string =>
          Boolean(table && tenantTables.has(table)),
        ),
    );

    expect([...sqlMappedTenantTables].sort()).toEqual(
      expect.arrayContaining([
        "reporting_stage_drafts",
        "reporting_stage_draft_revisions",
        "reporting_stage_submissions",
        "reporting_family_templates",
        "reporting_family_template_versions",
      ]),
    );
    for (const table of sqlMappedTenantTables) {
      expect(exported.has(table)).toBe(true);
      expect(exportSourceExclusions[table]).toBeUndefined();
    }
  });

  it("keeps every physical registry mapping in the atomic SQL snapshot catalogue", () => {
    const sql = migrationSql();

    for (const source of exportSourceRegistry) {
      for (const table of source.tables) {
        expect(sql).toMatch(
          new RegExp(`\\('${source.sourceId}'\\s*,\\s*'${table}'`),
        );
      }
    }
    expect(sql).toContain("materialize_organization_export_snapshot_atomic");
    expect(sql).toContain("m1_export_redact_jsonb");
  });

  it("locks every registered physical table in the latest snapshot materializer", () => {
    const functionSql = latestMaterializeSnapshotFunctionSql();
    const lockedTables = lockedSnapshotTables(functionSql);
    const dynamicAdditions = dynamicSnapshotLockAdditions(migrationSql());
    const registeredTables = exportSourceRegistry.flatMap(
      (source) => source.tables,
    );

    expect([...lockedTables, ...dynamicAdditions]).toEqual(
      expect.arrayContaining(registeredTables),
    );
  });

  it("uses the reviewed business projection in the final materializer", () => {
    const functionSql = latestMaterializeSnapshotFunctionSql();
    expect(functionSql).toContain(
      "public.m1_export_business_record_jsonb($4, to_jsonb(source))",
    );
    expect(functionSql).not.toContain(
      "public.m1_export_redact_jsonb(to_jsonb(source))",
    );
  });
});
